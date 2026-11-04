/**
 * AI write actions: lesson records (student lessons, class records, class notices). Same shape as
 * LMS.AGENT_WRITE_ACTIONS in 07_Agent.js ({ label, preview, run, verify }); each name needs a tool
 * in lib/mcp-tools/write-lessons.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../07_Agent.js');
}

var LES_STUDENT_FIELDS_ = [
  'attendance', 'test_status', 'test_score', 'test_max_score', 'test_difficulty', 'assignment_completion',
  'concentration', 'special_note', 'student_notice'
];
// Class values: an edit on one student row becomes the class record of that day.
var LES_CLASS_FIELDS_ = ['progress', 'homework'];
var LES_LABELS_ = {
  attendance: '출결', test_status: '테스트', test_score: '점수', test_max_score: '만점', test_difficulty: '난이도',
  assignment_completion: '과제', concentration: '집중도', special_note: '특이사항', student_notice: '학생 전달사항',
  progress: '진도', homework: '숙제', content: '수업 내용', test_title: '테스트 제목', test_scope: '시험 범위',
  class_notice: '반 공지', memo: '메모'
};

function lesStr_(v) {
  return LMS.toStr(v);
}

function lesShort_(v) {
  var s = lesStr_(v).replace(/\s+/g, ' ');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function lesClass_(svc, id) {
  var c = LMS.findById(svc.table('Classes'), 'class_id', lesStr_(id));
  if (!c) throw new Error('반(' + (lesStr_(id) || '없음') + ')을 찾을 수 없습니다. list_classes로 class_id를 확인해 주세요.');
  return c;
}

function lesStudent_(svc, id) {
  var s = LMS.findById(svc.table('Students'), 'student_id', lesStr_(id));
  if (!s) throw new Error('학생(' + (lesStr_(id) || '없음') + ')을 찾을 수 없습니다. search_students로 student_id를 확인해 주세요.');
  return s;
}

function lesDate_(v) {
  var d = lesStr_(v);
  if (!LMS.isIsoDate(d)) throw new Error('수업일을 YYYY-MM-DD로 입력해 주세요.');
  return d;
}

function lesPick_(args, keys) {
  var out = {};
  keys.forEach(function (k) {
    if (args[k] !== undefined && args[k] !== null) out[k] = args[k];
  });
  return out;
}

function lesExisting_(svc, date, studentId, classId) {
  var key = LMS.lessonKey(date, studentId, classId);
  return svc.table('Lessons').filter(function (r) { return LMS.lessonKey(r.lesson_date, r.student_id, r.class_id) === key; })[0] || null;
}

/** Validates like the service: a tested row without a max takes the class record's max (applyTestPaper_). */
function lesValidate_(svc, input, stored) {
  var data = Object.assign({}, input);
  var own = lesStr_(data.test_own || (stored && stored.test_own)).toUpperCase() === 'Y';
  if (lesStr_(data.test_status) === '실시' && LMS.isBlank(data.test_max_score) && !own) {
    var session = svc.table('ClassSessions').filter(function (r) {
      return lesStr_(r.lesson_date) === lesStr_(data.lesson_date) && lesStr_(r.class_id) === lesStr_(data.class_id);
    })[0];
    if (session && !LMS.isBlank(session.test_max_score)) data.test_max_score = session.test_max_score;
  }
  return LMS.validateLessonInput(data);
}

function lesSummary_(v) {
  var parts = [v.attendance];
  if (v.test_status === '실시') parts.push('테스트 ' + v.test_score + '/' + v.test_max_score);
  if (v.assignment_completion) parts.push('과제 ' + v.assignment_completion);
  if (v.concentration) parts.push('집중도 ' + v.concentration);
  if (v.special_note) parts.push('특이사항 「' + lesShort_(v.special_note) + '」');
  return parts.join(', ');
}

function lesSame_(a, b) {
  var x = LMS.toNum(a);
  var y = LMS.toNum(b);
  if (x !== null && y !== null) return x === y;
  return lesStr_(a) === lesStr_(b);
}

function lesHomework_(v) {
  return LMS.joinHomeworkTitles(LMS.splitHomeworkLines(v).map(function (t) { return { title: t }; }));
}

/**
 * Class values as stored after afterLessonsSaved: the row carries the day's class progress
 * (or its own) and the homework text of the checklist, so compare the row; a row on the class
 * progress must also match the class record.
 */
function lesClassFieldsOk_(svc, row, args) {
  if (args.homework !== undefined && lesHomework_(row.homework) !== lesHomework_(args.homework)) return false;
  if (args.progress === undefined) return true;
  if (!lesSame_(row.progress, args.progress)) return false;
  if (lesStr_(row.progress_own) === 'Y') return true;
  return lesSame_(svc.api.getClassSession(row.lesson_date, row.class_id).progress, args.progress);
}

/**
 * Student fields of a saved row that differ from what the input gave, normalized like
 * saveLessonsBatch (save_lesson / save_lessons_batch). Attendance defaults to 출석.
 * Untested rows: the class record clears test max / difficulty, so those are not compared.
 */
function lesRowMismatch_(row, item) {
  if (!row) return ['missing'];
  var v;
  try {
    v = LMS.validateLessonInput(Object.assign({}, row, item));
  } catch (e) {
    return ['invalid'];
  }
  var bad = lesStr_(row.attendance) === (lesStr_(item.attendance) || '출석') ? [] : ['attendance'];
  return bad.concat(Object.keys(item).filter(function (k) {
    if (k === 'attendance' || LES_STUDENT_FIELDS_.indexOf(k) === -1) return false;
    if ((k === 'test_max_score' || k === 'test_difficulty') && v.test_status !== '실시') return false;
    return !lesSame_(row[k], v[k]);
  }));
}

function lesNames_(names) {
  return names.length > 10 ? names.slice(0, 10).join(', ') + ' 외 ' + (names.length - 10) + '명' : names.join(', ');
}

LMS.registerAgentWriteActions({
  save_lesson: {
    label: '수업 기록 추가',
    preview: function (svc, args) {
      args = args || {};
      var student = lesStudent_(svc, args.student_id);
      var cls = lesClass_(svc, args.class_id);
      var date = lesDate_(args.lesson_date);
      var prev = lesExisting_(svc, date, student.student_id, cls.class_id);
      if (prev) throw new Error(student.name + ' 학생의 ' + date + ' ' + cls.class_name + ' 수업 기록(' + prev.lesson_id + ')이 이미 있습니다. update_lesson으로 고쳐 주세요.');
      var out = Object.assign({ student_id: student.student_id, class_id: cls.class_id, lesson_date: date }, lesPick_(args, LES_STUDENT_FIELDS_));
      var v = lesValidate_(svc, out, null);
      var inClass = svc.api.getClassRoster(cls.class_id, date).some(function (s) { return lesStr_(s.student_id) === lesStr_(student.student_id); });
      return {
        args: out,
        target: { student_id: student.student_id, student_name: lesStr_(student.name), class_name: lesStr_(cls.class_name), date: date },
        before: '',
        after: lesSummary_(v),
        text: student.name + ' · ' + date + ' ' + cls.class_name + ' 수업 기록 추가: ' + lesSummary_(v) +
          (inClass ? '' : ' ※ 이 날 이 반 명단에 없는 학생입니다')
      };
    },
    run: function (svc, args) {
      return svc.api.saveLesson(args);
    },
    verify: function (svc, args, ran) {
      var row = ran && ran.lesson_id ? LMS.findById(svc.table('Lessons'), 'lesson_id', ran.lesson_id) : null;
      return { ok: !lesRowMismatch_(row, args).length, after: row ? row.lesson_id : '' };
    }
  },

  update_lesson: {
    label: '수업 기록 수정',
    preview: function (svc, args) {
      args = args || {};
      var row = LMS.findById(svc.table('Lessons'), 'lesson_id', lesStr_(args.lesson_id));
      if (!row) throw new Error('수업 기록(' + (lesStr_(args.lesson_id) || '없음') + ')을 찾을 수 없습니다. get_student_lessons로 lesson_id를 확인해 주세요.');
      var changes = lesPick_(args, LES_STUDENT_FIELDS_.concat(LES_CLASS_FIELDS_));
      var v = lesValidate_(svc, Object.assign({}, row, changes), row);
      var out = { lesson_id: row.lesson_id };
      var diff = [];
      Object.keys(changes).forEach(function (k) {
        if (lesSame_(row[k], v[k])) return;
        out[k] = v[k];
        diff.push(LES_LABELS_[k] + ' ' + (lesShort_(row[k]) || '없음') + ' → ' + (lesShort_(v[k]) || '없음'));
      });
      if (!diff.length) throw new Error('바뀌는 내용이 없습니다. 바꿀 항목과 새 값을 입력해 주세요.');
      var name = LMS.agentStudentName(svc.table, row.student_id);
      var cname = LMS.agentClassName(svc.table, row.class_id);
      var classWide = LES_CLASS_FIELDS_.some(function (k) { return out[k] !== undefined; });
      return {
        args: out,
        target: { student_id: lesStr_(row.student_id), student_name: name, class_name: cname, date: lesStr_(row.lesson_date) },
        before: diff.join(', '),
        after: '',
        text: name + ' · ' + row.lesson_date + ' ' + cname + ' 수업 기록 수정: ' + diff.join(', ') +
          (classWide ? ' (진도·숙제는 반 기록이라 그날 반 학생 모두에게 반영)' : '')
      };
    },
    run: function (svc, args) {
      return svc.api.updateLesson(args);
    },
    verify: function (svc, args) {
      var row = LMS.findById(svc.table('Lessons'), 'lesson_id', args.lesson_id);
      var ok = !!row && LES_STUDENT_FIELDS_.every(function (k) { return args[k] === undefined || lesSame_(row[k], args[k]); }) &&
        lesClassFieldsOk_(svc, row, args);
      return { ok: ok, after: row ? lesSummary_(row) : '' };
    }
  },

  save_lessons_batch: {
    label: '수업 기록 일괄 저장',
    preview: function (svc, args) {
      args = args || {};
      var cls = lesClass_(svc, args.class_id);
      var date = lesDate_(args.lesson_date);
      var list = Array.isArray(args.items) ? args.items : [];
      if (!list.length) throw new Error('저장할 학생 기록(items)을 하나 이상 넣어 주세요.');
      LMS.assertAgentBatch(list, '명');
      var seen = {};
      var fresh = [];
      var overwrite = [];
      var absent = [];
      var items = list.map(function (it) {
        var student = lesStudent_(svc, it && it.student_id);
        if (seen[student.student_id]) throw new Error(student.name + ' 학생이 두 번 들어 있습니다.');
        seen[student.student_id] = true;
        var item = Object.assign({ student_id: student.student_id }, lesPick_(it, LES_STUDENT_FIELDS_));
        var prev = lesExisting_(svc, date, student.student_id, cls.class_id);
        var v = lesValidate_(svc, Object.assign({ class_id: cls.class_id, lesson_date: date }, item), prev);
        (prev ? overwrite : fresh).push(student.name);
        if (v.attendance === '결석') absent.push(student.name);
        return item;
      });
      var out = { class_id: cls.class_id, lesson_date: date, items: items };
      if (args.class_notice !== undefined && args.class_notice !== null) out.class_notice = lesStr_(args.class_notice);
      var parts = [];
      if (fresh.length) parts.push('새로 ' + fresh.length + '명(' + lesNames_(fresh) + ')');
      if (overwrite.length) parts.push('덮어쓰기 ' + overwrite.length + '명(' + lesNames_(overwrite) + ', 넣지 않은 항목은 비워짐)');
      return {
        args: out,
        target: { class_id: cls.class_id, class_name: lesStr_(cls.class_name), date: date },
        before: overwrite.join(', '),
        after: items.length + '명',
        text: cls.class_name + ' ' + date + ' 수업 기록 ' + items.length + '명 저장: ' + parts.join(', ') +
          (absent.length ? ' · 결석 ' + absent.length + '명(' + lesNames_(absent) + ')' : '') +
          (out.class_notice !== undefined ? ' · 반 공지 「' + lesShort_(out.class_notice) + '」' : '')
      };
    },
    run: function (svc, args) {
      var payload = {
        items: args.items.map(function (it) { return Object.assign({}, it, { class_id: args.class_id, lesson_date: args.lesson_date }); })
      };
      if (args.class_notice !== undefined) payload.class_notice = args.class_notice;
      return svc.api.saveLessonsBatch(payload);
    },
    verify: function (svc, args) {
      var bad = args.items.filter(function (it) {
        return lesRowMismatch_(lesExisting_(svc, args.lesson_date, it.student_id, args.class_id), it).length > 0;
      });
      var noticeOk = args.class_notice === undefined ||
        svc.api.getClassSessionNotice(args.lesson_date, args.class_id) === lesStr_(args.class_notice);
      return { ok: !bad.length && noticeOk, after: (args.items.length - bad.length) + '명 저장' + (noticeOk ? '' : ' · 반 공지 다름') };
    }
  },

  save_class_session: {
    label: '반 수업 기록',
    preview: function (svc, args) {
      args = args || {};
      var cls = lesClass_(svc, args.class_id);
      var date = lesDate_(args.lesson_date);
      var fields = lesPick_(args, LMS.CLASS_SESSION_FIELDS);
      var input = LMS.validateClassSessionInput(Object.assign({ lesson_date: date, class_id: cls.class_id }, fields));
      var before = svc.api.getClassSession(date, cls.class_id);
      var diff = [];
      var out = { lesson_date: date, class_id: cls.class_id };
      LMS.CLASS_SESSION_FIELDS.forEach(function (k) {
        if (input[k] === undefined || lesSame_(before[k], input[k])) return;
        out[k] = input[k];
        diff.push(LES_LABELS_[k] + ' ' + (lesShort_(before[k]) || '없음') + ' → ' + (lesShort_(input[k]) || '없음'));
      });
      if (!diff.length) throw new Error('바뀌는 내용이 없습니다. 바꿀 항목과 새 값을 입력해 주세요.');
      var lessons = svc.table('Lessons').filter(function (r) {
        return lesStr_(r.lesson_date) === date && lesStr_(r.class_id) === lesStr_(cls.class_id);
      }).length;
      return {
        args: out,
        target: { class_id: cls.class_id, class_name: lesStr_(cls.class_name), date: date },
        before: diff.join(', '),
        after: '',
        text: cls.class_name + ' ' + date + ' 반 수업 기록: ' + diff.join(', ') + (lessons ? ' · 그날 학생 기록 ' + lessons + '건에 반영' : '')
      };
    },
    run: function (svc, args) {
      return svc.api.saveClassSession(args);
    },
    verify: function (svc, args) {
      var row = svc.api.getClassSession(args.lesson_date, args.class_id);
      var ok = LMS.CLASS_SESSION_FIELDS.every(function (k) { return args[k] === undefined || lesSame_(row[k], args[k]); });
      return { ok: ok, after: row.session_id || '' };
    }
  },

  save_class_session_notice: {
    label: '반 공지',
    preview: function (svc, args) {
      args = args || {};
      var cls = lesClass_(svc, args.class_id);
      var date = lesDate_(args.lesson_date);
      var text = lesStr_(args.text);
      var before = svc.api.getClassSessionNotice(date, cls.class_id);
      if (before === text) throw new Error('지금 공지와 같습니다.');
      return {
        args: { class_id: cls.class_id, lesson_date: date, text: text },
        target: { class_id: cls.class_id, class_name: lesStr_(cls.class_name), date: date },
        before: before,
        after: text,
        text: cls.class_name + ' ' + date + ' 반 공지' + (text ? ': 「' + (lesShort_(before) || '없음') + '」 → 「' + lesShort_(text) + '」' : ' 삭제: 「' + lesShort_(before) + '」')
      };
    },
    run: function (svc, args) {
      return svc.api.saveClassSessionNotice(args.lesson_date, args.class_id, args.text);
    },
    verify: function (svc, args) {
      var after = svc.api.getClassSessionNotice(args.lesson_date, args.class_id);
      return { ok: after === args.text, after: after };
    }
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
