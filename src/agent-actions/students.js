/**
 * AI write actions: students and class assignments. Same shape as LMS.AGENT_WRITE_ACTIONS in
 * 07_Agent.js ({ label, preview, run, verify }); each name needs a tool in lib/mcp-tools/write-students.js.
 * Previews repeat the service's checks on the tables without writing; run re-checks everything.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../07_Agent.js');
}

var STU_FIELDS_ = ['name', 'grade', 'school', 'student_phone', 'parent_phone', 'enrollment_date', 'status', 'memo'];
var STU_FIELD_LABELS_ = {
  name: '이름', grade: '학년', school: '학교', student_phone: '학생 전화', parent_phone: '학부모 전화',
  enrollment_date: '등록일', status: '상태', memo: '메모'
};

function stuStr_(v) {
  return LMS.toStr(v);
}

function stuShort_(v) {
  var s = stuStr_(v).replace(/\s+/g, ' ');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function stuNames_(names) {
  return names.length > 10 ? names.slice(0, 10).join(', ') + ' 외 ' + (names.length - 10) + '명' : names.join(', ');
}

function stuRow_(svc, id) {
  var s = LMS.findById(svc.table('Students'), 'student_id', stuStr_(id));
  if (!s) throw new Error('학생(' + (stuStr_(id) || '없음') + ')을 찾을 수 없습니다. search_students로 student_id를 확인해 주세요.');
  return s;
}

function stuClass_(svc, id) {
  var c = LMS.findById(svc.table('Classes'), 'class_id', stuStr_(id));
  if (!c) throw new Error('반(' + (stuStr_(id) || '없음') + ')을 찾을 수 없습니다. list_classes로 class_id를 확인해 주세요.');
  return c;
}

function stuDate_(v, label) {
  var d = stuStr_(v);
  if (!LMS.isIsoDate(d)) throw new Error(label + '을(를) YYYY-MM-DD로 입력해 주세요.');
  return d;
}

function stuIsExamClass_(svc, classId) {
  var c = LMS.findById(svc.table('Classes'), 'class_id', classId);
  return !!c && stuStr_(c.class_type) === '시험대비';
}

/** 열린 정규 배정 (same rule as assignments.openRegular). */
function stuOpenRegular_(svc, studentId) {
  return svc.table('StudentClasses').filter(function (r) {
    return stuStr_(r.student_id) === stuStr_(studentId) && stuStr_(r.status) === '현재' && !stuIsExamClass_(svc, r.class_id);
  });
}

function stuClassNames_(svc, rels) {
  return rels.map(function (r) { return LMS.agentClassName(svc.table, r.class_id); });
}

function stuRel_(svc, relId) {
  return LMS.findById(svc.table('StudentClasses'), 'id', stuStr_(relId));
}

/**
 * The assignment a tool acts on: rel_id, or the student's row in class_id. prefer: 'open' (현재
 * regular), 'regular' (현재 first, else the latest regular row), 'temp' (임시 placement).
 */
function stuPickRel_(svc, args, prefer) {
  if (stuStr_(args.rel_id)) {
    var byId = stuRel_(svc, args.rel_id);
    if (!byId) throw new Error('반 배정(' + stuStr_(args.rel_id) + ')을 찾을 수 없습니다.');
    return byId;
  }
  var sid = stuStr_(args.student_id);
  var cid = stuStr_(args.class_id);
  if (!sid || !cid) throw new Error('rel_id 또는 student_id와 class_id를 함께 입력해 주세요.');
  stuRow_(svc, sid);
  stuClass_(svc, cid);
  var rows = svc.table('StudentClasses').filter(function (r) {
    return stuStr_(r.student_id) === sid && stuStr_(r.class_id) === cid;
  }).sort(function (a, b) { return stuStr_(b.start_date).localeCompare(stuStr_(a.start_date)); });
  var hit;
  if (prefer === 'temp') {
    hit = rows.filter(function (r) { return stuStr_(r.status) === '임시'; })[0];
  } else {
    var regular = rows.filter(function (r) { return stuStr_(r.status) !== '임시'; });
    hit = regular.filter(function (r) { return stuStr_(r.status) === '현재'; })[0] || (prefer === 'regular' ? regular[0] : null);
  }
  if (!hit) throw new Error(LMS.agentStudentName(svc.table, sid) + ' 학생의 ' + LMS.agentClassName(svc.table, cid) + ' ' + (prefer === 'temp' ? '시험대비 배정' : '현재 반 배정') + '을 찾을 수 없습니다.');
  return hit;
}

function stuRelLabel_(rel) {
  return stuStr_(rel.start_date) + ' ~ ' + (stuStr_(rel.end_date) || '현재');
}

function stuLessonOnOrAfter_(svc, studentId, classId, from) {
  return svc.table('Lessons').filter(function (l) {
    return stuStr_(l.student_id) === stuStr_(studentId) && stuStr_(l.class_id) === stuStr_(classId) && stuStr_(l.lesson_date) >= from;
  }).map(function (l) { return stuStr_(l.lesson_date); }).sort()[0] || '';
}

/** Same rules as assignments.moveProblem. */
function stuMoveProblem_(svc, rel, toClassId, start) {
  if (stuStr_(rel.class_id) === stuStr_(toClassId)) return '지금 다니는 반과 같은 반입니다.';
  var cls = LMS.findById(svc.table('Classes'), 'class_id', toClassId);
  if (!cls) return '옮겨 갈 반을 찾을 수 없습니다.';
  if (stuStr_(cls.status) !== '운영') return '종료된 반으로는 옮길 수 없습니다.';
  if (stuStr_(cls.class_type) === '시험대비') return '시험대비 반은 시험 화면에서 편성해 주세요.';
  var already = stuOpenRegular_(svc, rel.student_id).some(function (r) { return stuStr_(r.class_id) === stuStr_(toClassId); });
  if (already) return '이미 ' + cls.class_name + '에 다니고 있습니다.';
  if (start <= stuStr_(rel.start_date)) return '이동일은 지금 반 시작일(' + rel.start_date + ') 다음 날부터 고를 수 있습니다.';
  var later = stuLessonOnOrAfter_(svc, rel.student_id, rel.class_id, start);
  if (later) return '이동일 이후(' + later + ') 지금 반에 수업 기록이 있습니다. 이동일을 그 뒤로 잡아 주세요.';
  return '';
}

/** Same checks as assignments.assign (except the overlap with an older row, left to the service). */
function stuAssignProblem_(svc, student, cls) {
  if (stuStr_(student.status) === '퇴원') return '퇴원한 학생은 반에 배정할 수 없습니다.';
  if (stuStr_(cls.status) !== '운영') return '종료된 반에는 배정할 수 없습니다.';
  if (stuStr_(cls.class_type) === '시험대비') return '시험대비 반은 add_temp_assignment로 편성해 주세요.';
  var exists = svc.table('StudentClasses').some(function (r) {
    return stuStr_(r.student_id) === stuStr_(student.student_id) && stuStr_(r.class_id) === stuStr_(cls.class_id) && stuStr_(r.status) === '현재';
  });
  if (exists) return '이미 해당 반에 소속되어 있습니다.';
  return '';
}

function stuPickFields_(args) {
  var out = {};
  STU_FIELDS_.forEach(function (k) {
    if (args[k] !== undefined && args[k] !== null) out[k] = stuStr_(args[k]);
  });
  return out;
}

function stuWithdrawNote_(svc, studentIds) {
  var rels = [];
  studentIds.forEach(function (sid) { rels = rels.concat(stuOpenRegular_(svc, sid)); });
  return rels.length ? ' · 반 배정 ' + rels.length + '건(' + stuNames_(stuClassNames_(svc, rels)) + ') 종료' : '';
}

LMS.registerAgentWriteActions({
  create_student: {
    label: '학생 추가',
    preview: function (svc, args) {
      args = args || {};
      var fields = stuPickFields_(args);
      var input = LMS.validateStudentInput(fields, false);
      var classId = stuStr_(args.class_id);
      var classPart = '';
      if (classId) {
        var cls = stuClass_(svc, classId);
        var problem = stuAssignProblem_(svc, { student_id: '', status: input.status }, cls);
        if (problem) throw new Error(problem);
        classPart = ' · ' + cls.class_name + ' 배정 (' + (input.enrollment_date || '오늘') + '부터)';
      }
      var same = svc.table('Students').filter(function (s) { return stuStr_(s.name) === input.name; });
      var warn = same.length ? ' ※ 같은 이름 학생이 이미 있습니다(' + same.map(function (s) { return s.student_id; }).join(', ') + ')' : '';
      fields.grade = input.grade;
      fields.status = input.status;
      if (classId) fields.class_id = classId;
      return {
        args: fields,
        target: { student_id: '', student_name: input.name },
        before: '',
        after: input.name,
        text: '학생 추가: ' + input.name + ' (' + [input.grade, input.school, input.status].filter(Boolean).join(', ') + ')' + classPart + warn
      };
    },
    run: function (svc, args) {
      return svc.api.createStudent(args);
    },
    verify: function (svc, args, ran) {
      var row = ran && ran.student_id ? LMS.findById(svc.table('Students'), 'student_id', ran.student_id) : null;
      var ok = !!row && stuStr_(row.name) === stuStr_(args.name);
      if (ok && args.class_id) ok = stuOpenRegular_(svc, row.student_id).some(function (r) { return stuStr_(r.class_id) === stuStr_(args.class_id); });
      return { ok: ok, after: row ? row.student_id : '' };
    }
  },

  update_student: {
    label: '학생 정보 수정',
    preview: function (svc, args) {
      args = args || {};
      var row = stuRow_(svc, args.student_id);
      var changes = stuPickFields_(args);
      var input = LMS.validateStudentInput(Object.assign({}, row, changes), true);
      var diff = [];
      var out = { student_id: row.student_id };
      Object.keys(changes).forEach(function (k) {
        var next = k === 'enrollment_date' ? (input.enrollment_date || stuStr_(row.enrollment_date)) : input[k];
        if (stuStr_(row[k]) === next) return;
        out[k] = next;
        diff.push(STU_FIELD_LABELS_[k] + ' ' + (stuShort_(row[k]) || '없음') + ' → ' + (stuShort_(next) || '없음'));
      });
      if (!diff.length) throw new Error('바뀌는 내용이 없습니다. 바꿀 항목과 새 값을 입력해 주세요.');
      if (args.sync_class_start && out.enrollment_date) out.sync_class_start = true;
      var note = out.status === '퇴원' ? stuWithdrawNote_(svc, [row.student_id]) : '';
      if (out.sync_class_start) note += ' · 첫 반 시작일도 등록일에 맞춤';
      return {
        args: out,
        target: { student_id: row.student_id, student_name: stuStr_(row.name) },
        before: diff.join(', '),
        after: '',
        text: stuStr_(row.name) + ' 정보 수정: ' + diff.join(', ') + note
      };
    },
    run: function (svc, args) {
      var row = stuRow_(svc, args.student_id);
      return svc.api.updateStudent(Object.assign({}, row, args));
    },
    verify: function (svc, args) {
      var row = LMS.findById(svc.table('Students'), 'student_id', args.student_id);
      var ok = !!row && STU_FIELDS_.every(function (k) { return args[k] === undefined || stuStr_(row[k]) === stuStr_(args[k]); });
      return { ok: ok, after: row ? stuStr_(row.name) : '' };
    }
  },

  archive_student: {
    label: '학생 퇴원',
    preview: function (svc, args) {
      var row = stuRow_(svc, args && args.student_id);
      if (stuStr_(row.status) === '퇴원') throw new Error(row.name + ' 학생은 이미 퇴원 상태입니다.');
      return {
        args: { student_id: row.student_id },
        target: { student_id: row.student_id, student_name: stuStr_(row.name) },
        before: stuStr_(row.status),
        after: '퇴원',
        text: stuStr_(row.name) + ' 퇴원 처리 (' + stuStr_(row.status) + ' → 퇴원)' + stuWithdrawNote_(svc, [row.student_id])
      };
    },
    run: function (svc, args) {
      return svc.api.archiveStudent(args.student_id);
    },
    verify: function (svc, args) {
      var row = LMS.findById(svc.table('Students'), 'student_id', args.student_id);
      var ok = !!row && stuStr_(row.status) === '퇴원' && !stuOpenRegular_(svc, args.student_id).length;
      return { ok: ok, after: row ? stuStr_(row.status) : '' };
    }
  },

  set_students_status: {
    label: '학생 상태 일괄 변경',
    preview: function (svc, args) {
      args = args || {};
      var status = LMS.assertEnum(stuStr_(args.status), LMS.STUDENT_STATUS, '학생 상태');
      LMS.assertAgentBatch(args.student_ids, '명');
      var ids = LMS.uniqueIds(args.student_ids);
      if (!ids.length) throw new Error('상태를 바꿀 학생을 골라 주세요.');
      var rows = ids.map(function (id) { return stuRow_(svc, id); });
      var changing = rows.filter(function (r) { return stuStr_(r.status) !== status; });
      if (!changing.length) throw new Error('고른 학생이 모두 이미 ' + status + ' 상태입니다.');
      var names = changing.map(function (r) { return r.name + '(' + stuStr_(r.status) + ')'; });
      var same = rows.length - changing.length;
      var note = status === '퇴원' ? stuWithdrawNote_(svc, changing.map(function (r) { return r.student_id; })) : '';
      return {
        args: { student_ids: changing.map(function (r) { return r.student_id; }), status: status },
        target: { student_id: '', student_name: changing.map(function (r) { return r.name; }).join(', ') },
        before: names.join(', '),
        after: status,
        text: '학생 ' + changing.length + '명 상태 → ' + status + ': ' + stuNames_(names) + (same ? ' (이미 ' + status + '인 ' + same + '명 제외)' : '') + note
      };
    },
    run: function (svc, args) {
      return svc.api.setStudentsStatus({ student_ids: args.student_ids, status: args.status });
    },
    verify: function (svc, args) {
      var bad = args.student_ids.filter(function (id) {
        var row = LMS.findById(svc.table('Students'), 'student_id', id);
        return !row || stuStr_(row.status) !== args.status;
      });
      return { ok: !bad.length, after: (args.student_ids.length - bad.length) + '명 ' + args.status };
    }
  },

  promote_grades: {
    label: '학년 일괄 올림',
    preview: function (svc, args) {
      args = args || {};
      var p = svc.api.previewGradePromotion();
      if (!p.total) throw new Error('학년을 올릴 재원생이 없습니다.');
      if (args.expected_total !== undefined && args.expected_total !== null && args.expected_total !== '' && Number(args.expected_total) !== p.total) {
        throw new Error('학년 올림 대상이 ' + args.expected_total + '명에서 ' + p.total + '명으로 바뀌었습니다. 다시 확인해 주세요.');
      }
      var parts = p.items.filter(function (it) { return it.count; }).map(function (it) {
        return it.from_grade + '→' + it.to_grade + ' ' + it.count + '명';
      });
      return {
        args: { expected_total: p.total },
        target: { student_id: '', student_name: '재원생 ' + p.total + '명' },
        before: '',
        after: p.total + '명',
        text: '재원생 학년 일괄 올림 ' + p.total + '명: ' + parts.join(', ') +
          (p.skipped.length ? ' · 고3·기타 ' + p.skipped.length + '명은 그대로' : '') + ' (실행할 때마다 한 학년씩 올라갑니다)'
      };
    },
    run: function (svc) {
      return svc.api.promoteGrades();
    },
    verify: function (svc, args, ran) {
      var updated = (ran && ran.updated) || [];
      var ok = updated.length === Number(args.expected_total) && updated.every(function (u) {
        var row = LMS.findById(svc.table('Students'), 'student_id', u.student_id);
        return !!row && stuStr_(row.grade) === u.to_grade;
      });
      return { ok: ok, after: updated.length + '명' };
    }
  },

  assign_student_to_class: {
    label: '반 배정',
    preview: function (svc, args) {
      args = args || {};
      var student = stuRow_(svc, args.student_id);
      var cls = stuClass_(svc, args.class_id);
      var start = stuDate_(args.start_date, '반 시작일');
      var problem = stuAssignProblem_(svc, student, cls);
      if (problem) throw new Error(problem);
      var others = stuClassNames_(svc, stuOpenRegular_(svc, student.student_id));
      return {
        args: { student_id: student.student_id, class_id: cls.class_id, start_date: start },
        target: { student_id: student.student_id, student_name: stuStr_(student.name), class_name: stuStr_(cls.class_name), date: start },
        before: others.join(', '),
        after: stuStr_(cls.class_name),
        text: stuStr_(student.name) + ' → ' + cls.class_name + ' 배정 (' + start + '부터)' +
          (others.length ? ' · 기존 반 ' + others.join(', ') + '은 그대로 (옮기려면 move_student)' : '')
      };
    },
    run: function (svc, args) {
      return svc.api.assignStudentToClass(args);
    },
    verify: function (svc, args, ran) {
      var rel = ran && ran.id ? stuRel_(svc, ran.id) : null;
      var ok = !!rel && stuStr_(rel.status) === '현재' && stuStr_(rel.class_id) === args.class_id && stuStr_(rel.start_date) === args.start_date;
      return { ok: ok, after: rel ? rel.id : '' };
    }
  },

  move_student: {
    label: '반 이동',
    preview: function (svc, args) {
      args = args || {};
      var student = stuRow_(svc, args.student_id);
      var to = stuClass_(svc, args.class_id);
      var start = stuDate_(args.start_date, '이동일');
      var open = stuOpenRegular_(svc, student.student_id);
      var rel;
      if (stuStr_(args.from_class_id)) {
        rel = open.filter(function (r) { return stuStr_(r.class_id) === stuStr_(args.from_class_id); })[0];
        if (!rel) throw new Error(student.name + ' 학생은 ' + LMS.agentClassName(svc.table, args.from_class_id) + '에 다니고 있지 않습니다.');
      } else {
        if (!open.length) throw new Error(student.name + ' 학생은 지금 다니는 반이 없습니다. assign_student_to_class를 써 주세요.');
        if (open.length > 1) throw new Error(student.name + ' 학생은 두 반 이상(' + stuClassNames_(svc, open).join(', ') + ') 다닙니다. from_class_id로 어느 반에서 옮길지 정해 주세요.');
        rel = open[0];
      }
      var problem = stuMoveProblem_(svc, rel, to.class_id, start);
      if (problem) throw new Error(problem);
      var fromName = LMS.agentClassName(svc.table, rel.class_id);
      return {
        args: { student_id: student.student_id, class_id: to.class_id, from_class_id: stuStr_(rel.class_id), start_date: start },
        target: { student_id: student.student_id, student_name: stuStr_(student.name), class_name: stuStr_(to.class_name), date: start },
        before: fromName,
        after: stuStr_(to.class_name),
        text: stuStr_(student.name) + ' 반 이동: ' + fromName + ' → ' + to.class_name + ' · ' + start + '부터 (' + fromName + ' 마지막 날 ' + LMS.addDays(start, -1) + ')'
      };
    },
    run: function (svc, args) {
      return svc.api.moveStudent(args);
    },
    verify: function (svc, args, ran) {
      var rel = ran && ran.id ? stuRel_(svc, ran.id) : null;
      var open = stuOpenRegular_(svc, args.student_id);
      var ok = !!rel && stuStr_(rel.status) === '현재' && stuStr_(rel.class_id) === args.class_id &&
        !open.some(function (r) { return stuStr_(r.class_id) === args.from_class_id; });
      return { ok: ok, after: rel ? LMS.agentClassName(svc.table, rel.class_id) : '' };
    }
  },

  move_students: {
    label: '반 일괄 이동',
    preview: function (svc, args) {
      args = args || {};
      var from = stuClass_(svc, args.from_class_id);
      var to = stuClass_(svc, args.to_class_id);
      var start = stuDate_(args.date, '이동일');
      LMS.assertAgentBatch(args.student_ids, '명');
      var ids = LMS.uniqueIds(args.student_ids);
      if (!ids.length) throw new Error('옮길 학생을 골라 주세요.');
      var names = [];
      var problems = [];
      ids.forEach(function (sid) {
        var s = stuRow_(svc, sid);
        names.push(s.name);
        var rel = stuOpenRegular_(svc, sid).filter(function (r) { return stuStr_(r.class_id) === stuStr_(from.class_id); })[0];
        var problem = rel ? stuMoveProblem_(svc, rel, to.class_id, start) : '이 반의 정규 배정이 아닙니다.';
        if (problem) problems.push(s.name + ': ' + problem);
      });
      if (problems.length) throw new Error('옮기지 않았습니다.\n' + problems.join('\n'));
      return {
        args: { from_class_id: from.class_id, to_class_id: to.class_id, student_ids: ids, date: start },
        target: { student_id: '', student_name: names.join(', '), class_name: stuStr_(to.class_name), date: start },
        before: stuStr_(from.class_name),
        after: stuStr_(to.class_name),
        text: from.class_name + ' → ' + to.class_name + ' ' + ids.length + '명 이동 (' + start + '부터): ' + stuNames_(names)
      };
    },
    run: function (svc, args) {
      return svc.api.moveStudents(args);
    },
    verify: function (svc, args) {
      var bad = args.student_ids.filter(function (sid) {
        var open = stuOpenRegular_(svc, sid);
        return !open.some(function (r) { return stuStr_(r.class_id) === args.to_class_id; }) ||
          open.some(function (r) { return stuStr_(r.class_id) === args.from_class_id; });
      });
      return { ok: !bad.length, after: (args.student_ids.length - bad.length) + '명 이동' };
    }
  },

  close_student_class: {
    label: '반에서 빼기',
    preview: function (svc, args) {
      args = args || {};
      var rel = stuPickRel_(svc, args, 'open');
      if (stuStr_(rel.status) !== '현재') throw new Error('현재 반 배정이 아닙니다(' + stuStr_(rel.status) + ').');
      var end = stuDate_(args.end_date, '마지막 수업일');
      if (end < stuStr_(rel.start_date)) throw new Error('마지막 수업일이 반 시작일(' + rel.start_date + ')보다 빠릅니다. 잘못 넣은 배정이면 remove_student_class를 써 주세요.');
      var later = stuLessonOnOrAfter_(svc, rel.student_id, rel.class_id, LMS.addDays(end, 1));
      if (later) throw new Error('마지막 수업일 뒤(' + later + ')에 이 반 수업 기록이 있습니다. 날짜를 그 뒤로 잡아 주세요.');
      var name = LMS.agentStudentName(svc.table, rel.student_id);
      var cname = LMS.agentClassName(svc.table, rel.class_id);
      return {
        args: { rel_id: rel.id, end_date: end },
        target: { student_id: stuStr_(rel.student_id), student_name: name, class_name: cname, date: end },
        before: stuRelLabel_(rel),
        after: stuStr_(rel.start_date) + ' ~ ' + end,
        text: name + ' ' + cname + '에서 빼기: 마지막 수업일 ' + end + ' (배정 ' + stuRelLabel_(rel) + ')'
      };
    },
    run: function (svc, args) {
      return svc.api.closeStudentClass({ id: args.rel_id, end_date: args.end_date });
    },
    verify: function (svc, args) {
      var rel = stuRel_(svc, args.rel_id);
      var ok = !!rel && stuStr_(rel.status) === '종료' && stuStr_(rel.end_date) === args.end_date;
      return { ok: ok, after: rel ? stuRelLabel_(rel) : '' };
    }
  },

  remove_student_class: {
    label: '반 배정 삭제',
    preview: function (svc, args) {
      args = args || {};
      var rel = stuPickRel_(svc, args, 'regular');
      if (stuStr_(rel.status) === '임시') throw new Error('시험대비 임시 배정은 시험 화면에서 바꿔 주세요.');
      var sid = stuStr_(rel.student_id);
      var cid = stuStr_(rel.class_id);
      var lessons = svc.table('Lessons').filter(function (l) { return stuStr_(l.student_id) === sid && stuStr_(l.class_id) === cid; }).length;
      var items = {};
      svc.table('HomeworkItems').forEach(function (it) { if (stuStr_(it.class_id) === cid) items[stuStr_(it.item_id)] = true; });
      var checks = svc.table('HomeworkChecks').filter(function (c) { return stuStr_(c.student_id) === sid && items[stuStr_(c.item_id)]; }).length;
      if (lessons || checks) {
        throw new Error('이 반에 수업 기록 ' + lessons + '건, 숙제 체크 ' + checks + '건이 있어 배정을 삭제할 수 없습니다. close_student_class(반에서 빼기)를 써 주세요.');
      }
      var name = LMS.agentStudentName(svc.table, sid);
      var cname = LMS.agentClassName(svc.table, cid);
      return {
        args: { rel_id: rel.id },
        target: { student_id: sid, student_name: name, class_name: cname },
        before: stuRelLabel_(rel),
        after: '',
        text: name + '의 ' + cname + ' 배정(' + stuRelLabel_(rel) + ') 삭제: 이 반 수업 기록·숙제 체크 없음, 배정 이력에서도 사라집니다'
      };
    },
    run: function (svc, args) {
      return svc.api.removeStudentClass({ id: args.rel_id });
    },
    verify: function (svc, args) {
      return { ok: !stuRel_(svc, args.rel_id), after: '' };
    }
  },

  update_student_class_start: {
    label: '반 시작일 변경',
    preview: function (svc, args) {
      args = args || {};
      var rel = stuPickRel_(svc, args, 'regular');
      var start = stuDate_(args.start_date, '새 시작일');
      if (start === stuStr_(rel.start_date)) throw new Error('지금 시작일과 같습니다.');
      var p = svc.api.previewClassStartChange({ id: rel.id, start_date: start });
      if (p.problem) throw new Error(p.problem);
      var name = LMS.agentStudentName(svc.table, rel.student_id);
      var cname = LMS.agentClassName(svc.table, rel.class_id);
      var missing = p.missing_count ? ' · 이 학생 기록이 없는 수업일 ' + p.missing_count + '일이 생깁니다(' + p.missing_dates.slice(0, 5).join(', ') + (p.missing_count > 5 ? ' …' : '') + ')' : '';
      return {
        args: { rel_id: rel.id, start_date: start },
        target: { student_id: stuStr_(rel.student_id), student_name: name, class_name: cname, date: start },
        before: stuStr_(rel.start_date),
        after: start,
        text: name + ' ' + cname + ' 시작일: ' + rel.start_date + ' → ' + start + missing
      };
    },
    run: function (svc, args) {
      return svc.api.updateStudentClassStart({ id: args.rel_id, start_date: args.start_date });
    },
    verify: function (svc, args) {
      var rel = stuRel_(svc, args.rel_id);
      var after = rel ? stuStr_(rel.start_date) : '';
      return { ok: after === args.start_date, after: after };
    }
  },

  add_temp_assignment: {
    label: '시험대비 임시 배정',
    preview: function (svc, args) {
      args = args || {};
      var cls = stuClass_(svc, args.class_id);
      if (stuStr_(cls.class_type) !== '시험대비') throw new Error(cls.class_name + '은(는) 시험대비 반이 아닙니다. 정규 반은 assign_student_to_class를 써 주세요.');
      var period = LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', cls.exam_period_id);
      if (!period) throw new Error('시험대비 기간을 찾을 수 없습니다.');
      var student = stuRow_(svc, args.student_id);
      if (stuStr_(student.status) !== '재원') throw new Error(student.name + ' 학생은 재원생이 아니라 편성할 수 없습니다.');
      var start = stuStr_(args.start_date) || stuStr_(period.start_date);
      var end = stuStr_(args.end_date) || stuStr_(period.end_date);
      if (!LMS.isIsoDate(start) || !LMS.isIsoDate(end)) throw new Error('날짜를 YYYY-MM-DD로 입력해 주세요.');
      if (start < period.start_date || end > period.end_date || end < start) {
        throw new Error('날짜는 시험대비 기간(' + period.start_date + ' ~ ' + period.end_date + ') 안이어야 합니다.');
      }
      var clash = svc.table('StudentClasses').filter(function (r) {
        return stuStr_(r.status) === '임시' && stuStr_(r.student_id) === stuStr_(student.student_id) && LMS.rangesOverlap(r.start_date, r.end_date, start, end);
      })[0];
      if (clash) throw new Error(student.name + ' 학생은 그 기간에 이미 다른 시험대비 반(' + LMS.agentClassName(svc.table, clash.class_id) + ')에 배정되어 있습니다.');
      var out = { class_id: cls.class_id, student_id: student.student_id, start_date: start, end_date: end };
      var source = '';
      if (stuStr_(args.source_class_id)) {
        out.source_class_id = stuClass_(svc, args.source_class_id).class_id;
        source = LMS.agentClassName(svc.table, out.source_class_id);
      } else {
        source = stuClassNames_(svc, stuOpenRegular_(svc, student.student_id)).join(', ');
      }
      return {
        args: out,
        target: { student_id: student.student_id, student_name: stuStr_(student.name), class_name: stuStr_(cls.class_name), date: start },
        before: '',
        after: start + ' ~ ' + end,
        text: student.name + ' → 시험대비 「' + cls.class_name + '」 임시 배정 ' + start + ' ~ ' + end + (source ? ' (그동안 ' + source + ' 수업에서 빠짐)' : '')
      };
    },
    run: function (svc, args) {
      return svc.api.addTempAssignment(args);
    },
    verify: function (svc, args, ran) {
      var rel = ran && ran.id ? stuRel_(svc, ran.id) : null;
      var ok = !!rel && stuStr_(rel.status) === '임시' && stuStr_(rel.class_id) === args.class_id;
      return { ok: ok, after: rel ? stuRelLabel_(rel) : '' };
    }
  },

  end_temp_assignment: {
    label: '시험대비 조기 복귀',
    preview: function (svc, args) {
      args = args || {};
      var rel = stuPickRel_(svc, args, 'temp');
      if (stuStr_(rel.status) !== '임시') throw new Error('시험대비 임시 배정이 아닙니다.');
      var cls = stuClass_(svc, rel.class_id);
      var period = LMS.findById(svc.table('ExamPeriods'), 'exam_period_id', cls.exam_period_id);
      if (!period) throw new Error('시험대비 기간을 찾을 수 없습니다.');
      var d = stuDate_(args.date, '마지막 수업일');
      if (d < stuStr_(rel.start_date)) throw new Error('마지막 수업일이 시작일(' + rel.start_date + ')보다 빠릅니다.');
      if (d > period.end_date) throw new Error('마지막 수업일은 시험대비 기간(~' + period.end_date + ') 안이어야 합니다.');
      var name = LMS.agentStudentName(svc.table, rel.student_id);
      return {
        args: { rel_id: rel.id, date: d },
        target: { student_id: stuStr_(rel.student_id), student_name: name, class_name: stuStr_(cls.class_name), date: d },
        before: stuStr_(rel.end_date),
        after: d,
        text: name + ' 시험대비 「' + cls.class_name + '」 마지막 수업일: ' + (stuStr_(rel.end_date) || '기간 끝') + ' → ' + d + ' (다음 날부터 원래 반으로 복귀)'
      };
    },
    run: function (svc, args) {
      return svc.api.endTempAssignment(args.rel_id, args.date);
    },
    verify: function (svc, args) {
      var rel = stuRel_(svc, args.rel_id);
      var after = rel ? stuStr_(rel.end_date) : '';
      return { ok: after === args.date, after: after };
    }
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
