/**
 * AI write actions: homework (class checklist, personal items, checks). Same shape as
 * LMS.AGENT_WRITE_ACTIONS in 07_Agent.js ({ label, preview, run, verify }); each name needs a tool
 * in lib/mcp-tools/write-homework.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../07_Agent.js');
}

function hwStr_(v) {
  return LMS.toStr(v);
}

function hwClass_(svc, id) {
  var c = LMS.findById(svc.table('Classes'), 'class_id', hwStr_(id));
  if (!c) throw new Error('반(' + (hwStr_(id) || '없음') + ')을 찾을 수 없습니다. list_classes로 class_id를 확인해 주세요.');
  return c;
}

function hwStudent_(svc, id) {
  var s = LMS.findById(svc.table('Students'), 'student_id', hwStr_(id));
  if (!s) throw new Error('학생(' + (hwStr_(id) || '없음') + ')을 찾을 수 없습니다. search_students로 student_id를 확인해 주세요.');
  return s;
}

function hwDate_(v, label) {
  var d = hwStr_(v);
  if (!LMS.isIsoDate(d)) throw new Error((label || '숙제 낸 날') + '을(를) YYYY-MM-DD로 입력해 주세요.');
  return d;
}

function hwTitles_(list) {
  if (!Array.isArray(list)) return null;
  LMS.assertAgentBatch(list, '개');
  return list.map(function (t) { return hwStr_(t && typeof t === 'object' ? t.title : t); }).filter(Boolean);
}

function hwList_(titles) {
  return titles.length ? '[' + titles.join(' / ') + ']' : '없음';
}

function hwSameList_(a, b) {
  return a.length === b.length && a.every(function (t, i) { return t === b[i]; });
}

/**
 * Checks dropped when the owner's stored items are replaced by `titles`: same slot matching as
 * replaceHomeworkItems_ (same title first, else the next unused slot is renamed).
 */
function hwDroppedChecks_(svc, date, classId, studentId, titles) {
  var unused = svc.table('HomeworkItems').filter(function (r) {
    return hwStr_(r.lesson_date) === date && hwStr_(r.class_id) === classId && hwStr_(r.student_id) === hwStr_(studentId);
  }).sort(function (a, b) {
    return ((Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)) || hwStr_(a.item_id).localeCompare(hwStr_(b.item_id));
  });
  titles.forEach(function (t) {
    for (var i = 0; i < unused.length; i++) {
      if (hwStr_(unused[i].title) === t) { unused.splice(i, 1); return; }
    }
    if (unused.length) unused.shift();
  });
  var dropped = {};
  unused.forEach(function (r) { dropped[hwStr_(r.item_id)] = true; });
  return svc.table('HomeworkChecks').filter(function (c) { return dropped[hwStr_(c.item_id)]; }).length;
}

function hwLessonRow_(svc, date, classId, studentId) {
  var key = LMS.lessonKey(date, studentId, classId);
  return svc.table('Lessons').filter(function (r) { return LMS.lessonKey(r.lesson_date, r.student_id, r.class_id) === key; })[0] || null;
}

/** The item a check points at: item_id, else the title among the student's items, else index into class items. */
function hwFindItem_(svc, items, date, classId, studentId, check) {
  var id = hwStr_(check.item_id);
  if (id) return items.filter(function (it) { return hwStr_(it.item_id) === id; })[0] || null;
  var title = hwStr_(check.title);
  if (title) {
    var row = hwLessonRow_(svc, date, classId, studentId);
    return LMS.homeworkItemsForStudent(items, studentId, row && row.homework_replace_class).filter(function (it) {
      return hwStr_(it.title) === title;
    })[0] || null;
  }
  if (check.index !== undefined && check.index !== null && check.index !== '') {
    return items.filter(LMS.isClassHomeworkItem)[Number(check.index)] || null;
  }
  return null;
}

LMS.registerAgentWriteActions({
  save_session_homework: {
    label: '반 숙제',
    preview: function (svc, args) {
      args = args || {};
      var cls = hwClass_(svc, args.class_id);
      var date = hwDate_(args.lesson_date);
      var titles = hwTitles_(args.titles);
      if (!titles) throw new Error('titles에 숙제 목록을 넣어 주세요(빈 목록이면 그날 반 숙제를 모두 지웁니다).');
      var before = svc.api.getSessionHomework(date, cls.class_id).class_items.map(function (it) { return hwStr_(it.title); });
      if (hwSameList_(before, titles)) throw new Error('지금 반 숙제와 같습니다.');
      var dropped = hwDroppedChecks_(svc, date, hwStr_(cls.class_id), '', titles);
      return {
        args: { class_id: cls.class_id, lesson_date: date, titles: titles },
        target: { class_id: cls.class_id, class_name: hwStr_(cls.class_name), date: date },
        before: hwList_(before),
        after: hwList_(titles),
        text: cls.class_name + ' ' + date + ' 반 숙제: ' + hwList_(before) + ' → ' + hwList_(titles) +
          (dropped ? ' · 빠지는 항목의 숙제 체크 ' + dropped + '건 삭제' : '') + ' · 그날 학생 기록의 숙제 칸도 바뀜'
      };
    },
    run: function (svc, args) {
      return svc.api.saveSessionHomework({ lesson_date: args.lesson_date, class_id: args.class_id, titles: args.titles });
    },
    verify: function (svc, args) {
      var stored = svc.table('HomeworkItems').filter(function (r) {
        return hwStr_(r.lesson_date) === args.lesson_date && hwStr_(r.class_id) === args.class_id && !hwStr_(r.student_id);
      }).sort(function (a, b) { return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0); }).map(function (r) { return hwStr_(r.title); });
      return { ok: hwSameList_(stored, args.titles), after: hwList_(stored) };
    }
  },

  save_homework_checks: {
    label: '숙제 체크',
    preview: function (svc, args) {
      args = args || {};
      var cls = hwClass_(svc, args.class_id);
      var cid = hwStr_(cls.class_id);
      var date = hwDate_(args.lesson_date);
      var checkDate = hwStr_(args.check_date);
      if (checkDate && !LMS.isIsoDate(checkDate)) throw new Error('확인일을 YYYY-MM-DD로 입력해 주세요.');
      var session = svc.api.getSessionHomework(date, cid);
      if (!session.items.length) throw new Error(cls.class_name + ' ' + date + '에 낸 숙제 항목이 없습니다. 숙제 낸 날(lesson_date)을 확인하거나 save_session_homework로 먼저 정해 주세요.');
      var list = Array.isArray(args.checks) ? args.checks : [];
      if (!list.length) throw new Error('체크할 항목(checks)을 하나 이상 넣어 주세요.');
      LMS.assertAgentBatch(list, '건', LMS.AGENT_CHECKS_MAX);
      var lines = [];
      var checks = list.map(function (c) {
        c = c || {};
        var student = hwStudent_(svc, c.student_id);
        var item = hwFindItem_(svc, session.items, date, cid, student.student_id, c);
        if (!item) throw new Error(student.name + ': 숙제 항목(' + (hwStr_(c.title) || hwStr_(c.item_id) || c.index) + ')을 찾을 수 없습니다. 그날 숙제: ' + hwList_(session.items.map(function (it) { return it.title; })));
        var owner = hwStr_(item.student_id);
        if (owner && owner !== hwStr_(student.student_id)) throw new Error('다른 학생의 개인 숙제는 확인할 수 없습니다.');
        var raw = hwStr_(c.status);
        var status = raw ? LMS.homeworkGrade(raw) : '';
        if (raw && !status) throw new Error('숙제 등급은 A부터 F까지입니다.');
        var prev = item.item_id ? session.checks.filter(function (k) {
          return hwStr_(k.item_id) === hwStr_(item.item_id) && hwStr_(k.student_id) === hwStr_(student.student_id);
        })[0] : null;
        lines.push(student.name + ' 「' + item.title + '」 ' + (prev ? prev.status : '미확인') + ' → ' + (status || '미확인'));
        var out = { student_id: student.student_id, title: hwStr_(item.title), status: status };
        if (item.item_id) out.item_id = hwStr_(item.item_id);
        return out;
      });
      var out = { class_id: cid, lesson_date: date, checks: checks };
      if (checkDate) out.check_date = checkDate;
      return {
        args: out,
        target: { class_id: cid, class_name: hwStr_(cls.class_name), date: date },
        before: '',
        after: checks.length + '건',
        text: cls.class_name + ' ' + date + ' 숙제 체크 ' + checks.length + '건: ' +
          (lines.length > 10 ? lines.slice(0, 10).join(', ') + ' 외 ' + (lines.length - 10) + '건' : lines.join(', ')) +
          ' · 확인한 수업일 학생 기록의 과제 등급도 다시 계산'
      };
    },
    run: function (svc, args) {
      return svc.api.saveHomeworkChecks(args);
    },
    verify: function (svc, args) {
      var session = svc.api.getSessionHomework(args.lesson_date, args.class_id);
      var bad = args.checks.filter(function (c) {
        var item = hwFindItem_(svc, session.items, args.lesson_date, args.class_id, c.student_id, c.item_id ? { item_id: c.item_id } : { title: c.title });
        if (!item) return true;
        var row = session.checks.filter(function (k) {
          return hwStr_(k.item_id) === hwStr_(item.item_id) && hwStr_(k.student_id) === hwStr_(c.student_id);
        })[0];
        return (row ? hwStr_(row.status) : '') !== c.status;
      });
      return { ok: !bad.length, after: (args.checks.length - bad.length) + '건 반영' };
    }
  },

  save_student_homework_items: {
    label: '개인 숙제',
    preview: function (svc, args) {
      args = args || {};
      var cls = hwClass_(svc, args.class_id);
      var cid = hwStr_(cls.class_id);
      var student = hwStudent_(svc, args.student_id);
      var sid = hwStr_(student.student_id);
      var date = hwDate_(args.lesson_date);
      var titles = hwTitles_(args.titles);
      var hasReplace = args.replace_class !== undefined && args.replace_class !== null;
      if (!titles && !hasReplace) throw new Error('titles(개인 숙제 목록) 또는 replace_class를 넣어 주세요.');
      var before = svc.api.getSessionHomework(date, cid).items.filter(function (it) { return hwStr_(it.student_id) === sid; }).map(function (it) { return hwStr_(it.title); });
      var lesson = hwLessonRow_(svc, date, cid, sid);
      var prevReplace = LMS.isHomeworkReplaceClass(lesson && lesson.homework_replace_class);
      var replace = hasReplace ? (args.replace_class === true || hwStr_(args.replace_class) === 'Y' || hwStr_(args.replace_class) === 'true') : prevReplace;
      if (hasReplace && replace !== prevReplace && !lesson) throw new Error(student.name + ' 학생의 ' + date + ' ' + cls.class_name + ' 수업 기록이 없어 반 숙제 대체 여부를 저장할 수 없습니다. 먼저 수업 기록을 만들어 주세요.');
      var parts = [];
      var dropped = 0;
      if (titles && !hwSameList_(before, titles)) {
        parts.push('개인 숙제 ' + hwList_(before) + ' → ' + hwList_(titles));
        dropped = hwDroppedChecks_(svc, date, cid, sid, titles);
      }
      if (replace !== prevReplace) parts.push(replace ? '반 숙제 대신 개인 숙제만' : '반 숙제도 함께');
      if (!parts.length) throw new Error('바뀌는 내용이 없습니다.');
      var out = { class_id: cid, student_id: sid, lesson_date: date };
      if (titles) out.titles = titles;
      if (hasReplace) out.replace_class = replace;
      return {
        args: out,
        target: { student_id: sid, student_name: hwStr_(student.name), class_name: hwStr_(cls.class_name), date: date },
        before: hwList_(before),
        after: titles ? hwList_(titles) : '',
        text: student.name + ' · ' + cls.class_name + ' ' + date + ': ' + parts.join(', ') + (dropped ? ' · 빠지는 항목의 숙제 체크 ' + dropped + '건 삭제' : '')
      };
    },
    run: function (svc, args) {
      var data = { lesson_date: args.lesson_date, class_id: args.class_id, student_id: args.student_id };
      if (args.titles) data.titles = args.titles;
      if (args.replace_class !== undefined) data.replace_class = args.replace_class ? 'Y' : '';
      return svc.api.saveStudentHomeworkItems(data);
    },
    verify: function (svc, args) {
      var titles = svc.api.getSessionHomework(args.lesson_date, args.class_id).items.filter(function (it) {
        return hwStr_(it.student_id) === args.student_id;
      }).map(function (it) { return hwStr_(it.title); });
      var ok = !args.titles || hwSameList_(titles, args.titles);
      if (ok && args.replace_class !== undefined) {
        var lesson = hwLessonRow_(svc, args.lesson_date, args.class_id, args.student_id);
        ok = !lesson || LMS.isHomeworkReplaceClass(lesson.homework_replace_class) === !!args.replace_class;
      }
      return { ok: ok, after: hwList_(titles) };
    }
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
