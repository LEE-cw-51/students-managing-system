/**
 * AI write actions: classes. Same shape as LMS.AGENT_WRITE_ACTIONS in 07_Agent.js
 * ({ label, preview, run, verify }); each name needs a tool in lib/mcp-tools/write-classes.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../07_Agent.js');
}

var CLS_FIELDS_ = [
  'class_name', 'grade', 'school_year', 'semester', 'teacher', 'textbook', 'weekday', 'start_time', 'end_time',
  'current_progress', 'class_homework', 'memo'
];
var CLS_SCHEDULE_FIELDS_ = ['weekday', 'start_time', 'end_time'];
var CLS_FIELD_LABELS_ = {
  class_name: '반 이름', grade: '학년', school_year: '학년도', semester: '학기', teacher: '담당', textbook: '교재',
  weekday: '요일', start_time: '시작', end_time: '종료', current_progress: '현재 진도', class_homework: '기본 숙제', memo: '메모'
};

function clsStr_(v) {
  return LMS.toStr(v);
}

function clsShort_(v) {
  var s = clsStr_(v).replace(/\s+/g, ' ');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

function clsRow_(svc, id) {
  var c = LMS.findById(svc.table('Classes'), 'class_id', clsStr_(id));
  if (!c) throw new Error('반(' + (clsStr_(id) || '없음') + ')을 찾을 수 없습니다. list_classes로 class_id를 확인해 주세요.');
  return c;
}

function clsPick_(args) {
  var out = {};
  CLS_FIELDS_.forEach(function (k) {
    if (args[k] !== undefined && args[k] !== null) out[k] = clsStr_(args[k]);
  });
  return out;
}

function clsMine_(classId) {
  return function (r) { return clsStr_(r.class_id) === clsStr_(classId); };
}

function clsHas_(args, k) {
  return args[k] !== undefined && args[k] !== null;
}

/**
 * The per-day schedule the update asks for, or null when it leaves the schedule alone.
 * `schedule` replaces it as given. weekday / start_time / end_time patch the stored slots:
 * kept days keep their own times, and a time applies to every day only when all days share
 * one time. On a class whose days differ, a time (or a new day) needs the full `schedule`.
 */
function clsNextSchedule_(cls, args) {
  if (clsHas_(args, 'schedule')) return LMS.normalizeSchedule(args.schedule);
  if (!CLS_SCHEDULE_FIELDS_.some(function (k) { return clsHas_(args, k); })) return null;
  var prev = LMS.classSchedule(cls);
  var uniform = prev.every(function (s) { return clsStr_(s.start) === clsStr_(prev[0].start) && clsStr_(s.end) === clsStr_(prev[0].end); });
  var summary = LMS.scheduleSummary(prev);
  var weekday = clsHas_(args, 'weekday') ? clsStr_(args.weekday) : summary.weekday;
  var days = LMS.parseClassWeekdays(weekday);
  if (clsHas_(args, 'weekday') && !days.length) throw new Error('요일이 올바르지 않습니다: ' + weekday);
  var perDay = '요일마다 시간이 다른 반입니다(' + LMS.scheduleLabel(prev) + '). ';
  if (clsHas_(args, 'start_time') || clsHas_(args, 'end_time')) {
    if (!uniform) throw new Error(perDay + '시간을 바꾸려면 schedule에 요일별 시작·종료 시간을 모두 넣어 주세요.');
    var start = clsHas_(args, 'start_time') ? args.start_time : summary.start_time;
    var end = clsHas_(args, 'end_time') ? args.end_time : summary.end_time;
    return LMS.normalizeSchedule(LMS.scheduleFromLegacy(weekday, start, end));
  }
  return LMS.normalizeSchedule(days.map(function (day) {
    var slot = prev.filter(function (s) { return s.day === day; })[0];
    if (slot) return slot;
    if (!uniform) throw new Error(perDay + day + '요일을 더하려면 schedule에 요일별 시작·종료 시간을 모두 넣어 주세요.');
    return { day: day, start: summary.start_time, end: summary.end_time };
  }));
}

function clsScheduleKey_(list) {
  return JSON.stringify((list || []).map(function (s) { return [clsStr_(s.day), clsStr_(s.start), clsStr_(s.end)]; }));
}

/** Update input for updateClass: the stored row with the changes; schedule (if any) wins over weekday/time. */
function clsMerged_(cls, changes, schedule) {
  var data = Object.assign({}, cls, changes);
  CLS_SCHEDULE_FIELDS_.forEach(function (k) { data[k] = cls[k]; });
  if (schedule) data.schedule = schedule;
  return data;
}

function clsOpenMembers_(svc, classId) {
  return svc.table('StudentClasses').filter(function (r) {
    return clsStr_(r.class_id) === clsStr_(classId) && clsStr_(r.status) === '현재';
  });
}

function clsNames_(names) {
  return names.length > 10 ? names.slice(0, 10).join(', ') + ' 외 ' + (names.length - 10) + '명' : names.join(', ');
}

LMS.registerAgentWriteActions({
  create_class: {
    label: '반 추가',
    preview: function (svc, args) {
      args = args || {};
      var fields = clsPick_(args);
      fields.class_type = '정규';
      fields.status = '운영';
      var input = LMS.validateClassInput(fields, false);
      var same = svc.table('Classes').filter(function (c) { return clsStr_(c.class_name) === input.class_name && clsStr_(c.status) === '운영'; });
      var label = LMS.scheduleLabel(input.schedule);
      return {
        args: fields,
        target: { class_name: input.class_name },
        before: '',
        after: input.class_name,
        text: '반 추가: 「' + input.class_name + '」 (' + [input.grade, label || '시간표 없음', input.teacher ? '담당 ' + input.teacher : '', input.textbook ? '교재 ' + input.textbook : ''].filter(Boolean).join(', ') + ')' +
          (same.length ? ' ※ 같은 이름의 운영 중인 반이 이미 있습니다(' + same.map(function (c) { return c.class_id; }).join(', ') + ')' : '')
      };
    },
    run: function (svc, args) {
      return svc.api.createClass(args);
    },
    verify: function (svc, args, ran) {
      var row = ran && ran.class_id ? LMS.findById(svc.table('Classes'), 'class_id', ran.class_id) : null;
      return { ok: !!row && clsStr_(row.class_name) === clsStr_(args.class_name), after: row ? row.class_id : '' };
    }
  },

  update_class: {
    label: '반 정보 수정',
    preview: function (svc, args) {
      args = args || {};
      var cls = clsRow_(svc, args.class_id);
      var changes = clsPick_(args);
      if (args.textbook !== undefined && args.textbook_started_on) changes.textbook_started_on = clsStr_(args.textbook_started_on);
      var schedule = clsNextSchedule_(cls, args);
      var input = LMS.validateClassInput(clsMerged_(cls, changes, schedule), true);
      var diff = [];
      var out = { class_id: cls.class_id };
      CLS_FIELDS_.forEach(function (k) {
        if (changes[k] === undefined || CLS_SCHEDULE_FIELDS_.indexOf(k) !== -1) return;
        var next = clsStr_(input[k]);
        if (clsStr_(cls[k]) === next) return;
        out[k] = next;
        diff.push(CLS_FIELD_LABELS_[k] + ' ' + (clsShort_(cls[k]) || '없음') + ' → ' + (clsShort_(next) || '없음'));
      });
      var prevSchedule = LMS.classSchedule(cls);
      if (schedule && clsScheduleKey_(input.schedule) !== clsScheduleKey_(prevSchedule)) {
        // The proposal carries the whole per-day schedule, so approval never re-derives it.
        out.schedule = input.schedule;
        diff.push('시간표 ' + (LMS.scheduleLabel(prevSchedule) || '없음') + ' → ' + (LMS.scheduleLabel(input.schedule) || '없음'));
      }
      if (!diff.length) throw new Error('바뀌는 내용이 없습니다. 바꿀 항목과 새 값을 입력해 주세요.');
      if (out.textbook !== undefined && changes.textbook_started_on) out.textbook_started_on = changes.textbook_started_on;
      return {
        args: out,
        target: { class_id: cls.class_id, class_name: clsStr_(cls.class_name) },
        before: diff.join(', '),
        after: '',
        text: '반 「' + cls.class_name + '」 정보 수정: ' + diff.join(', ')
      };
    },
    run: function (svc, args) {
      var cls = clsRow_(svc, args.class_id);
      return svc.api.updateClass(clsMerged_(cls, args, args.schedule ? LMS.normalizeSchedule(args.schedule) : null));
    },
    verify: function (svc, args) {
      var row = LMS.findById(svc.table('Classes'), 'class_id', args.class_id);
      var ok = !!row && CLS_FIELDS_.every(function (k) { return args[k] === undefined || clsStr_(row[k]) === clsStr_(args[k]); }) &&
        (!args.schedule || clsScheduleKey_(LMS.classSchedule(row)) === clsScheduleKey_(LMS.normalizeSchedule(args.schedule)));
      return { ok: ok, after: row ? clsStr_(row.class_name) : '' };
    }
  },

  close_class: {
    label: '반 종료',
    preview: function (svc, args) {
      var cls = clsRow_(svc, args && args.class_id);
      if (clsStr_(cls.status) === '종료') throw new Error('반 「' + cls.class_name + '」은(는) 이미 종료되었습니다.');
      var members = clsOpenMembers_(svc, cls.class_id);
      var names = members.map(function (r) { return LMS.agentStudentName(svc.table, r.student_id); });
      var exam = clsStr_(cls.class_type) === '시험대비';
      return {
        args: { class_id: cls.class_id },
        target: { class_id: cls.class_id, class_name: clsStr_(cls.class_name) },
        before: '운영',
        after: '종료',
        text: '반 「' + cls.class_name + '」 종료' + (exam ? ' (시험대비 반: 배정은 그대로 둠)' :
          (members.length ? ': 현재 배정 학생 ' + members.length + '명(' + clsNames_(names) + ') 배정 종료, 기록은 남음' : ': 현재 배정 학생 없음'))
      };
    },
    run: function (svc, args) {
      return svc.api.closeClass(args.class_id);
    },
    verify: function (svc, args) {
      var row = LMS.findById(svc.table('Classes'), 'class_id', args.class_id);
      var after = row ? clsStr_(row.status) : '';
      return { ok: after === '종료', after: after };
    }
  },

  delete_class: {
    label: '반 삭제',
    preview: function (svc, args) {
      var cls = clsRow_(svc, args && args.class_id);
      var cid = clsStr_(cls.class_id);
      var mine = clsMine_(cid);
      var lessons = svc.table('Lessons').filter(mine).length;
      var items = svc.table('HomeworkItems').filter(mine);
      var itemIds = {};
      items.forEach(function (it) { itemIds[clsStr_(it.item_id)] = true; });
      var checks = svc.table('HomeworkChecks').filter(function (c) { return itemIds[clsStr_(c.item_id)]; }).length;
      if (lessons || checks) {
        throw new Error('반 「' + cls.class_name + '」에 수업 기록 ' + lessons + '건, 숙제 체크 ' + checks + '건이 있어 삭제할 수 없습니다. close_class(종료)를 써 주세요.');
      }
      var rels = svc.table('StudentClasses');
      var source = rels.some(function (r) { return clsStr_(r.status) === '임시' && clsStr_(r.source_class_id) === cid && !mine(r); });
      if (source) throw new Error('시험대비 편성의 원래 반으로 쓰이는 반은 삭제할 수 없습니다. 시험대비 기간에서 먼저 배정을 바꿔 주세요.');
      var relCount = rels.filter(mine).length;
      var parts = [
        ['학생 배정', relCount],
        ['진도 계획', svc.table('ClassPlans').filter(mine).length],
        ['반 수업 기록', svc.table('ClassSessions').filter(mine).length],
        ['숙제 항목', items.length],
        ['보강', svc.table('MakeupSessions').filter(mine).length]
      ].filter(function (p) { return p[1]; }).map(function (p) { return p[0] + ' ' + p[1] + '건'; });
      var tasks = svc.table('Tasks').filter(mine).length;
      return {
        args: { class_id: cid },
        target: { class_id: cid, class_name: clsStr_(cls.class_name) },
        before: clsStr_(cls.class_name),
        after: '',
        text: '반 「' + cls.class_name + '」 삭제' + (parts.length ? ': ' + parts.join(', ') + ' 함께 삭제' : ' (딸린 기록 없음)') +
          (tasks ? ' · 할 일 ' + tasks + '건은 반 연결만 해제' : '') + ' · 되돌릴 수 없습니다'
      };
    },
    run: function (svc, args) {
      return svc.api.deleteClass(args.class_id);
    },
    verify: function (svc, args) {
      return { ok: !LMS.findById(svc.table('Classes'), 'class_id', args.class_id), after: '' };
    }
  },

  cancel_class_date: {
    label: '휴강 지정',
    preview: function (svc, args) {
      args = args || {};
      var cls = clsRow_(svc, args.class_id);
      var date = clsStr_(args.date);
      if (!LMS.isIsoDate(date)) throw new Error('휴강할 날짜를 YYYY-MM-DD로 입력해 주세요.');
      if (LMS.classCancellationOn(cls, date)) throw new Error('이미 휴강으로 지정된 날입니다.');
      if (!LMS.classMeetsOnDate(cls, date, svc.table('ExamPeriods'))) throw new Error(date + '(' + LMS.weekdayName(date) + ')은 반 「' + cls.class_name + '」의 수업일이 아닙니다.');
      var mine = clsMine_(cls.class_id);
      var onDate = function (r) { return mine(r) && clsStr_(r.lesson_date) === date; };
      if (svc.table('Lessons').some(onDate) || svc.table('ClassSessions').some(onDate)) {
        throw new Error('이미 수업 기록이 있는 날은 휴강할 수 없습니다. 기록을 먼저 지워 주세요.');
      }
      var reason = LMS.clipText(args.reason, 200);
      var count = svc.api.getClassRoster(cls.class_id, date).length;
      var plan = svc.table('ClassPlans').filter(function (p) {
        return mine(p) && clsStr_(p.period_type) === '일간' && clsStr_(p.period_key) === date;
      })[0];
      return {
        args: { class_id: cls.class_id, date: date, reason: reason },
        target: { class_id: cls.class_id, class_name: clsStr_(cls.class_name), date: date },
        before: '수업',
        after: '휴강',
        text: '반 「' + cls.class_name + '」 ' + date + '(' + LMS.weekdayName(date) + ') 휴강 지정' + (reason ? ' (사유: ' + reason + ')' : '') +
          ' · 학생 ' + count + '명' + (plan ? ' · 그날 진도 계획 「' + clsShort_(plan.title || plan.content) + '」 있음' : '')
      };
    },
    run: function (svc, args) {
      return svc.api.cancelClassDate(args);
    },
    verify: function (svc, args) {
      var row = LMS.findById(svc.table('Classes'), 'class_id', args.class_id);
      var ok = !!row && !!LMS.classCancellationOn(row, args.date);
      return { ok: ok, after: ok ? '휴강' : '' };
    }
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
