/**
 * AI write actions: schedule (보강). Definition shape: src/08_AgentActions.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../00_Core.js');
}

(function () {
  var CLASS_ID = LMS.AGENT_PARAM.classId;
  var DATE = LMS.AGENT_PARAM.date;
  var MAKEUP_ID = { type: 'string', description: '보강 ID (예: MKP-0002). get_calendar 또는 get_day_agenda에서 찾습니다.' };
  function TIME(what) {
    return { type: 'string', description: what + ' (HH:MM, 선택)' };
  }

  var MAKEUP_PARAMS = {
    makeup_date: DATE('보강일'),
    start_time: TIME('시작 시간'),
    end_time: TIME('종료 시간'),
    class_id: CLASS_ID,
    title: { type: 'string', description: '제목' },
    memo: { type: 'string', description: '메모' },
    status: { type: 'string', enum: LMS.MAKEUP_STATUS, description: '예정, 완료, 취소' }
  };
  var MAKEUP_FIELDS = Object.keys(MAKEUP_PARAMS);
  var MAKEUP_LABELS = { makeup_date: '보강일', start_time: '시작', end_time: '종료', class_id: '반', title: '제목', memo: '메모', status: '상태' };

  function requireMakeup(svc, makeupId) {
    var row = LMS.findById(svc.table('MakeupSessions'), 'makeup_id', makeupId);
    if (!row) throw new Error('보강 일정(' + (LMS.toStr(makeupId) || '없음') + ')을 찾을 수 없습니다.');
    return row;
  }

  function checkLinks(svc, input) {
    if (input.class_id && !LMS.findById(svc.table('Classes'), 'class_id', input.class_id)) throw new Error('반 정보를 찾을 수 없습니다.');
    (input.student_ids || []).forEach(function (id) {
      if (!LMS.findById(svc.table('Students'), 'student_id', id)) throw new Error('학생 정보(' + id + ')를 찾을 수 없습니다.');
    });
  }

  function timeText(row) {
    var s = LMS.toStr(row.start_time);
    var e = LMS.toStr(row.end_time);
    return s || e ? ' ' + s + '~' + e : '';
  }

  /** "중2 A반 반 보강" or "홍길동 개인 보강" for a stored row. */
  function makeupWho(svc, row) {
    if (row.kind === '반') return LMS.agentClassName(svc.table, row.class_id) + ' 반 보강';
    return LMS.agentStudentName(svc.table, row.student_id) + ' 개인 보강';
  }

  function makeupMatches(row, args) {
    return Boolean(row) && MAKEUP_FIELDS.every(function (k) { return LMS.toStr(row[k]) === LMS.toStr(args[k]); });
  }

  var actions = {
    create_makeup: {
      label: '보강 추가',
      progress: '보강 추가 준비 중',
      description: '보강 일정을 추가합니다. kind가 반이면 class_id, 학생이면 student_ids가 필요합니다. 학생을 여럿 넣으면 학생마다 개인 보강이 하나씩 생깁니다.',
      destructive: false,
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: LMS.MAKEUP_KIND, description: '반(반 전체 보강) 또는 학생(개인 보강)' },
          makeup_date: DATE('보강일'),
          start_time: TIME('시작 시간'),
          end_time: TIME('종료 시간'),
          class_id: Object.assign({}, CLASS_ID, { description: '반 ID (kind가 반이면 필수, list_classes로 찾음)' }),
          student_ids: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: { type: 'string' }, description: '학생 ID 목록 (kind가 학생이면 필수, search_students로 찾음)' },
          title: { type: 'string', description: '제목 (선택, 비우면 "반 이름 보강"/"학생 이름 보강")' },
          memo: { type: 'string', description: '메모 (선택)' }
        },
        required: ['kind', 'makeup_date']
      },
      limits: { student_ids: '명' },
      preview: function (svc, args) {
        var input = LMS.validateMakeupSessionInput(Object.assign({}, args, { makeup_id: '' }), false);
        checkLinks(svc, input);
        delete input.makeup_id;
        var who = input.kind === '반'
          ? LMS.agentClassName(svc.table, input.class_id) + ' 반 보강'
          : input.student_ids.map(function (id) { return LMS.agentStudentName(svc.table, id); }).join(', ') + ' 개인 보강' + (input.student_ids.length > 1 ? ' (' + input.student_ids.length + '명, 학생마다 하나씩)' : '');
        return {
          args: input,
          target: { student_id: input.student_id, student_name: input.student_id ? LMS.agentStudentName(svc.table, input.student_id) : '', class_name: input.class_id ? LMS.agentClassName(svc.table, input.class_id) : '', date: input.makeup_date },
          before: '',
          after: input.makeup_date + timeText(input),
          text: who + ' 추가: ' + input.makeup_date + timeText(input) + (input.title ? ' 「' + input.title + '」' : '')
        };
      },
      run: function (svc, args) {
        return svc.api.saveMakeupSession(args);
      },
      verify: function (svc, args, ran) {
        var made = ran && Array.isArray(ran.sessions) ? ran.sessions : (ran && ran.makeup_id ? [ran] : []);
        var rows = svc.table('MakeupSessions');
        var ids = made.map(function (m) { return LMS.toStr(m.makeup_id); });
        var ok = ids.length > 0 && ids.every(function (id) {
          var row = LMS.findById(rows, 'makeup_id', id);
          return Boolean(row) && LMS.toStr(row.makeup_date) === args.makeup_date && LMS.toStr(row.kind) === args.kind;
        });
        return { ok: ok, after: ids.join(', ') };
      }
    },

    update_makeup: {
      label: '보강 수정',
      progress: '보강 수정 준비 중',
      description: '보강 일정의 날짜·시간·반·제목·메모·상태를 고칩니다. 넣지 않은 항목은 그대로 둡니다. 보강 대상 학생과 종류는 바꿀 수 없습니다(취소 후 새로 추가).',
      parameters: { type: 'object', properties: Object.assign({ makeup_id: MAKEUP_ID }, MAKEUP_PARAMS), required: ['makeup_id'] },
      preview: function (svc, args) {
        var row = requireMakeup(svc, LMS.toStr(args && args.makeup_id));
        var merged = { makeup_id: LMS.toStr(row.makeup_id), kind: LMS.toStr(row.kind), student_id: LMS.toStr(row.student_id) };
        MAKEUP_FIELDS.forEach(function (k) {
          merged[k] = args && args[k] !== undefined && args[k] !== null ? args[k] : row[k];
        });
        var input = LMS.validateMakeupSessionInput(merged, true);
        checkLinks(svc, input);
        delete input.student_ids;
        var changes = MAKEUP_FIELDS.filter(function (k) {
          return LMS.toStr(row[k]) !== LMS.toStr(input[k]);
        }).map(function (k) {
          var show = function (v) { return k === 'class_id' && v ? LMS.agentClassName(svc.table, v) : LMS.toStr(v); };
          return MAKEUP_LABELS[k] + ': ' + (show(row[k]) || '없음') + ' → ' + (show(input[k]) || '없음');
        });
        if (!changes.length) throw new Error('바뀌는 내용이 없습니다.');
        return {
          args: input,
          target: { student_id: input.student_id, student_name: input.student_id ? LMS.agentStudentName(svc.table, input.student_id) : '', class_name: input.class_id ? LMS.agentClassName(svc.table, input.class_id) : '', date: input.makeup_date },
          before: LMS.toStr(row.makeup_date) + timeText(row) + ' (' + LMS.toStr(row.status) + ')',
          after: input.makeup_date + timeText(input) + ' (' + input.status + ')',
          text: makeupWho(svc, row) + ' ' + LMS.toStr(row.makeup_date) + ' 수정: ' + changes.join(', ')
        };
      },
      run: function (svc, args) {
        return svc.api.updateMakeupSession(args);
      },
      verify: function (svc, args) {
        var row = LMS.findById(svc.table('MakeupSessions'), 'makeup_id', args.makeup_id);
        return { ok: makeupMatches(row, args), after: row ? LMS.toStr(row.makeup_date) + timeText(row) + ' (' + LMS.toStr(row.status) + ')' : '' };
      }
    },

    cancel_makeup: {
      label: '보강 취소',
      progress: '보강 취소 준비 중',
      description: '보강 일정을 취소합니다(기록은 남고 일정표에서 빠짐). 취소 전에 어떤 보강인지 사용자에게 확인합니다.',
      parameters: { type: 'object', properties: { makeup_id: MAKEUP_ID }, required: ['makeup_id'] },
      preview: function (svc, args) {
        var row = requireMakeup(svc, LMS.toStr(args && args.makeup_id));
        if (LMS.toStr(row.status) === '취소') throw new Error('이미 취소된 보강입니다.');
        return {
          args: { makeup_id: LMS.toStr(row.makeup_id) },
          target: { student_id: LMS.toStr(row.student_id), student_name: row.student_id ? LMS.agentStudentName(svc.table, row.student_id) : '', class_name: row.class_id ? LMS.agentClassName(svc.table, row.class_id) : '', date: LMS.toStr(row.makeup_date) },
          before: LMS.toStr(row.status),
          after: '취소',
          text: makeupWho(svc, row) + ' ' + LMS.toStr(row.makeup_date) + timeText(row) + ' 취소 (' + LMS.toStr(row.status) + ' → 취소, 일정표에서 빠짐)'
        };
      },
      run: function (svc, args) {
        return svc.api.cancelMakeupSession(args.makeup_id);
      },
      verify: function (svc, args) {
        var row = LMS.findById(svc.table('MakeupSessions'), 'makeup_id', args.makeup_id);
        var after = row ? LMS.toStr(row.status) : '';
        return { ok: after === '취소', after: after };
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = actions;
  }
})();
