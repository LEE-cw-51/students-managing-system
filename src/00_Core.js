/**
 * Shared domain constants and pure functions.
 * Works in the browser (imported by React screens) and Node (module.exports).
 */
var LMS = LMS || {};

LMS.TZ = 'Asia/Seoul';

LMS.PREFIX = {
  student: 'STU',
  class: 'CLS',
  relation: 'REL',
  lesson: 'LES',
  monthly: 'MTH',
  note: 'NTS',
  makeup: 'MKP',
  classSession: 'CSN',
  task: 'TSK',
  plan: 'PLN',
  homeworkItem: 'HWI',
  homeworkCheck: 'HWC',
  session: 'SES',
  examPeriod: 'EXP',
  schoolExam: 'SCX',
  planDraft: 'PDR',
  unit: 'UNT'
};

LMS.TABLES = {
  Students: [
    'student_id', 'name', 'grade', 'school', 'student_phone', 'parent_phone',
    'enrollment_date', 'status', 'memo', 'created_at', 'updated_at'
  ],
  Classes: [
    'class_id', 'school_year', 'semester', 'grade', 'class_name', 'teacher',
    'weekday', 'start_time', 'end_time', 'textbook', 'current_progress',
    'class_homework', 'memo', 'status', 'created_at', 'updated_at',
    'schedule', 'class_type', 'exam_period_id', 'target_school', 'target_grade',
    'curriculum', 'cancel_dates'
  ],
  StudentClasses: [
    'id', 'student_id', 'class_id', 'start_date', 'end_date',
    'status', 'created_at', 'updated_at', 'assignment_type', 'source_class_id'
  ],
  Lessons: [
    'lesson_id', 'lesson_date', 'student_id', 'class_id', 'attendance',
    'test_status', 'test_score', 'test_max_score', 'test_difficulty',
    'assignment_completion', 'concentration', 'progress', 'homework',
    'special_note', 'student_notice', 'homework_replace_class',
    'created_at', 'updated_at'
  ],
  ClassSessionNotices: [
    'id', 'lesson_date', 'class_id', 'class_notice', 'created_at', 'updated_at'
  ],
  ClassSessions: [
    'session_id', 'lesson_date', 'class_id', 'progress', 'content',
    'test_title', 'test_max_score', 'test_difficulty', 'class_notice', 'memo',
    'created_at', 'updated_at'
  ],
  ExamPeriods: [
    'exam_period_id', 'title', 'start_date', 'end_date', 'suspended_class_ids',
    'memo', 'status', 'created_at', 'updated_at',
    'exam_year', 'exam_semester', 'exam_type', 'class_resume_dates'
  ],
  SchoolExams: [
    'school_exam_id', 'school_year', 'semester', 'exam_type', 'title', 'school', 'school_key',
    'grade', 'exam_date', 'textbook', 'scope', 'memo', 'created_at', 'updated_at'
  ],
  MonthlyReports: [
    'monthly_report_id', 'student_id', 'year', 'month', 'report_text',
    'generated_at', 'updated_at', 'status'
  ],
  CounselingNotes: [
    'note_id', 'student_id', 'kind', 'counsel_date', 'title', 'content',
    'created_at', 'updated_at', 'follow_up_date', 'follow_up_title', 'follow_up_task_id'
  ],
  MakeupSessions: [
    'makeup_id', 'makeup_date', 'start_time', 'end_time', 'kind',
    'class_id', 'student_id', 'title', 'memo', 'status', 'created_at', 'updated_at'
  ],
  Tasks: [
    'task_id', 'due_date', 'kind', 'title', 'memo', 'student_id', 'class_id',
    'status', 'source', 'created_at', 'updated_at'
  ],
  ClassPlans: [
    'plan_id', 'class_id', 'period_type', 'period_key', 'title',
    'objectives', 'content', 'materials', 'homework', 'memo',
    'created_at', 'updated_at', 'unit_ids', 'source', 'rationale', 'done_status'
  ],
  PlanDrafts: [
    'draft_id', 'class_id', 'month', 'mode', 'payload', 'warnings', 'base_version',
    'model', 'status', 'created_at', 'updated_at'
  ],
  HomeworkItems: [
    'item_id', 'lesson_date', 'class_id', 'title', 'sort_order',
    'student_id', 'created_at', 'updated_at'
  ],
  HomeworkChecks: [
    'check_id', 'item_id', 'student_id', 'status',
    'created_at', 'updated_at'
  ],
  Settings: ['key', 'value'],
  _Meta: ['prefix', 'next_seq']
};

LMS.GRADE_OPTIONS = [
  '초1', '초2', '초3', '초4', '초5', '초6',
  '중1', '중2', '중3',
  '고1', '고2', '고3',
  '기타'
];

LMS.STUDENT_STATUS = ['재원', '휴원', '퇴원'];
LMS.CLASS_STATUS = ['운영', '종료'];
LMS.REL_STATUS = ['현재', '종료', '임시'];
LMS.CLASS_TYPES = ['정규', '시험대비'];
LMS.ASSIGNMENT_TYPES = ['정규', '임시'];
LMS.EXAM_STATUS = ['준비', '진행', '종료', '취소'];
LMS.SCHOOL_EXAM_TYPES = ['중간', '기말', '기타'];
LMS.SCHEMA_VERSION = 5;
LMS.SCHEMA_META_KEY = 'SCHEMA';
LMS.TEST_STATUS = ['미실시', '실시'];
LMS.DIFFICULTY = ['상', '중', '하'];
LMS.ASSIGNMENT = ['A', 'B', 'C'];
LMS.CONCENTRATION = ['A', 'B', 'C', 'D', 'ABSENT'];
LMS.ATTENDANCE = ['출석', '결석'];
LMS.REPORT_STATUS = ['임시', '확정'];
LMS.COUNSEL_KIND = ['학생', '학부모'];
LMS.MAKEUP_KIND = ['반', '학생'];
LMS.MAKEUP_STATUS = ['예정', '완료', '취소'];
LMS.TASK_KIND = ['counsel_parent', 'counsel_student', 'homework_check', 'admin', 'other'];
LMS.TASK_STATUS = ['예정', '완료', '취소'];
LMS.TASK_SOURCE = ['manual', 'counseling'];
LMS.PLAN_PERIOD = ['일간', '주간', '월간'];
LMS.PLAN_SOURCE = ['manual', 'split', 'ai'];
LMS.PLAN_DONE_STATUS = ['완료', '일부', '못 함'];
LMS.PLAN_DRAFT_STATUS = ['대기', '적용', '폐기'];
LMS.PLAN_DRAFT_MODE = ['split', 'ai'];
LMS.SUGGESTION_KIND = ['보충과제', '클리닉', '상담', '보강'];
LMS.CURRICULUM_MAX_SESSIONS = 20;
LMS.HOMEWORK_CHECK_STATUS = ['완료', '미완료'];
LMS.WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

LMS.DEFAULT_SETTINGS = {
  academy_name: '학생 관리 시스템',
  teacher_name: '이찬우',
  contact: '010-4552-4496',
  report_greeting: '안녕하세요.',
  report_closing: '궁금하신 점이 있으시면 언제든지 문의해주시길 바랍니다.\n항상 최선을 다해 지도하겠습니다. 감사합니다.',
  assignment_A: '100~90%',
  assignment_B: '89~70%',
  assignment_C: '70% 미만',
  allowed_emails: ''
};

LMS.META_PREFIXES = ['STU', 'CLS', 'REL', 'LES', 'MTH', 'NTS', 'MKP', 'CSN', 'TSK', 'PLN', 'HWI', 'HWC', 'SES', 'EXP', 'SCX', 'PDR', 'UNT'];

LMS.DAY_INDEX = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };

LMS.isBlank = function (v) {
  return v === null || v === undefined || String(v).trim() === '';
};

LMS.toStr = function (v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
};

LMS.toNum = function (v) {
  if (LMS.isBlank(v)) return null;
  var n = Number(v);
  if (!isFinite(n)) return null;
  return n;
};

LMS.padId = function (n) {
  var s = String(Math.floor(Number(n)));
  while (s.length < 6) s = '0' + s;
  return s;
};

LMS.formatId = function (prefix, n) {
  return prefix + '_' + LMS.padId(n);
};

LMS.parseIdSeq = function (id) {
  if (!id) return 0;
  var parts = String(id).split('_');
  var n = parseInt(parts[parts.length - 1], 10);
  return isFinite(n) ? n : 0;
};

LMS.isIsoDate = function (v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(LMS.toStr(v));
};

LMS.weekdayName = function (isoDate) {
  var parts = LMS.toStr(isoDate).split('-');
  if (parts.length !== 3) return '';
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return LMS.DAY_INDEX[d.getDay()] || '';
};

LMS.formatKoreanDate = function (isoDate) {
  var raw = LMS.toStr(isoDate);
  var parts = raw.split('-');
  if (parts.length !== 3) return raw;
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var d = Number(parts[2]);
  var week = LMS.weekdayName(raw);
  return y + '년 ' + m + '월 ' + d + '일' + (week ? ' ' + week + '요일' : '');
};

LMS.classMeetsOn = function (weekdayStr, isoDate) {
  var w = LMS.toStr(weekdayStr);
  if (!w) return true;
  var name = LMS.weekdayName(isoDate);
  return w.indexOf(name) !== -1;
};

/** Ordered unique weekday names from a class weekday string like "월/수" or "화목토". */
LMS.parseClassWeekdays = function (weekdayStr) {
  var raw = LMS.toStr(weekdayStr);
  var found = [];
  LMS.WEEKDAYS.forEach(function (day) {
    if (raw.indexOf(day) !== -1) found.push(day);
  });
  return found;
};

/** Previous class meeting date strictly before isoDate for the given weekday pattern. */
LMS.previousClassMeetingDate = function (weekdayStr, isoDate) {
  var raw = LMS.toStr(isoDate);
  if (!LMS.isIsoDate(raw)) return '';
  var days = LMS.parseClassWeekdays(weekdayStr);
  if (!days.length) return '';
  var cur = LMS.addDays(raw, -1);
  for (var i = 0; i < 21; i++) {
    if (LMS.classMeetsOn(weekdayStr, cur)) return cur;
    cur = LMS.addDays(cur, -1);
  }
  return '';
};

/** Class meeting dates within [start, end] inclusive. */
LMS.classMeetingDatesInRange = function (weekdayStr, start, end) {
  return LMS.datesInRange(start, end).filter(function (date) {
    return LMS.classMeetsOn(weekdayStr, date);
  });
};

/**
 * Normalize a typed time to "HH:MM".
 * "1800" → 18:00, "930" → 09:30, "18" → 18:00, "18:3" / "183" → 18:30.
 * Returns '' for blank input and null when the value cannot be a time.
 */
LMS.normalizeTime = function (raw) {
  var text = LMS.toStr(raw).replace(/\s+/g, '');
  if (!text) return '';
  var h;
  var m;
  var parts = text.split(':');
  if (parts.length === 2) {
    if (!/^\d{1,2}$/.test(parts[0]) || !/^\d{0,2}$/.test(parts[1])) return null;
    h = Number(parts[0]);
    m = parts[1].length === 1 ? Number(parts[1]) * 10 : Number(parts[1] || 0);
  } else if (parts.length === 1 && /^\d{1,4}$/.test(text)) {
    if (text.length <= 2) {
      h = Number(text);
      m = 0;
    } else if (text.length === 3) {
      h = Number(text.slice(0, 1));
      m = Number(text.slice(1));
      if (m > 59) {
        h = Number(text.slice(0, 2));
        m = Number(text.slice(2)) * 10;
      }
    } else {
      h = Number(text.slice(0, 2));
      m = Number(text.slice(2));
    }
  } else {
    return null;
  }
  if (!isFinite(h) || !isFinite(m) || h > 23 || m > 59) return null;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
};

/** Validate and sort a per-weekday schedule: [{ day, start, end }]. */
LMS.normalizeSchedule = function (list) {
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (e) {
      list = [];
    }
  }
  var seen = {};
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (item) {
    var day = LMS.toStr(item && item.day);
    if (!day) return;
    if (LMS.WEEKDAYS.indexOf(day) === -1) throw new Error('요일이 올바르지 않습니다: ' + day);
    if (seen[day]) throw new Error(day + '요일이 중복되었습니다.');
    seen[day] = true;
    var start = LMS.normalizeTime(item.start);
    var end = LMS.normalizeTime(item.end);
    if (start === null) throw new Error(day + '요일 시작 시간이 올바르지 않습니다.');
    if (end === null) throw new Error(day + '요일 종료 시간이 올바르지 않습니다.');
    if (start && end && end <= start) {
      throw new Error(day + '요일 종료 시간이 시작 시간보다 늦어야 합니다.');
    }
    out.push({ day: day, start: start, end: end });
  });
  return out.sort(function (a, b) {
    return LMS.WEEKDAYS.indexOf(a.day) - LMS.WEEKDAYS.indexOf(b.day);
  });
};

/** Build a schedule from the legacy "월/수" + single start/end fields. */
LMS.scheduleFromLegacy = function (weekdayStr, start, end) {
  var s = LMS.normalizeTime(start);
  var e = LMS.normalizeTime(end);
  return LMS.parseClassWeekdays(weekdayStr).map(function (day) {
    return { day: day, start: s || LMS.toStr(start), end: e || LMS.toStr(end) };
  });
};

/** Legacy summary fields derived from a schedule. */
LMS.scheduleSummary = function (schedule) {
  var list = schedule || [];
  return {
    weekday: list.map(function (s) { return s.day; }).join('/'),
    start_time: list.length ? LMS.toStr(list[0].start) : '',
    end_time: list.length ? LMS.toStr(list[0].end) : ''
  };
};

/** Human label: "월 18:00–20:00 · 수 19:00–21:00" or "월/수 18:00–20:00" when uniform. */
LMS.scheduleLabel = function (schedule) {
  var list = schedule || [];
  if (!list.length) return '';
  var uniform = list.every(function (s) {
    return s.start === list[0].start && s.end === list[0].end;
  });
  var span = function (s) {
    return s.start ? s.start + (s.end ? '–' + s.end : '') : '';
  };
  if (uniform) {
    var t = span(list[0]);
    return list.map(function (s) { return s.day; }).join('/') + (t ? ' ' + t : '');
  }
  return list.map(function (s) {
    var t2 = span(s);
    return s.day + (t2 ? ' ' + t2 : '');
  }).join(' · ');
};

/** Schedule of a class row, falling back to legacy fields for unmigrated rows. */
LMS.classSchedule = function (cls) {
  if (!cls) return [];
  if (Array.isArray(cls.schedule)) return cls.schedule;
  if (typeof cls.schedule === 'string' && cls.schedule) {
    try {
      var parsed = JSON.parse(cls.schedule);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // fall through to legacy fields
    }
  }
  return LMS.scheduleFromLegacy(cls.weekday, cls.start_time, cls.end_time);
};

/** { start, end } for the class on that date, or null when it has no slot that weekday. */
LMS.classTimeOn = function (cls, isoDate) {
  var day = LMS.weekdayName(isoDate);
  var list = LMS.classSchedule(cls);
  for (var i = 0; i < list.length; i++) {
    if (list[i].day === day) return { start: LMS.toStr(list[i].start), end: LMS.toStr(list[i].end) };
  }
  return null;
};

LMS.examPeriodActive = function (period) {
  return !!period && LMS.toStr(period.status) !== '취소';
};

LMS.examPeriodCovers = function (period, isoDate) {
  if (!LMS.examPeriodActive(period)) return false;
  return LMS.inRange(isoDate, LMS.toStr(period.start_date), LMS.toStr(period.end_date));
};

LMS.suspendedClassIds = function (period) {
  var raw = period ? period.suspended_class_ids : null;
  if (Array.isArray(raw)) return raw.map(LMS.toStr);
  return LMS.toStr(raw).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
};

/** Exam period that suspends this regular class on the date, if any. */
/** Last suspended day for a class in a period (the earliest end among its moved students' placements), or '' for the period end. */
LMS.classResumeDate = function (period, classId) {
  var map = period ? period.class_resume_dates : null;
  if (typeof map === 'string') {
    try {
      map = JSON.parse(map);
    } catch (e) {
      map = null;
    }
  }
  return map && map[classId] ? LMS.toStr(map[classId]) : '';
};

LMS.classSuspensionOn = function (cls, isoDate, examPeriods) {
  var id = LMS.toStr(cls && cls.class_id);
  var list = examPeriods || [];
  for (var i = 0; i < list.length; i++) {
    if (!LMS.examPeriodCovers(list[i], isoDate) || LMS.suspendedClassIds(list[i]).indexOf(id) === -1) continue;
    // The class resumes the day after its first moved student is back.
    var last = LMS.classResumeDate(list[i], id);
    if (last && isoDate > last) continue;
    return list[i];
  }
  return null;
};

/** Inclusive date ranges overlap (blank end = open). */
LMS.rangesOverlap = function (aStart, aEnd, bStart, bEnd) {
  var as = LMS.toStr(aStart) || '0000-00-00';
  var ae = LMS.toStr(aEnd) || '9999-12-31';
  var bs = LMS.toStr(bStart) || '0000-00-00';
  var be = LMS.toStr(bEnd) || '9999-12-31';
  return as <= be && bs <= ae;
};

LMS.validateExamPeriodInput = function (data) {
  data = data || {};
  var title = LMS.toStr(data.title);
  if (!title) throw new Error('시험대비 기간 이름을 입력해 주세요.');
  var start = LMS.toStr(data.start_date);
  var end = LMS.toStr(data.end_date);
  if (!LMS.isIsoDate(start) || !LMS.isIsoDate(end)) throw new Error('시작일과 종료일을 입력해 주세요.');
  if (end < start) throw new Error('종료일이 시작일보다 빠릅니다.');
  if (LMS.daysBetween(start, end) > 62) throw new Error('시험대비 기간은 두 달을 넘을 수 없습니다.');
  var semester = LMS.toStr(data.exam_semester);
  var type = LMS.toStr(data.exam_type);
  if (type) LMS.assertEnum(type, LMS.SCHOOL_EXAM_TYPES, '시험 종류');
  return {
    exam_period_id: LMS.toStr(data.exam_period_id),
    title: title,
    start_date: start,
    end_date: end,
    exam_year: LMS.toStr(data.exam_year),
    exam_semester: semester,
    exam_type: type,
    memo: LMS.toStr(data.memo)
  };
};

/** Array stored as JSON text or as an array; [] when blank or broken. */
LMS.jsonList = function (value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      var parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
};

/** One-off cancelled meeting days on the class row: [{ date, reason, created_at }]. */
LMS.classCancelDates = function (cls) {
  return LMS.jsonList(cls && cls.cancel_dates).filter(function (c) {
    return c && LMS.isIsoDate(c.date);
  });
};

/** The class's single-day cancellation on the date, if any. */
LMS.classCancellationOn = function (cls, isoDate) {
  var list = LMS.classCancelDates(cls);
  for (var i = 0; i < list.length; i++) {
    if (LMS.toStr(list[i].date) === LMS.toStr(isoDate)) return list[i];
  }
  return null;
};

/**
 * Whether a class actually meets on the date: operating, has a slot that weekday,
 * exam classes only inside their period, regular classes not suspended by one.
 * An empty schedule means no meetings (unlike the legacy classMeetsOn).
 */
LMS.classMeetsOnDate = function (cls, isoDate, examPeriods) {
  if (!cls || LMS.toStr(cls.status) !== '운영') return false;
  if (!LMS.classTimeOn(cls, isoDate)) return false;
  if (LMS.classCancellationOn(cls, isoDate)) return false;
  if (LMS.toStr(cls.class_type) === '시험대비') {
    var period = LMS.findById(examPeriods || [], 'exam_period_id', cls.exam_period_id);
    return LMS.examPeriodCovers(period, isoDate);
  }
  return !LMS.classSuspensionOn(cls, isoDate, examPeriods);
};

/** Closest earlier date the class met (skipping suspensions), searching back limitDays. */
LMS.previousMeetingDateFor = function (cls, isoDate, examPeriods, limitDays) {
  var raw = LMS.toStr(isoDate);
  if (!LMS.isIsoDate(raw) || !LMS.classSchedule(cls).length) return '';
  var limit = limitDays || 90;
  var cur = LMS.addDays(raw, -1);
  for (var i = 0; i < limit; i++) {
    if (LMS.classMeetsOnDate(cls, cur, examPeriods)) return cur;
    cur = LMS.addDays(cur, -1);
  }
  return '';
};

/** Closest date on or after isoDate the class meets, searching forward limitDays. */
LMS.nextMeetingDateFor = function (cls, isoDate, examPeriods, limitDays) {
  var raw = LMS.toStr(isoDate);
  if (!LMS.isIsoDate(raw) || !LMS.classSchedule(cls).length) return '';
  var limit = limitDays || 90;
  var cur = raw;
  for (var i = 0; i < limit; i++) {
    if (LMS.classMeetsOnDate(cls, cur, examPeriods)) return cur;
    cur = LMS.addDays(cur, 1);
  }
  return '';
};

LMS.classMeetingDatesFor = function (cls, start, end, examPeriods) {
  return LMS.datesInRange(start, end).filter(function (date) {
    return LMS.classMeetsOnDate(cls, date, examPeriods);
  });
};

/** Whether a student-class relation covers the date (regular or temporary). */
LMS.relActiveOn = function (rel, isoDate) {
  if (!rel) return false;
  var status = LMS.toStr(rel.status);
  var start = LMS.toStr(rel.start_date);
  var end = LMS.toStr(rel.end_date);
  if (status === '종료' && !end) return false;
  if (status !== '현재' && status !== '종료' && status !== '임시') return false;
  if (start && isoDate < start) return false;
  if (end && isoDate > end) return false;
  return true;
};

/** Grouping key for exam-period classes: normalized school + grade. */
LMS.schoolGroupKey = function (school, grade) {
  var s = LMS.toStr(school).replace(/\s+/g, '').replace(/학교$/, '');
  if (!s) return '';
  return s + '|' + LMS.toStr(grade);
};

LMS.splitHomeworkLines = function (text) {
  return LMS.toStr(text).split(/\n+/).map(function (line) {
    return line.replace(/^\s*[-*·]\s*/, '').trim();
  }).filter(Boolean);
};

LMS.joinHomeworkTitles = function (items) {
  return (items || []).map(function (item) {
    return LMS.toStr(item && item.title);
  }).filter(Boolean).join('\n');
};

/** Class-shared checklist item (no student_id). */
LMS.isClassHomeworkItem = function (it) {
  return !LMS.toStr(it && it.student_id);
};

/** Lessons.homework_replace_class is stored as 'Y' when the student skips class items. */
LMS.isHomeworkReplaceClass = function (value) {
  return LMS.toStr(value) === 'Y' || value === true;
};

/**
 * Effective homework items for one student: class items (unless replace) plus that student's
 * personal items. Other students' personal items are excluded.
 */
LMS.homeworkItemsForStudent = function (items, studentId, replaceClass) {
  var sid = LMS.toStr(studentId);
  var replace = LMS.isHomeworkReplaceClass(replaceClass);
  return (items || []).filter(function (it) {
    var owner = LMS.toStr(it && it.student_id);
    if (!owner) return !replace;
    return owner === sid;
  });
};

LMS.normalizeHomeworkReplaceClass = function (value) {
  return LMS.isHomeworkReplaceClass(value) ? 'Y' : '';
};

/** Map checklist completion ratio to A/B/C (90%+ A, 70%+ B, else C). */
LMS.assignmentGradeFromChecks = function (doneCount, totalCount) {
  var total = Number(totalCount) || 0;
  if (total <= 0) return '';
  var done = Number(doneCount) || 0;
  if (done < 0) done = 0;
  if (done > total) done = total;
  var pct = (done / total) * 100;
  if (pct >= 90) return 'A';
  if (pct >= 70) return 'B';
  return 'C';
};

/**
 * 숙제 완료율 over homework check rows. Unchecked (미확인) cells have no row and are left out;
 * callers pass only rows of students who were in the item's class on its lesson date.
 * Returns { done, checked, rate }; rate is null when nothing was checked.
 */
LMS.homeworkRate = function (cells) {
  var checked = 0;
  var done = 0;
  (cells || []).forEach(function (c) {
    checked += 1;
    if (LMS.toStr(c.status) === '완료') done += 1;
  });
  return { done: done, checked: checked, rate: checked ? Math.round((done / checked) * 100) : null };
};

LMS.addDays = function (isoDate, delta) {
  var parts = LMS.toStr(isoDate).split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  d.setDate(d.getDate() + delta);
  var mm = String(d.getMonth() + 1);
  var dd = String(d.getDate());
  if (mm.length < 2) mm = '0' + mm;
  if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
};

LMS.monthRange = function (year, month) {
  var y = Number(year);
  var m = Number(month);
  var start = y + '-' + LMS.pad2(m) + '-01';
  var last = new Date(y, m, 0).getDate();
  var end = y + '-' + LMS.pad2(m) + '-' + LMS.pad2(last);
  return { start: start, end: end };
};

LMS.pad2 = function (n) {
  var s = String(n);
  return s.length < 2 ? '0' + s : s;
};

LMS.inRange = function (isoDate, start, end) {
  var v = LMS.toStr(isoDate);
  if (start && v < start) return false;
  if (end && v > end) return false;
  return true;
};

LMS.isTime = function (v) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(LMS.toStr(v));
};

LMS.nextGrade = function (grade) {
  var i = LMS.GRADE_OPTIONS.indexOf(LMS.toStr(grade));
  if (i < 0) return '';
  var next = LMS.GRADE_OPTIONS[i + 1];
  if (!next || next === '기타') return '';
  return next;
};

LMS.datesInRange = function (start, end) {
  var dates = [];
  var cur = LMS.toStr(start);
  var last = LMS.toStr(end);
  if (!LMS.isIsoDate(cur) || !LMS.isIsoDate(last) || cur > last) return dates;
  while (cur <= last) {
    dates.push(cur);
    cur = LMS.addDays(cur, 1);
  }
  return dates;
};

LMS.weekRange = function (isoDate) {
  var raw = LMS.toStr(isoDate);
  if (!LMS.isIsoDate(raw)) return { start: '', end: '' };
  var parts = raw.split('-');
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var day = d.getDay();
  var mondayOffset = day === 0 ? -6 : 1 - day;
  var start = LMS.addDays(raw, mondayOffset);
  return { start: start, end: LMS.addDays(start, 6) };
};

LMS.isYearMonth = function (v) {
  return /^\d{4}-\d{2}$/.test(LMS.toStr(v));
};

/** Normalize a date/anchor into the storage key for a plan period. */
LMS.normalizePlanPeriodKey = function (periodType, value) {
  var type = LMS.toStr(periodType);
  var raw = LMS.toStr(value);
  if (type === '일간') {
    if (!LMS.isIsoDate(raw)) {
      throw new Error('일간 계획 날짜 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
    }
    return raw;
  }
  if (type === '주간') {
    if (!LMS.isIsoDate(raw)) {
      throw new Error('주간 계획 기준일 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
    }
    return LMS.weekRange(raw).start;
  }
  if (type === '월간') {
    if (LMS.isYearMonth(raw)) return raw;
    if (LMS.isIsoDate(raw)) return raw.slice(0, 7);
    throw new Error('월간 계획 연월 형식이 올바르지 않습니다. YYYY-MM로 입력해 주세요.');
  }
  throw new Error('계획 기간 종류가 올바르지 않습니다.');
};

LMS.planPeriodRange = function (periodType, periodKey) {
  var type = LMS.toStr(periodType);
  var key = LMS.normalizePlanPeriodKey(type, periodKey);
  if (type === '일간') return { start: key, end: key, period_key: key };
  if (type === '주간') {
    var week = LMS.weekRange(key);
    return { start: week.start, end: week.end, period_key: week.start };
  }
  var parts = key.split('-');
  var range = LMS.monthRange(parts[0], parts[1]);
  return { start: range.start, end: range.end, period_key: key };
};

LMS.formatPlanPeriodLabel = function (periodType, periodKey) {
  var type = LMS.toStr(periodType);
  var meta = LMS.planPeriodRange(type, periodKey);
  if (type === '일간') return LMS.formatKoreanDate(meta.period_key);
  if (type === '주간') {
    return LMS.formatKoreanDate(meta.start) + ' ~ ' + LMS.formatKoreanDate(meta.end);
  }
  var ym = meta.period_key.split('-');
  return Number(ym[0]) + '년 ' + Number(ym[1]) + '월';
};

LMS.buildRegularClassEvents = function (classes, start, end, examPeriods) {
  var events = [];
  var dates = LMS.datesInRange(start, end);
  (classes || []).forEach(function (cls) {
    if (LMS.toStr(cls.status) !== '운영') return;
    dates.forEach(function (date) {
      if (!LMS.classMeetsOnDate(cls, date, examPeriods)) return;
      var slot = LMS.classTimeOn(cls, date) || {};
      events.push({
        event_type: LMS.toStr(cls.class_type) === '시험대비' ? '시험대비' : '정규',
        date: date,
        start_time: LMS.toStr(slot.start),
        end_time: LMS.toStr(slot.end),
        class_id: cls.class_id,
        class_name: cls.class_name,
        title: cls.class_name,
        teacher: LMS.toStr(cls.teacher)
      });
    });
  });
  return events;
};

LMS.normalizedScore = function (score, maxScore) {
  // Kept for compatibility; averages no longer use 100-point conversion.
  var max = LMS.toNum(maxScore);
  var s = LMS.toNum(score);
  if (max === null || max <= 0) return null;
  if (s === null) return null;
  return (s / max) * 100;
};

LMS.formatScoreDisplay = function (testStatus, score, maxScore) {
  if (LMS.toStr(testStatus) !== '실시') return '미실시';
  var s = LMS.toNum(score);
  var m = LMS.toNum(maxScore);
  if (s === null || m === null) return '미실시';
  return s + ' / ' + m;
};

LMS.formatAverageDisplay = function (avg) {
  if (avg === null || avg === undefined || !isFinite(Number(avg))) return '-';
  return (Math.round(Number(avg) * 10) / 10).toFixed(1);
};

/** Raw scores only when every conducted test shares the same max; otherwise not comparable. */
LMS.collectRawScoresForStats = function (lessons) {
  var entries = [];
  (lessons || []).forEach(function (row) {
    if (LMS.toStr(row.test_status) !== '실시') return;
    var s = LMS.toNum(row.test_score);
    var m = LMS.toNum(row.test_max_score);
    if (s === null || m === null || m <= 0) return;
    entries.push({ score: s, max: m });
  });
  if (!entries.length) {
    return { scores: [], max_score: null, comparable: true, test_count: 0 };
  }
  var max0 = entries[0].max;
  for (var i = 1; i < entries.length; i++) {
    if (entries[i].max !== max0) {
      return { scores: [], max_score: null, comparable: false, test_count: entries.length };
    }
  }
  return {
    scores: entries.map(function (e) { return e.score; }),
    max_score: max0,
    comparable: true,
    test_count: entries.length
  };
};

LMS.collectNormalizedScores = function (lessons) {
  return LMS.collectRawScoresForStats(lessons).scores;
};

LMS.averageOf = function (values) {
  if (!values || !values.length) return null;
  var sum = 0;
  values.forEach(function (v) { sum += v; });
  return sum / values.length;
};

LMS.median = function (values) {
  if (!values || !values.length) return null;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
};

LMS.computeScoreStats = function (scores) {
  var list = scores || [];
  var avg = LMS.averageOf(list);
  var med = LMS.median(list);
  var high = list.length ? Math.max.apply(null, list) : null;
  var low = list.length ? Math.min.apply(null, list) : null;
  return {
    count: list.length,
    average: avg,
    median: med,
    high: high,
    low: low,
    average_display: LMS.formatAverageDisplay(avg),
    median_display: LMS.formatAverageDisplay(med),
    high_display: LMS.formatAverageDisplay(high),
    low_display: LMS.formatAverageDisplay(low)
  };
};

LMS.computeDailyClassTestAverage = function (lessons) {
  var collected = LMS.collectRawScoresForStats(lessons);
  if (!collected.comparable) {
    return {
      test_count: collected.test_count,
      test_average: null,
      test_median: null,
      test_high: null,
      test_low: null,
      test_max_score: null,
      comparable: false,
      test_average_display: '-',
      test_median_display: '-',
      test_high_display: '-',
      test_low_display: '-'
    };
  }
  var stats = LMS.computeScoreStats(collected.scores);
  return {
    test_count: collected.test_count || stats.count,
    test_average: stats.average,
    test_median: stats.median,
    test_high: stats.high,
    test_low: stats.low,
    test_max_score: collected.max_score,
    comparable: true,
    test_average_display: stats.average_display,
    test_median_display: stats.median_display,
    test_high_display: stats.high_display,
    test_low_display: stats.low_display
  };
};

LMS.detectLearningSignals = function (lessons) {
  var rows = (lessons || []).slice().sort(function (a, b) {
    return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
  });
  var signals = [];

  var consecC = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (LMS.toStr(rows[i].assignment_completion) === 'C') {
      consecC += 1;
      if (consecC >= 2) {
        signals.push({
          code: 'assignment_c_streak',
          label: '과제 이행률 C 2회 연속'
        });
        break;
      }
    } else {
      break;
    }
  }

  var consecLow = 0;
  for (var j = rows.length - 1; j >= 0; j--) {
    var conc = LMS.toStr(rows[j].concentration);
    if (conc === 'D' || conc === 'ABSENT') {
      consecLow += 1;
      if (consecLow >= 2) {
        signals.push({
          code: 'concentration_low_streak',
          label: '집중도 저하 2회 연속'
        });
        break;
      }
    } else {
      break;
    }
  }

  var testLessons = rows.filter(function (row) {
    return LMS.toStr(row.test_status) === '실시' &&
      LMS.normalizedScore(row.test_score, row.test_max_score) !== null;
  });
  if (testLessons.length >= 6) {
    var recent = testLessons.slice(-3);
    var previous = testLessons.slice(-6, -3);
    var recentAvg = LMS.averageOf(recent.map(function (row) {
      return LMS.normalizedScore(row.test_score, row.test_max_score);
    }));
    var prevAvg = LMS.averageOf(previous.map(function (row) {
      return LMS.normalizedScore(row.test_score, row.test_max_score);
    }));
    if (prevAvg !== null && recentAvg !== null && prevAvg > 0) {
      var dropPct = ((prevAvg - recentAvg) / prevAvg) * 100;
      if (dropPct >= 10) {
        signals.push({
          code: 'test_score_drop',
          label: '최근 시험 평균 ' + Math.round(dropPct) + '% 하락'
        });
      }
    }
  }

  return signals;
};

/**
 * Warning badges for a student: existing learning signals plus absences, missing homework
 * and a long gap since the last counseling note.
 * ctx: { today, homeworkDates: [{ date, incomplete: bool }], lastCounselDate, enrollmentDate }
 */
LMS.studentBadges = function (lessons, ctx) {
  ctx = ctx || {};
  var rows = (lessons || []).slice().sort(function (a, b) {
    return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
  });
  var badges = [];
  var absentStreak = 0;
  for (var i = rows.length - 1; i >= 0 && LMS.toStr(rows[i].attendance) === '결석'; i--) absentStreak += 1;
  if (absentStreak >= 2) badges.push({ code: 'absent_streak', label: '결석 ' + absentStreak + '회 연속', tone: 'danger' });

  LMS.detectLearningSignals(rows).forEach(function (sig) {
    // A low-concentration streak made of absences is already covered above.
    if (sig.code === 'concentration_low_streak' && absentStreak >= 2) return;
    badges.push({ code: sig.code, label: sig.label, tone: sig.code === 'test_score_drop' ? 'warn' : 'danger' });
  });

  var hw = (ctx.homeworkDates || []).slice().sort(function (a, b) {
    return LMS.toStr(a.date).localeCompare(LMS.toStr(b.date));
  }).slice(-3);
  var missing = hw.filter(function (h) { return h.incomplete; }).length;
  if (hw.length >= 2 && missing >= 2) {
    badges.push({ code: 'homework_missing', label: '숙제 미완료 ' + missing + '회 (최근 ' + hw.length + '회 중)', tone: 'warn' });
  }

  var today = LMS.toStr(ctx.today);
  var enrolled = LMS.toStr(ctx.enrollmentDate);
  if (today && enrolled && LMS.daysBetween(enrolled, today) >= 60) {
    var last = LMS.toStr(ctx.lastCounselDate);
    var gap = last ? LMS.daysBetween(last, today) : null;
    if (gap === null || gap >= 60) {
      badges.push({ code: 'counsel_gap', label: last ? '상담 ' + gap + '일 전' : '상담 기록 없음', tone: 'muted' });
    }
  }
  return badges;
};

LMS.summarizeRecentLearning = function (lessons) {
  var rows = (lessons || []).slice().sort(function (a, b) {
    return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
  });
  var scores = LMS.collectNormalizedScores(rows);
  var stats = LMS.computeScoreStats(scores);
  var assignment = { A: 0, B: 0, C: 0 };
  var concentration = { A: 0, B: 0, C: 0, D: 0, ABSENT: 0 };
  rows.forEach(function (row) {
    var a = LMS.toStr(row.assignment_completion).charAt(0);
    if (assignment[a] !== undefined) assignment[a] += 1;
    var c = LMS.toStr(row.concentration);
    if (concentration[c] !== undefined) concentration[c] += 1;
  });
  return {
    lesson_count: rows.length,
    test_average_display: stats.average_display,
    test_count: stats.count,
    assignment: assignment,
    concentration: concentration
  };
};

LMS.computeClassSessionTestStats = LMS.computeDailyClassTestAverage;

LMS.assignmentCode = function (v) {
  var s = LMS.toStr(v).toUpperCase();
  if (!s) return '';
  if (s.charAt(0) === 'A' || s.charAt(0) === 'B' || s.charAt(0) === 'C') {
    return s.charAt(0);
  }
  return '';
};

LMS.assignmentLabel = function (code, settings) {
  var c = LMS.assignmentCode(code);
  if (!c) return '-';
  settings = settings || {};
  var range = settings['assignment_' + c] || LMS.DEFAULT_SETTINGS['assignment_' + c] || '';
  return range ? c + '(' + range + ')' : c;
};

LMS.concentrationLabel = function (v) {
  var s = LMS.toStr(v);
  if (!s) return '-';
  if (s === 'ABSENT' || s === '결석') return '결석';
  return s;
};

LMS.lessonKey = function (date, studentId, classId) {
  return LMS.toStr(date) + '|' + LMS.toStr(studentId) + '|' + LMS.toStr(classId);
};

LMS.sessionKey = function (date, classId) {
  return LMS.toStr(date) + '|' + LMS.toStr(classId);
};

LMS.uniqProgress = function (lessons) {
  var ordered = (lessons || []).slice().sort(function (a, b) {
    return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
  });
  var items = [];
  ordered.forEach(function (row) {
    var p = LMS.toStr(row.progress).replace(/\s+/g, ' ');
    if (!p) return;
    if (items.length && items[items.length - 1] === p) return;
    items.push(p);
  });
  return items.join(' → ');
};

LMS.collectSpecialNotes = function (lessons) {
  var ordered = (lessons || []).slice().sort(function (a, b) {
    return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
  });
  var notes = [];
  ordered.forEach(function (row) {
    var n = LMS.toStr(row.special_note);
    if (!n) return;
    var parts = LMS.toStr(row.lesson_date).split('-');
    var label = parts.length === 3 ? Number(parts[1]) + '/' + Number(parts[2]) : row.lesson_date;
    notes.push({ date: row.lesson_date, label: label, text: n });
  });
  return notes;
};

LMS.summarizeLessonStats = function (lessons) {
  var rows = (lessons || []).slice().sort(function (a, b) {
    return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date));
  });

  var present = 0;
  var absent = 0;
  var scores = [];
  var assign = { A: 0, B: 0, C: 0 };
  var conc = { A: 0, B: 0, C: 0, D: 0, ABSENT: 0 };

  rows.forEach(function (row) {
    if (LMS.toStr(row.attendance) === '결석') absent += 1;
    else present += 1;

    var ac = LMS.assignmentCode(row.assignment_completion);
    if (ac) assign[ac] += 1;

    var cv = LMS.toStr(row.concentration);
    if (cv === '결석') cv = 'ABSENT';
    if (conc[cv] !== undefined) conc[cv] += 1;
  });

  var collected = LMS.collectRawScoresForStats(rows);
  scores = collected.comparable ? collected.scores : [];
  var scoreStats = LMS.computeScoreStats(scores);
  if (!collected.comparable) {
    scoreStats = {
      count: collected.test_count,
      average: null,
      median: null,
      high: null,
      low: null,
      average_display: '-',
      median_display: '-',
      high_display: '-',
      low_display: '-'
    };
  }

  return {
    total_lessons: rows.length,
    present_count: present,
    absent_count: absent,
    test_count: scoreStats.count,
    test_average: scoreStats.average,
    test_median: scoreStats.median,
    test_high: scoreStats.high,
    test_low: scoreStats.low,
    assignment_A: assign.A,
    assignment_B: assign.B,
    assignment_C: assign.C,
    concentration_A: conc.A,
    concentration_B: conc.B,
    concentration_C: conc.C,
    concentration_D: conc.D,
    concentration_ABSENT: conc.ABSENT,
    progress_summary: LMS.uniqProgress(rows),
    special_notes: LMS.collectSpecialNotes(rows),
    test_average_display: scoreStats.average_display,
    test_median_display: scoreStats.median_display,
    test_high_display: scoreStats.high_display,
    test_low_display: scoreStats.low_display
  };
};

LMS.computeMonthlyStats = function (lessons, studentId, year, month) {
  var range = LMS.monthRange(year, month);
  var rows = (lessons || []).filter(function (row) {
    return LMS.toStr(row.student_id) === LMS.toStr(studentId) &&
      LMS.inRange(row.lesson_date, range.start, range.end);
  });
  return Object.assign(LMS.summarizeLessonStats(rows), {
    student_id: studentId,
    year: Number(year),
    month: Number(month)
  });
};

LMS.concentrationSummary = function (stats) {
  var a = stats.concentration_A || 0;
  var b = stats.concentration_B || 0;
  var c = stats.concentration_C || 0;
  var d = stats.concentration_D || 0;
  if (a + b + c + d === 0) return '수업 집중도 기록은 충분하지 않습니다.';
  if (a >= b + c + d) return '수업 집중도는 전반적으로 매우 양호했습니다.';
  if (a + b >= c + d) return '수업 집중도는 전반적으로 양호했습니다.';
  return '수업 집중도에 기복이 있었습니다.';
};

LMS.formatDailyTestLine = function (lesson) {
  lesson = lesson || {};
  var testLine = LMS.formatScoreDisplay(lesson.test_status, lesson.test_score, lesson.test_max_score);
  if (LMS.toStr(lesson.test_status) === '실시' && LMS.toStr(lesson.test_difficulty)) {
    testLine += ' (난이도: ' + lesson.test_difficulty + ')';
  }
  return testLine;
};

LMS.formatClassTestStatsLine = function (classStats) {
  if (!classStats || !classStats.test_count) return '';
  return '(반 평균 ' + classStats.test_average_display +
    ' · 중간값 ' + classStats.test_median_display +
    ' · 최고 ' + classStats.test_high_display +
    ' · 최저 ' + classStats.test_low_display + ')';
};

LMS.buildDailyReport = function (lesson, student, settings, classStats, classNotice) {
  settings = settings || {};
  student = student || {};
  lesson = lesson || {};
  classNotice = LMS.toStr(classNotice);
  var greeting = settings.report_greeting || LMS.DEFAULT_SETTINGS.report_greeting;
  var closing = settings.report_closing || LMS.DEFAULT_SETTINGS.report_closing;
  var teacher = settings.teacher_name || LMS.DEFAULT_SETTINGS.teacher_name;
  var contact = settings.contact || LMS.DEFAULT_SETTINGS.contact;
  var name = student.name || '학생';

  var homework = LMS.toStr(lesson.homework);
  var hwLines = homework
    ? homework.split(/\n+/).map(function (line) {
      var t = line.trim();
      if (!t) return '';
      return t.indexOf('-') === 0 ? t : '- ' + t;
    }).filter(Boolean).join('\n')
    : '-';

  var lines = [
    '<' + LMS.formatKoreanDate(lesson.lesson_date) + '>',
    greeting,
    '오늘 ' + name + ' 학생 학습 알림입니다.',
    '',
    '1. 테스트: ' + LMS.formatDailyTestLine(lesson)
  ];

  if (LMS.toStr(lesson.test_status) === '실시' && classStats && classStats.test_count) {
    lines.push('   ' + LMS.formatClassTestStatsLine(classStats));
  }

  lines.push('2. 과제 이행률: ' + LMS.assignmentLabel(lesson.assignment_completion, settings));
  lines.push('3. 학습 진도: ' + (LMS.toStr(lesson.progress) || '-'));
  lines.push('4. 과제 안내:');
  lines.push(hwLines);

  var section = 5;
  var studentNotice = LMS.toStr(lesson.student_notice);
  var feedback = LMS.toStr(lesson.special_note);
  if (classNotice) {
    lines.push(section + '. 공지사항: ' + classNotice);
    section += 1;
  }
  if (studentNotice) {
    lines.push(section + '. 개별 공지: ' + studentNotice);
    section += 1;
  }
  if (feedback) {
    lines.push(section + '. 학생 피드백: ' + feedback);
  }

  lines.push('');
  closing.split('\n').forEach(function (row) { lines.push(row); });
  lines.push('');
  lines.push(teacher + ' 드림');
  lines.push('연락처: ' + contact);
  return lines.join('\n');
};

LMS.buildMonthlyReport = function (stats, student, settings) {
  student = student || {};
  stats = stats || {};
  var month = stats.month;
  var name = student.name || '학생';
  var lines = [];
  lines.push(name + ' 학생 ' + month + '월 학습 보고서입니다.');
  lines.push('');
  lines.push(month + '월 한 달간 총 ' + (stats.total_lessons || 0) + '회 수업에 참여했습니다. (출석 ' +
    (stats.present_count || 0) + '회, 결석 ' + (stats.absent_count || 0) + '회)');

  if (stats.test_count) {
    lines.push('테스트는 ' + stats.test_count + '회 실시되었고, 평균은 ' +
      stats.test_average_display + '점입니다. (중간값 ' + stats.test_median_display +
      '점, 최고 ' + stats.test_high_display + '점, 최저 ' + stats.test_low_display + '점)');
  } else {
    lines.push('이번 달 실시된 테스트는 없습니다.');
  }

  lines.push('과제 이행률은 A ' + (stats.assignment_A || 0) + '회, B ' +
    (stats.assignment_B || 0) + '회, C ' + (stats.assignment_C || 0) + '회였습니다.');
  lines.push(LMS.concentrationSummary(stats));

  if (stats.progress_summary) {
    lines.push('학습 진도는 ' + stats.progress_summary + '까지 진행했습니다.');
  }

  if (stats.special_notes && stats.special_notes.length) {
    lines.push('');
    lines.push('학생 피드백:');
    stats.special_notes.forEach(function (n) {
      lines.push('- ' + n.label + ' ' + n.text);
    });
  }

  return lines.join('\n');
};

LMS.assertEnum = function (value, allowed, fieldLabel, optional) {
  var s = LMS.toStr(value);
  if (!s) {
    if (optional) return '';
    throw new Error(fieldLabel + '을(를) 입력해 주세요.');
  }
  if (allowed.indexOf(s) === -1) {
    throw new Error(fieldLabel + ' 값이 올바르지 않습니다.');
  }
  return s;
};

LMS.validateStudentInput = function (data, isUpdate) {
  data = data || {};
  if (isUpdate && LMS.isBlank(data.student_id)) {
    throw new Error('학생 정보를 찾을 수 없습니다.');
  }
  var name = LMS.toStr(data.name);
  if (!name) throw new Error('학생 이름을 입력해 주세요.');
  var grade = LMS.toStr(data.grade) || '기타';
  if (LMS.GRADE_OPTIONS.indexOf(grade) === -1) grade = '기타';
  var status = LMS.toStr(data.status) || '재원';
  LMS.assertEnum(status, LMS.STUDENT_STATUS, '학생 상태');
  var enrollment = LMS.toStr(data.enrollment_date);
  if (enrollment && !LMS.isIsoDate(enrollment)) {
    throw new Error('등록일 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
  }
  return {
    student_id: LMS.toStr(data.student_id),
    name: name,
    grade: grade,
    school: LMS.toStr(data.school),
    student_phone: LMS.toStr(data.student_phone),
    parent_phone: LMS.toStr(data.parent_phone),
    enrollment_date: enrollment,
    status: status,
    memo: LMS.toStr(data.memo)
  };
};

LMS.validateClassInput = function (data, isUpdate) {
  data = data || {};
  if (isUpdate && LMS.isBlank(data.class_id)) {
    throw new Error('반 정보를 찾을 수 없습니다.');
  }
  var className = LMS.toStr(data.class_name);
  if (!className) throw new Error('반 이름을 입력해 주세요.');
  var status = LMS.toStr(data.status) || '운영';
  LMS.assertEnum(status, LMS.CLASS_STATUS, '반 상태');
  var semester = LMS.toStr(data.semester);
  if (semester && ['1', '2'].indexOf(semester) === -1) {
    throw new Error('학기는 1 또는 2여야 합니다.');
  }
  var has = function (key) {
    return Object.prototype.hasOwnProperty.call(data, key) && data[key] !== undefined;
  };
  var out = {
    class_id: LMS.toStr(data.class_id),
    school_year: LMS.toStr(data.school_year),
    semester: semester,
    grade: LMS.toStr(data.grade),
    class_name: className,
    teacher: LMS.toStr(data.teacher),
    textbook: LMS.toStr(data.textbook),
    current_progress: LMS.toStr(data.current_progress),
    class_homework: LMS.toStr(data.class_homework),
    memo: LMS.toStr(data.memo),
    status: status
  };
  // Schedule is the source of truth; weekday/start/end are derived for legacy readers.
  // Updates that send neither leave the stored schedule untouched.
  if (has('schedule') || has('weekday') || !isUpdate) {
    var schedule;
    if (has('schedule')) {
      schedule = LMS.normalizeSchedule(data.schedule);
    } else {
      var start = LMS.normalizeTime(data.start_time);
      var end = LMS.normalizeTime(data.end_time);
      if (start === null) throw new Error('시작 시간 형식이 올바르지 않습니다.');
      if (end === null) throw new Error('종료 시간 형식이 올바르지 않습니다.');
      schedule = LMS.normalizeSchedule(LMS.scheduleFromLegacy(data.weekday, start, end));
      out.schedule_from_legacy = true;
    }
    var summary = LMS.scheduleSummary(schedule);
    out.schedule = schedule;
    out.weekday = summary.weekday;
    out.start_time = summary.start_time;
    out.end_time = summary.end_time;
  }
  if (has('class_type') || !isUpdate) {
    var classType = LMS.toStr(data.class_type) || '정규';
    LMS.assertEnum(classType, LMS.CLASS_TYPES, '반 종류');
    out.class_type = classType;
  }
  ['exam_period_id', 'target_school', 'target_grade'].forEach(function (key) {
    if (has(key) || !isUpdate) out[key] = LMS.toStr(data[key]);
  });
  if (has('curriculum')) {
    // Validate here; ids are assigned by the service, which knows the previous list.
    LMS.normalizeCurriculum(data.curriculum);
    out.curriculum = LMS.jsonList(data.curriculum);
  }
  return out;
};

/** Units stored on the class: [{ unit_id, textbook, title, sessions }]. */
LMS.classCurriculum = function (cls) {
  return LMS.jsonList(cls && cls.curriculum).filter(function (u) {
    return u && LMS.toStr(u.unit_id) && LMS.toStr(u.title);
  }).map(function (u) {
    return {
      unit_id: LMS.toStr(u.unit_id),
      textbook: LMS.toStr(u.textbook),
      title: LMS.toStr(u.title),
      sessions: Math.max(1, Math.min(LMS.CURRICULUM_MAX_SESSIONS, Math.round(Number(u.sessions)) || 1)),
      completed: u.completed === true || u.completed === 'true'
    };
  });
};

/**
 * Validate a curriculum list. Units keep their unit_id across renames and reorders; new or
 * duplicated rows get a fresh id from makeId (the app-wide sequence, so a deleted unit's id is
 * never handed out again while old plans may still point at it).
 */
LMS.normalizeCurriculum = function (list, makeId) {
  var rows = LMS.jsonList(list);
  if (rows.length > 200) throw new Error('단원은 200개까지 입력할 수 있습니다.');
  var seen = {};
  var out = [];
  rows.forEach(function (u, i) {
    if (!u) return;
    var title = LMS.clipText(u.title, 200);
    if (!title) return;
    var sessions = Number(u.sessions === undefined || u.sessions === '' ? 1 : u.sessions);
    if (!isFinite(sessions) || Math.round(sessions) !== sessions || sessions < 1 || sessions > LMS.CURRICULUM_MAX_SESSIONS) {
      throw new Error((i + 1) + '번째 단원의 수업 횟수는 1~' + LMS.CURRICULUM_MAX_SESSIONS + ' 사이 정수여야 합니다.');
    }
    var id = LMS.clipText(u.unit_id, 40);
    if (!id || seen[id]) id = makeId ? makeId() : '';
    if (id) seen[id] = true;
    // completed: finished before plans existed (e.g. when the list is first entered mid-term).
    out.push({
      unit_id: id, textbook: LMS.clipText(u.textbook, 100), title: title, sessions: sessions,
      completed: u.completed === true || u.completed === 'true'
    });
  });
  return out;
};

LMS.clipText = function (value, max) {
  var s = LMS.toStr(value);
  return s.length > max ? s.slice(0, max) : s;
};

/** Most frequent non-empty value (first seen wins ties); '' when none. */
LMS.modeValue = function (values) {
  var counts = {};
  var order = [];
  (values || []).forEach(function (v) {
    var key = LMS.toStr(v);
    if (!key) return;
    if (!counts[key]) {
      counts[key] = 0;
      order.push(key);
    }
    counts[key] += 1;
  });
  var best = '';
  order.forEach(function (key) {
    if (!best || counts[key] > counts[best]) best = key;
  });
  return best;
};

LMS.CLASS_SESSION_FIELDS = [
  'progress', 'content', 'test_title', 'test_max_score', 'test_difficulty', 'class_notice', 'memo'
];

/** Partial input: only the session fields present in data are returned. */
LMS.validateClassSessionInput = function (data) {
  data = data || {};
  if (!LMS.isIsoDate(data.lesson_date)) throw new Error('수업 날짜가 올바르지 않습니다.');
  if (LMS.isBlank(data.class_id)) throw new Error('반 정보를 찾을 수 없습니다.');
  var out = { lesson_date: LMS.toStr(data.lesson_date), class_id: LMS.toStr(data.class_id) };
  LMS.CLASS_SESSION_FIELDS.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(data, key) || data[key] === undefined) return;
    out[key] = LMS.toStr(data[key]);
  });
  if (out.test_max_score !== undefined && out.test_max_score !== '') {
    var max = LMS.toNum(out.test_max_score);
    if (max === null || max <= 0) throw new Error('테스트 만점은 0보다 큰 숫자여야 합니다.');
    out.test_max_score = max;
  }
  if (out.test_difficulty) LMS.assertEnum(out.test_difficulty, LMS.DIFFICULTY, '난이도', true);
  return out;
};

LMS.validateSchoolExamInput = function (data) {
  data = data || {};
  var school = LMS.toStr(data.school).replace(/\s+/g, ' ');
  if (!school) throw new Error('학교를 입력해 주세요.');
  var grade = LMS.toStr(data.grade);
  if (!grade) throw new Error('학년을 선택해 주세요.');
  var year = LMS.toStr(data.school_year);
  if (!/^\d{4}$/.test(year)) throw new Error('학년도를 4자리 숫자로 입력해 주세요.');
  var semester = LMS.toStr(data.semester);
  if (['1', '2'].indexOf(semester) === -1) throw new Error('학기는 1 또는 2여야 합니다.');
  var type = LMS.assertEnum(data.exam_type, LMS.SCHOOL_EXAM_TYPES, '시험 종류');
  var title = LMS.toStr(data.title);
  if (type === '기타' && !title) throw new Error('기타 시험은 시험 이름을 입력해 주세요.');
  var date = LMS.toStr(data.exam_date);
  if (date && !LMS.isIsoDate(date)) throw new Error('시험일 형식이 올바르지 않습니다.');
  return {
    school_exam_id: LMS.toStr(data.school_exam_id),
    school_year: year,
    semester: semester,
    exam_type: type,
    title: type === '기타' ? title : '',
    school: school,
    school_key: LMS.schoolGroupKey(school, grade),
    grade: grade,
    exam_date: date,
    textbook: LMS.toStr(data.textbook),
    scope: LMS.toStr(data.scope),
    memo: LMS.toStr(data.memo)
  };
};

/** Identity of a school exam: same year/semester/type/school+grade (and title for 기타). */
LMS.schoolExamKey = function (row) {
  return [row.school_year, row.semester, row.exam_type, row.school_key,
    LMS.toStr(row.exam_type) === '기타' ? LMS.toStr(row.title) : ''].join('|');
};

LMS.daysBetween = function (fromIso, toIso) {
  var a = LMS.toStr(fromIso).split('-').map(Number);
  var b = LMS.toStr(toIso).split('-').map(Number);
  if (a.length !== 3 || b.length !== 3) return null;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
};

LMS.validateCounselingNoteInput = function (data, isUpdate) {
  data = data || {};
  if (isUpdate && LMS.isBlank(data.note_id)) {
    throw new Error('상담일지를 찾을 수 없습니다.');
  }
  if (LMS.isBlank(data.student_id)) throw new Error('학생 정보를 찾을 수 없습니다.');
  var kind = LMS.assertEnum(data.kind, LMS.COUNSEL_KIND, '상담 종류');
  var date = LMS.toStr(data.counsel_date);
  if (!LMS.isIsoDate(date)) {
    throw new Error('상담일 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
  }
  var content = LMS.toStr(data.content);
  if (!content) throw new Error('상담 내용을 입력해 주세요.');
  var followDate = LMS.toStr(data.follow_up_date);
  if (followDate && !LMS.isIsoDate(followDate)) throw new Error('후속 조치 날짜 형식이 올바르지 않습니다.');
  return {
    note_id: LMS.toStr(data.note_id),
    student_id: LMS.toStr(data.student_id),
    kind: kind,
    counsel_date: date,
    title: LMS.toStr(data.title),
    content: content,
    follow_up_date: followDate,
    follow_up_title: followDate ? (LMS.toStr(data.follow_up_title) || (kind === '학부모' ? '학부모 후속 연락' : '학생 후속 상담')) : ''
  };
};

LMS.uniqueIds = function (values) {
  var seen = {};
  var out = [];
  (values || []).forEach(function (v) {
    var s = LMS.toStr(v);
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out;
};

LMS.makeupStudentIds = function (data) {
  data = data || {};
  var ids = [];
  if (Array.isArray(data.student_ids)) ids = ids.concat(data.student_ids);
  if (!LMS.isBlank(data.student_id)) ids.push(data.student_id);
  return LMS.uniqueIds(ids);
};

LMS.validateTaskInput = function (data, isUpdate) {
  data = data || {};
  if (isUpdate && LMS.isBlank(data.task_id)) {
    throw new Error('할 일을 찾을 수 없습니다.');
  }
  var dueDate = LMS.toStr(data.due_date);
  if (!LMS.isIsoDate(dueDate)) {
    throw new Error('예정일 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
  }
  var kind = LMS.assertEnum(data.kind, LMS.TASK_KIND, '할 일 종류');
  var title = LMS.toStr(data.title);
  if (!title) throw new Error('할 일 제목을 입력해 주세요.');
  var status = LMS.toStr(data.status) || '예정';
  LMS.assertEnum(status, LMS.TASK_STATUS, '할 일 상태');
  return {
    task_id: LMS.toStr(data.task_id),
    due_date: dueDate,
    kind: kind,
    title: title,
    memo: LMS.toStr(data.memo),
    student_id: LMS.toStr(data.student_id),
    class_id: LMS.toStr(data.class_id),
    status: status,
    source: 'manual'
  };
};

LMS.validateClassPlanInput = function (data, isUpdate) {
  data = data || {};
  if (isUpdate && LMS.isBlank(data.plan_id)) {
    throw new Error('강의 계획을 찾을 수 없습니다.');
  }
  if (LMS.isBlank(data.class_id)) throw new Error('반을 선택해 주세요.');
  var periodType = LMS.assertEnum(data.period_type, LMS.PLAN_PERIOD, '계획 기간');
  var anchor = LMS.toStr(data.period_key) || LMS.toStr(data.date) || LMS.toStr(data.anchor_date);
  var periodKey = LMS.normalizePlanPeriodKey(periodType, anchor);
  var title = LMS.toStr(data.title);
  var objectives = LMS.toStr(data.objectives);
  var content = LMS.toStr(data.content);
  var materials = LMS.toStr(data.materials);
  var homework = LMS.toStr(data.homework);
  var memo = LMS.toStr(data.memo);
  var unitIds = LMS.uniqueIds(LMS.jsonList(data.unit_ids));
  if (!title && !objectives && !content && !materials && !homework && !memo && !unitIds.length) {
    throw new Error('계획 내용을 한 곳 이상 입력해 주세요.');
  }
  var doneStatus = periodType === '일간' ? LMS.assertEnum(data.done_status, LMS.PLAN_DONE_STATUS, '진행 결과', true) : '';
  return {
    unit_ids: unitIds,
    done_status: doneStatus,
    plan_id: LMS.toStr(data.plan_id),
    class_id: LMS.toStr(data.class_id),
    period_type: periodType,
    period_key: periodKey,
    title: title,
    objectives: objectives,
    content: content,
    materials: materials,
    homework: homework,
    memo: memo
  };
};

LMS.validateMakeupSessionInput = function (data, isUpdate) {
  data = data || {};
  if (isUpdate && LMS.isBlank(data.makeup_id)) {
    throw new Error('보강 일정을 찾을 수 없습니다.');
  }
  if (!LMS.isIsoDate(data.makeup_date)) {
    throw new Error('보강일 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
  }
  var kind = LMS.assertEnum(data.kind, LMS.MAKEUP_KIND, '보강 종류');
  if (kind === '반' && LMS.isBlank(data.class_id)) {
    throw new Error('반을 선택해 주세요.');
  }
  var studentIds = kind === '학생' ? LMS.makeupStudentIds(data) : [];
  if (kind === '학생' && !studentIds.length) {
    throw new Error('학생을 선택해 주세요.');
  }
  if (isUpdate && studentIds.length > 1) {
    throw new Error('수정할 때는 학생을 한 명만 선택해 주세요.');
  }
  var start = LMS.normalizeTime(LMS.toStr(data.start_time).slice(0, 5));
  var end = LMS.normalizeTime(LMS.toStr(data.end_time).slice(0, 5));
  if (start === null) throw new Error('시작 시간 형식이 올바르지 않습니다.');
  if (end === null) throw new Error('종료 시간 형식이 올바르지 않습니다.');
  if (start && end && end <= start) throw new Error('종료 시간이 시작 시간보다 늦어야 합니다.');
  var status = LMS.toStr(data.status) || '예정';
  LMS.assertEnum(status, LMS.MAKEUP_STATUS, '보강 상태');
  return {
    makeup_id: LMS.toStr(data.makeup_id),
    makeup_date: LMS.toStr(data.makeup_date),
    start_time: start,
    end_time: end,
    kind: kind,
    class_id: LMS.toStr(data.class_id),
    student_id: studentIds[0] || '',
    student_ids: studentIds,
    title: LMS.toStr(data.title),
    memo: LMS.toStr(data.memo),
    status: status
  };
};

LMS.validateLessonInput = function (data) {
  data = data || {};
  if (!LMS.isIsoDate(data.lesson_date)) {
    throw new Error('수업일 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
  }
  if (LMS.isBlank(data.student_id)) throw new Error('학생 정보를 찾을 수 없습니다.');
  if (LMS.isBlank(data.class_id)) throw new Error('반 정보를 찾을 수 없습니다.');

  var attendance = LMS.toStr(data.attendance) || '출석';
  LMS.assertEnum(attendance, LMS.ATTENDANCE, '출석');

  var testStatus = LMS.toStr(data.test_status) || '미실시';
  LMS.assertEnum(testStatus, LMS.TEST_STATUS, '테스트 상태');

  var score = data.test_score;
  var max = data.test_max_score;
  if (testStatus === '실시') {
    var s = LMS.toNum(score);
    var m = LMS.toNum(max);
    if (s === null) throw new Error('테스트 점수는 숫자여야 합니다.');
    if (m === null) throw new Error('테스트 만점은 숫자여야 합니다.');
    if (m <= 0) throw new Error('테스트 만점은 0보다 커야 합니다.');
    score = s;
    max = m;
  } else {
    score = LMS.isBlank(score) ? '' : LMS.toNum(score);
    max = LMS.isBlank(max) ? '' : LMS.toNum(max);
    if (max !== '' && max !== null && max <= 0) {
      throw new Error('테스트 만점은 0보다 커야 합니다.');
    }
    if (score === null) score = '';
    if (max === null) max = '';
  }

  var difficulty = LMS.toStr(data.test_difficulty);
  if (difficulty) LMS.assertEnum(difficulty, LMS.DIFFICULTY, '난이도', true);

  var assignment = LMS.assignmentCode(data.assignment_completion);
  var concentration = LMS.toStr(data.concentration);
  if (concentration === '결석') concentration = 'ABSENT';
  if (concentration) LMS.assertEnum(concentration, LMS.CONCENTRATION, '수업 집중도', true);

  return {
    lesson_id: LMS.toStr(data.lesson_id),
    lesson_date: LMS.toStr(data.lesson_date),
    student_id: LMS.toStr(data.student_id),
    class_id: LMS.toStr(data.class_id),
    attendance: attendance,
    test_status: testStatus,
    test_score: score,
    test_max_score: max,
    test_difficulty: difficulty,
    assignment_completion: assignment,
    concentration: concentration,
    progress: LMS.toStr(data.progress),
    homework: LMS.toStr(data.homework),
    special_note: LMS.toStr(data.special_note),
    student_notice: LMS.toStr(data.student_notice),
    homework_replace_class: LMS.normalizeHomeworkReplaceClass(data.homework_replace_class)
  };
};

LMS.settingsFromRows = function (rows) {
  var out = {};
  Object.keys(LMS.DEFAULT_SETTINGS).forEach(function (k) {
    out[k] = LMS.DEFAULT_SETTINGS[k];
  });
  (rows || []).forEach(function (row) {
    var key = LMS.toStr(row.key);
    if (!key) return;
    out[key] = row.value === undefined || row.value === null ? '' : String(row.value);
  });
  return out;
};

LMS.settingsToRows = function (map) {
  return Object.keys(map).map(function (key) {
    return { key: key, value: map[key] };
  });
};

LMS.findById = function (rows, field, id) {
  var target = LMS.toStr(id);
  for (var i = 0; i < (rows || []).length; i++) {
    if (LMS.toStr(rows[i][field]) === target) return rows[i];
  }
  return null;
};

LMS.TABLE_PK = {
  Students: 'student_id',
  Classes: 'class_id',
  StudentClasses: 'id',
  Lessons: 'lesson_id',
  ClassSessionNotices: 'id',
  ClassSessions: 'session_id',
  ExamPeriods: 'exam_period_id',
  SchoolExams: 'school_exam_id',
  MonthlyReports: 'monthly_report_id',
  CounselingNotes: 'note_id',
  MakeupSessions: 'makeup_id',
  Tasks: 'task_id',
  ClassPlans: 'plan_id',
  PlanDrafts: 'draft_id',
  HomeworkItems: 'item_id',
  HomeworkChecks: 'check_id',
  Settings: 'key',
  _Meta: 'prefix'
};

LMS.rowValues = function (row, headers) {
  return (headers || []).map(function (h) {
    var v = row ? row[h] : '';
    return v === undefined || v === null ? '' : v;
  });
};

LMS.compactHeaderRow = function (row) {
  var out = [];
  for (var i = 0; i < (row || []).length; i++) {
    var v = LMS.toStr(row[i]);
    if (!v) break;
    out.push(v);
  }
  return out;
};

LMS.headersMatch = function (current, expected) {
  current = current || [];
  expected = expected || [];
  if (current.length !== expected.length) return false;
  for (var i = 0; i < expected.length; i++) {
    if (LMS.toStr(current[i]) !== LMS.toStr(expected[i])) return false;
  }
  return true;
};

/**
 * Compare previous sheet rows to the next in-memory table.
 * Sheet row numbers are 1-based with row 1 = headers, so data starts at 2.
 */
LMS.diffTableRows = function (prev, next, pk, headers) {
  prev = prev || [];
  next = next || [];
  if (!pk) return { needsFullRewrite: true, updates: [], appends: [] };

  var prevIndex = {};
  for (var i = 0; i < prev.length; i++) {
    var id = LMS.toStr(prev[i][pk]);
    if (!id || prevIndex[id] !== undefined) {
      return { needsFullRewrite: true, updates: [], appends: [] };
    }
    prevIndex[id] = i;
  }

  var seen = {};
  var updates = [];
  var appends = [];
  for (var j = 0; j < next.length; j++) {
    var nid = LMS.toStr(next[j][pk]);
    if (!nid || seen[nid]) {
      return { needsFullRewrite: true, updates: [], appends: [] };
    }
    seen[nid] = true;
    var values = LMS.rowValues(next[j], headers);
    var idx = prevIndex[nid];
    if (idx === undefined) {
      appends.push(values);
    } else if (JSON.stringify(LMS.rowValues(prev[idx], headers)) !== JSON.stringify(values)) {
      updates.push({ row: idx + 2, values: values });
    }
  }

  for (var pid in prevIndex) {
    if (!Object.prototype.hasOwnProperty.call(prevIndex, pid)) continue;
    if (!seen[pid]) return { needsFullRewrite: true, updates: [], appends: [] };
  }

  return { needsFullRewrite: false, updates: updates, appends: appends };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
