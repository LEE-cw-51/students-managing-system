/**
 * AI write actions: exam-prep periods and school exam dates (시험). Definition shape:
 * src/08_AgentActions.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../00_Core.js');
}

(function () {
  var DATE = LMS.AGENT_PARAM.date;
  var PERIOD_ID = { type: 'string', description: '시험대비 기간 ID (예: EXP-0001). list_exam_periods로 찾습니다.' };
  var SCHOOL_EXAM_ID = { type: 'string', description: '학교 시험 일정 ID (예: SCX-0003). get_school_exams로 찾습니다.' };

  var PERIOD_PARAMS = {
    title: { type: 'string', description: '기간 이름 (예: 2학기 중간)' },
    start_date: DATE('시작일'),
    end_date: DATE('종료일 (시작일부터 두 달 이내)'),
    exam_year: { type: 'string', description: '학년도 (예: 2026, 선택)' },
    exam_semester: { type: 'string', description: '학기 1 또는 2 (선택)' },
    exam_type: { type: 'string', enum: LMS.SCHOOL_EXAM_TYPES, description: '시험 종류 (선택)' },
    memo: { type: 'string', description: '메모 (선택)' }
  };
  var PERIOD_FIELDS = Object.keys(PERIOD_PARAMS);
  var PERIOD_LABELS = { title: '이름', start_date: '시작일', end_date: '종료일', exam_year: '학년도', exam_semester: '학기', exam_type: '시험 종류', memo: '메모' };

  var SCHOOL_EXAM_PARAMS = {
    school: { type: 'string', description: '학교 이름' },
    grade: { type: 'string', description: '학년 (예: 중2)' },
    school_year: { type: 'string', description: '학년도 4자리 (예: 2026)' },
    semester: { type: 'string', enum: ['1', '2'], description: '학기' },
    exam_type: { type: 'string', enum: LMS.SCHOOL_EXAM_TYPES, description: '중간, 기말, 기타' },
    title: { type: 'string', description: '시험 이름 (기타일 때 필수)' },
    exam_date: DATE('시험 시작일 (선택)'),
    exam_end_date: DATE('시험 종료일 (선택)'),
    math_exam_date: DATE('수학 시험일 (선택, 시험 기간 안)'),
    textbook: { type: 'string', description: '교재 (선택)' },
    scope: { type: 'string', description: '시험 범위 (선택)' },
    memo: { type: 'string', description: '메모 (선택)' }
  };
  var SCHOOL_EXAM_FIELDS = Object.keys(SCHOOL_EXAM_PARAMS);
  var SCHOOL_EXAM = {
    type: 'object',
    properties: Object.assign({
      school_exam_id: Object.assign({}, SCHOOL_EXAM_ID, { description: '고칠 일정 ID (선택). 없으면 같은 학교·학년·학년도·학기·시험을 찾아 고치거나 새로 만듭니다.' })
    }, SCHOOL_EXAM_PARAMS),
    required: ['school', 'grade', 'school_year', 'semester', 'exam_type']
  };

  function requirePeriod(svc, periodId) {
    var row = LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', periodId);
    if (!row) throw new Error('시험대비 기간(' + (LMS.toStr(periodId) || '없음') + ')을 찾을 수 없습니다.');
    return row;
  }

  /** Temporary classes of a period (same rule as the service's periodClassIds_). */
  function periodClasses(svc, periodId) {
    return svc.table('Classes').filter(function (c) {
      return LMS.toStr(c.exam_period_id) === LMS.toStr(periodId) && LMS.toStr(c.class_type) === '시험대비';
    });
  }

  function classNames(svc, ids) {
    return ids.map(function (id) { return LMS.agentClassName(svc.table, id); }).join(', ');
  }

  function sameIds(a, b) {
    return a.slice().sort().join('|') === b.slice().sort().join('|');
  }

  function schoolExamName(e) {
    var kind = LMS.toStr(e.exam_type) === '기타' ? LMS.toStr(e.title) : LMS.toStr(e.exam_type);
    return LMS.toStr(e.school) + ' ' + LMS.toStr(e.grade) + ' ' + LMS.toStr(e.school_year) + '년 ' + LMS.toStr(e.semester) + '학기 ' + kind;
  }

  function schoolExamDates(e) {
    var range = e.exam_date ? (e.exam_end_date && e.exam_end_date !== e.exam_date ? e.exam_date + '~' + e.exam_end_date : e.exam_date) : '날짜 미정';
    return range + (e.math_exam_date ? ' (수학 ' + e.math_exam_date + ')' : '');
  }

  /** Validated input plus the stored row it will update (by id, else by school/grade/exam key). */
  function prepareSchoolExam(rows, data) {
    var input = LMS.validateSchoolExamInput(data);
    var row = input.school_exam_id ? LMS.findById(rows, 'school_exam_id', input.school_exam_id) : null;
    if (input.school_exam_id && !row) throw new Error('시험 일정(' + input.school_exam_id + ')을 찾을 수 없습니다.');
    var key = LMS.schoolExamKey(input);
    var clash = rows.filter(function (r) { return LMS.schoolExamKey(r) === key && r !== row; })[0] || null;
    if (row && clash) throw new Error('같은 학교·학년의 같은 시험이 이미 있습니다: ' + schoolExamName(input));
    return { input: input, existing: row || clash };
  }

  function schoolExamArgs(input) {
    var out = {};
    if (input.school_exam_id) out.school_exam_id = input.school_exam_id;
    SCHOOL_EXAM_FIELDS.forEach(function (k) { out[k] = input[k]; });
    return out;
  }

  function schoolExamLine(p) {
    return (p.existing ? '수정 ' : '추가 ') + schoolExamName(p.input) + ': ' +
      (p.existing ? schoolExamDates(p.existing) + ' → ' : '') + schoolExamDates(p.input);
  }

  function schoolExamStored(svc, ran, args) {
    var row = ran && ran.school_exam_id ? LMS.findById(svc.table('SchoolExams'), 'school_exam_id', ran.school_exam_id) : null;
    return Boolean(row) && LMS.toStr(row.exam_date) === LMS.toStr(args.exam_date) && LMS.toStr(row.school) === LMS.toStr(args.school);
  }

  var actions = {
    create_exam_period: {
      label: '시험대비 기간 추가',
      progress: '시험대비 기간 추가 준비 중',
      description: '시험대비 기간을 새로 만듭니다(상태 준비). 시험대비 반 편성과 휴강 반 지정은 따로 합니다.',
      destructive: false,
      parameters: { type: 'object', properties: Object.assign({}, PERIOD_PARAMS), required: ['title', 'start_date', 'end_date'] },
      preview: function (svc, args) {
        var input = LMS.validateExamPeriodInput(Object.assign({}, args, { exam_period_id: '' }));
        delete input.exam_period_id;
        return {
          args: input,
          target: { date: input.start_date },
          before: '',
          after: input.title,
          text: '시험대비 기간 「' + input.title + '」 추가: ' + input.start_date + '~' + input.end_date + (input.exam_type ? ' (' + [input.exam_year, input.exam_semester ? input.exam_semester + '학기' : '', input.exam_type].filter(Boolean).join(' ') + ')' : '')
        };
      },
      run: function (svc, args) {
        return svc.api.saveExamPeriod(args);
      },
      verify: function (svc, args, ran) {
        var row = ran && ran.exam_period_id ? LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', ran.exam_period_id) : null;
        var ok = Boolean(row) && LMS.toStr(row.title) === args.title && LMS.toStr(row.start_date) === args.start_date && LMS.toStr(row.end_date) === args.end_date;
        return { ok: ok, after: row ? LMS.toStr(row.exam_period_id) : '' };
      }
    },

    update_exam_period: {
      label: '시험대비 기간 수정',
      progress: '시험대비 기간 수정 준비 중',
      description: '시험대비 기간의 이름·날짜·시험 정보를 고칩니다. 넣지 않은 항목은 그대로 둡니다. 기간을 줄이면 시험대비 반의 임시 배정도 새 기간 안으로 줄어듭니다.',
      parameters: { type: 'object', properties: Object.assign({ exam_period_id: PERIOD_ID }, PERIOD_PARAMS), required: ['exam_period_id'] },
      preview: function (svc, args) {
        var period = requirePeriod(svc, LMS.toStr(args && args.exam_period_id));
        var merged = { exam_period_id: LMS.toStr(period.exam_period_id) };
        PERIOD_FIELDS.forEach(function (k) {
          merged[k] = args && args[k] !== undefined && args[k] !== null ? args[k] : period[k];
        });
        var input = LMS.validateExamPeriodInput(merged);
        var changes = PERIOD_FIELDS.filter(function (k) {
          return LMS.toStr(period[k]) !== LMS.toStr(input[k]);
        }).map(function (k) {
          return PERIOD_LABELS[k] + ': ' + (LMS.toStr(period[k]) || '없음') + ' → ' + (input[k] || '없음');
        });
        if (!changes.length) throw new Error('바뀌는 내용이 없습니다.');
        var shrinks = input.start_date > LMS.toStr(period.start_date) || input.end_date < LMS.toStr(period.end_date);
        return {
          args: input,
          target: { date: input.start_date },
          before: LMS.toStr(period.title) + ' ' + LMS.toStr(period.start_date) + '~' + LMS.toStr(period.end_date),
          after: input.title + ' ' + input.start_date + '~' + input.end_date,
          text: '시험대비 기간 「' + LMS.toStr(period.title) + '」 수정: ' + changes.join(', ') +
            (shrinks && periodClasses(svc, period.exam_period_id).length ? ' (기간이 줄어 시험대비 반 임시 배정도 새 기간 안으로 맞춰짐)' : '')
        };
      },
      run: function (svc, args) {
        return svc.api.saveExamPeriod(args);
      },
      verify: function (svc, args) {
        var row = LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', args.exam_period_id);
        var ok = Boolean(row) && PERIOD_FIELDS.every(function (k) { return LMS.toStr(row[k]) === LMS.toStr(args[k]); });
        return { ok: ok, after: row ? LMS.toStr(row.title) + ' ' + LMS.toStr(row.start_date) + '~' + LMS.toStr(row.end_date) : '' };
      }
    },

    close_exam_period: {
      label: '시험대비 기간 마감',
      progress: '시험대비 기간 마감 준비 중',
      description: '시험대비 기간을 마감합니다. 그 기간의 시험대비 반도 모두 종료됩니다. 마감 전에 사용자에게 확인합니다.',
      parameters: { type: 'object', properties: { exam_period_id: PERIOD_ID }, required: ['exam_period_id'] },
      preview: function (svc, args) {
        var period = requirePeriod(svc, LMS.toStr(args && args.exam_period_id));
        if (LMS.toStr(period.status) === '종료') throw new Error('이미 마감된 시험대비 기간입니다.');
        var classes = periodClasses(svc, period.exam_period_id).filter(function (c) { return LMS.toStr(c.status) !== '종료'; });
        return {
          args: { exam_period_id: LMS.toStr(period.exam_period_id) },
          target: { date: LMS.toStr(period.end_date) },
          before: LMS.toStr(period.status),
          after: '종료',
          text: '시험대비 기간 「' + LMS.toStr(period.title) + '」 마감' +
            (classes.length ? ': 시험대비 반 ' + classes.length + '개(' + classNames(svc, classes.map(function (c) { return c.class_id; })) + ') 종료' : '')
        };
      },
      run: function (svc, args) {
        return svc.api.closeExamPeriod(args.exam_period_id);
      },
      verify: function (svc, args) {
        var row = LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', args.exam_period_id);
        var open = periodClasses(svc, args.exam_period_id).filter(function (c) { return LMS.toStr(c.status) !== '종료'; });
        var after = row ? LMS.toStr(row.status) : '';
        return { ok: after === '종료' && !open.length, after: after };
      }
    },

    delete_exam_period: {
      label: '시험대비 기간 삭제',
      progress: '시험대비 기간 삭제 준비 중',
      description: '수업 기록이 없는 시험대비 기간을 지웁니다. 그 기간의 시험대비 반, 임시 배정, 진도 계획, 숙제도 함께 지워지고 휴강 반 지정이 풀립니다. 수업 기록이 있으면 close_exam_period를 씁니다. 지우기 전에 영향 범위를 사용자에게 확인합니다.',
      parameters: { type: 'object', properties: { exam_period_id: PERIOD_ID }, required: ['exam_period_id'] },
      preview: function (svc, args) {
        var period = requirePeriod(svc, LMS.toStr(args && args.exam_period_id));
        var ids = periodClasses(svc, period.exam_period_id).map(function (c) { return LMS.toStr(c.class_id); });
        var inIds = function (r) { return ids.indexOf(LMS.toStr(r.class_id)) !== -1; };
        if (svc.table('Lessons').some(inIds)) throw new Error('수업 기록이 있는 시험대비 기간은 삭제할 수 없습니다. 마감(close_exam_period)을 쓰세요.');
        var assigned = svc.table('StudentClasses').filter(inIds).length;
        var plans = svc.table('ClassPlans').filter(inIds).length;
        var suspended = LMS.suspendedClassIds(period).length;
        var scope = [];
        if (ids.length) scope.push('시험대비 반 ' + ids.length + '개(' + classNames(svc, ids) + ')');
        if (assigned) scope.push('임시 배정 ' + assigned + '건');
        if (plans) scope.push('진도 계획 ' + plans + '건');
        var parts = [];
        if (scope.length) parts.push(scope.join(', ') + ' 삭제');
        if (suspended) parts.push('휴강 반 ' + suspended + '개 해제');
        return {
          args: { exam_period_id: LMS.toStr(period.exam_period_id) },
          target: { date: LMS.toStr(period.start_date) },
          before: LMS.toStr(period.title),
          after: '',
          text: '시험 기간 「' + LMS.toStr(period.title) + '」(' + LMS.toStr(period.start_date) + '~' + LMS.toStr(period.end_date) + ') 삭제' + (parts.length ? ': ' + parts.join(', ') : '')
        };
      },
      run: function (svc, args) {
        return svc.api.deleteExamPeriod(args.exam_period_id);
      },
      verify: function (svc, args) {
        var gone = !LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', args.exam_period_id) && !periodClasses(svc, args.exam_period_id).length;
        return { ok: gone, after: gone ? '삭제됨' : '남아 있음' };
      }
    },

    set_exam_period_suspended_classes: {
      label: '시험대비 휴강 반',
      progress: '휴강 반 지정 준비 중',
      description: '시험대비 기간 동안 쉬는 정규 반 목록을 통째로 바꿉니다. 지금 목록은 get_exam_period_detail로 확인하고, 빠뜨린 반은 휴강이 풀립니다. 빈 목록이면 모두 해제합니다.',
      parameters: {
        type: 'object',
        properties: {
          exam_period_id: PERIOD_ID,
          class_ids: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: { type: 'string' }, description: '휴강할 정규 반 ID 전체 목록 (list_classes로 찾음)' }
        },
        required: ['exam_period_id', 'class_ids']
      },
      limits: { class_ids: '개' },
      preview: function (svc, args) {
        var period = requirePeriod(svc, LMS.toStr(args && args.exam_period_id));
        if (!Array.isArray(args.class_ids)) throw new Error('휴강할 반 ID 목록(class_ids)을 넣어 주세요. 모두 해제하려면 빈 목록을 넣습니다.');
        var ids = LMS.uniqueIds(args.class_ids.map(LMS.toStr));
        ids.forEach(function (id) {
          if (!LMS.findById(svc.table('Classes'), 'class_id', id)) throw new Error('반 정보(' + id + ')를 찾을 수 없습니다.');
        });
        var before = LMS.suspendedClassIds(period).map(LMS.toStr);
        if (sameIds(before, ids)) throw new Error('바뀌는 내용이 없습니다.');
        var added = ids.filter(function (id) { return before.indexOf(id) === -1; });
        var removed = before.filter(function (id) { return ids.indexOf(id) === -1; });
        var parts = [];
        if (added.length) parts.push('휴강 ' + added.length + '개 추가(' + classNames(svc, added) + ')');
        if (removed.length) parts.push('휴강 ' + removed.length + '개 해제(' + classNames(svc, removed) + ')');
        return {
          args: { exam_period_id: LMS.toStr(period.exam_period_id), class_ids: ids },
          target: { date: LMS.toStr(period.start_date) },
          before: classNames(svc, before),
          after: classNames(svc, ids),
          text: '시험대비 기간 「' + LMS.toStr(period.title) + '」 동안 정규 반 휴강: ' + parts.join(', ') + ' → 휴강 반 ' + ids.length + '개'
        };
      },
      run: function (svc, args) {
        return svc.api.setPeriodSuspendedClasses(args.exam_period_id, args.class_ids);
      },
      verify: function (svc, args) {
        var row = LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', args.exam_period_id);
        var after = row ? LMS.suspendedClassIds(row).map(LMS.toStr) : [];
        return { ok: Boolean(row) && sameIds(after, args.class_ids), after: after.join(', ') };
      }
    },

    save_school_exam: {
      label: '학교 시험 일정',
      progress: '학교 시험 일정 저장 준비 중',
      description: '학교 수학 시험 일정 하나를 추가하거나 고칩니다. 같은 학교·학년·학년도·학기·시험이 이미 있으면 그 일정을 덮어씁니다.',
      parameters: SCHOOL_EXAM,
      preview: function (svc, args) {
        var p = prepareSchoolExam(svc.table('SchoolExams'), args);
        var out = schoolExamArgs(p.input);
        if (p.existing) out.school_exam_id = LMS.toStr(p.existing.school_exam_id);
        return {
          args: out,
          target: { date: out.exam_date },
          before: p.existing ? schoolExamDates(p.existing) : '',
          after: schoolExamDates(out),
          text: '학교 시험 일정 ' + schoolExamLine(p)
        };
      },
      run: function (svc, args) {
        return svc.api.saveSchoolExam(args);
      },
      verify: function (svc, args, ran) {
        return { ok: schoolExamStored(svc, ran, args), after: ran && ran.school_exam_id ? LMS.toStr(ran.school_exam_id) : '' };
      }
    },

    save_school_exams_batch: {
      label: '학교 시험 일정 여러 건',
      progress: '학교 시험 일정 저장 준비 중',
      description: '학교 시험 일정을 여러 건 한 번에 추가하거나 고칩니다(최대 ' + LMS.AGENT_BATCH_MAX + '건). 각 항목은 save_school_exam과 같고, 이미 있는 시험은 덮어씁니다.',
      parameters: {
        type: 'object',
        properties: { exams: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: SCHOOL_EXAM, description: '시험 일정 목록' } },
        required: ['exams']
      },
      limits: { exams: '건' },
      preview: function (svc, args) {
        var list = args && Array.isArray(args.exams) ? args.exams : [];
        if (!list.length) throw new Error('저장할 시험 일정(exams)을 넣어 주세요.');
        var rows = svc.table('SchoolExams');
        var seen = {};
        var prepared = list.map(function (item, i) {
          var p;
          try {
            p = prepareSchoolExam(rows, item);
          } catch (e) {
            throw new Error((i + 1) + '번째 일정: ' + e.message);
          }
          var key = LMS.schoolExamKey(p.input);
          if (seen[key]) throw new Error((i + 1) + '번째 일정이 앞의 일정과 같은 시험입니다: ' + schoolExamName(p.input));
          seen[key] = true;
          return p;
        });
        var out = prepared.map(function (p) {
          var a = schoolExamArgs(p.input);
          if (p.existing) a.school_exam_id = LMS.toStr(p.existing.school_exam_id);
          return a;
        });
        var updates = prepared.filter(function (p) { return p.existing; }).length;
        return {
          args: { exams: out },
          target: { date: out[0].exam_date },
          before: updates ? updates + '건 기존 일정' : '',
          after: out.length + '건',
          text: '학교 시험 일정 ' + out.length + '건 저장 (추가 ' + (out.length - updates) + '건, 수정 ' + updates + '건)\n' +
            prepared.map(function (p) { return '- ' + schoolExamLine(p); }).join('\n')
        };
      },
      run: function (svc, args) {
        return svc.api.saveSchoolExamsBatch(args.exams);
      },
      verify: function (svc, args, ran) {
        var saved = Array.isArray(ran) ? ran : [];
        var ok = saved.length === args.exams.length && args.exams.every(function (a, i) { return schoolExamStored(svc, saved[i], a); });
        return { ok: ok, after: saved.map(function (r) { return LMS.toStr(r && r.school_exam_id); }).join(', ') };
      }
    },

    delete_school_exam: {
      label: '학교 시험 일정 삭제',
      progress: '학교 시험 일정 삭제 준비 중',
      description: '학교 시험 일정 하나를 지웁니다. 지우기 전에 어떤 시험인지 사용자에게 확인합니다.',
      parameters: { type: 'object', properties: { school_exam_id: SCHOOL_EXAM_ID }, required: ['school_exam_id'] },
      preview: function (svc, args) {
        var id = LMS.toStr(args && args.school_exam_id);
        var row = LMS.findById(svc.table('SchoolExams'), 'school_exam_id', id);
        if (!row) throw new Error('시험 일정(' + (id || '없음') + ')을 찾을 수 없습니다.');
        return {
          args: { school_exam_id: id },
          target: { date: LMS.toStr(row.exam_date) },
          before: schoolExamDates(row),
          after: '',
          text: '학교 시험 일정 삭제: ' + schoolExamName(row) + ' ' + schoolExamDates(row) + (row.scope ? ' (범위 「' + LMS.toStr(row.scope).slice(0, 40) + '」도 함께 삭제)' : '')
        };
      },
      run: function (svc, args) {
        return svc.api.deleteSchoolExam(args.school_exam_id);
      },
      verify: function (svc, args) {
        var gone = !LMS.findById(svc.table('SchoolExams'), 'school_exam_id', args.school_exam_id);
        return { ok: gone, after: gone ? '삭제됨' : '남아 있음' };
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = actions;
  }
})();
