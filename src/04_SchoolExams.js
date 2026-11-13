/**
 * 학교 시험 일정 (SchoolExams rows): input rules, the exam view (D-day, tone, labels) and
 * upcoming-exam selection. Views, plans, agent actions and screens all read exams through
 * LMS.schoolExams so the math-exam-date D-day rule lives in one place.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

LMS.schoolExams = (function () {
  var URGENT_DAYS = 7;
  var NEAR_DAYS = 21;

  /** Last exam day; rows saved before ranges existed have only `exam_date`. */
  function lastDay(row) {
    var start = LMS.toStr(row && row.exam_date);
    var end = LMS.toStr(row && row.exam_end_date);
    return end && end >= start ? end : start;
  }

  /** Date the D-day counts toward: the math exam day when known, otherwise the first exam day. */
  function dDayDate(row) {
    return LMS.toStr(row && row.math_exam_date) || LMS.toStr(row && row.exam_date);
  }

  /** Soonest D-day date first; ties by first exam day, then school and id so the order is stable. */
  function compare(a, b) {
    return dDayDate(a).localeCompare(dDayDate(b)) ||
      LMS.toStr(a.exam_date).localeCompare(LMS.toStr(b.exam_date)) ||
      LMS.toStr(a.school).localeCompare(LMS.toStr(b.school), 'ko') ||
      LMS.toStr(a.school_exam_id).localeCompare(LMS.toStr(b.school_exam_id));
  }

  /** Dated, not over by `today`, and either in progress or its D-day date is on or before `until` ('' = no limit). */
  function dueBy(row, today, until) {
    if (!row || !row.exam_date || lastDay(row) < today) return false;
    return row.exam_date <= today || !until || dDayDate(row) <= until;
  }

  function dueRows(rows, today, days) {
    var until = days === null || days === undefined ? '' : LMS.addDays(today, days);
    return (rows || []).filter(function (r) { return dueBy(r, today, until); }).sort(compare);
  }

  function examLabel(row) {
    if (LMS.toStr(row.exam_type) === '기타') return LMS.toStr(row.title) || '기타 시험';
    return row.semester + '학기 ' + row.exam_type + '고사';
  }

  function dDayLabel(d, inProgress) {
    if (d === null) return '';
    if (inProgress && d !== 0) return '시험 중';
    if (d === 0) return 'D-day';
    return d > 0 ? 'D-' + d : 'D+' + (-d);
  }

  function dDayTone(d, inProgress) {
    if (d === null) return '';
    if (inProgress) return 'danger';
    if (d < 0) return 'muted';
    if (d <= URGENT_DAYS) return 'danger';
    if (d <= NEAR_DAYS) return 'amber';
    return '';
  }

  function mathLabel(math, start, end) {
    if (!math || !end || end === start) return '';
    var p = math.split('-').map(Number);
    return '수학 ' + p[1] + '/' + p[2];
  }

  function mathWithin(math, start, end) {
    return math && (!start || math >= start) && (!end || math <= end) ? math : '';
  }

  /**
   * The one shape screens, views and agent tools read: the stored row plus
   * exam_end_date (filled), label, d_day (null when undated), in_progress,
   * d_day_label ('D-3' · 'D-day' · '시험 중' · 'D+2'), d_day_tone ('danger' · 'amber' · 'muted' · '')
   * and math_label ('수학 11/5' for a multi-day exam with a math day, else '').
   */
  function view(row, today) {
    var start = LMS.toStr(row.exam_date);
    var end = lastDay(row);
    var math = LMS.toStr(row.math_exam_date);
    var d = start ? LMS.daysBetween(today, dDayDate(row)) : null;
    var inProgress = !!start && LMS.inRange(today, start, end);
    return Object.assign({}, row, {
      exam_end_date: end,
      math_exam_date: math,
      label: examLabel(row),
      d_day: d,
      in_progress: inProgress,
      d_day_label: dDayLabel(d, inProgress),
      d_day_tone: dDayTone(d, inProgress),
      math_label: mathLabel(math, start, end)
    });
  }

  /**
   * Exams still ahead or in progress on `today` whose D-day is within `days` (null = any),
   * soonest D-day first, as views.
   */
  function upcoming(rows, today, days) {
    return dueRows(rows, today, days).map(function (r) { return view(r, today); });
  }

  /** The soonest upcoming exam per school_key (same window and order as `upcoming`), as views. */
  function nextByKey(rows, today, days) {
    var out = {};
    dueRows(rows, today, days).forEach(function (r) {
      var k = LMS.toStr(r.school_key);
      if (!out[k]) out[k] = view(r, today);
    });
    return out;
  }

  /**
   * Form editing for the three dates: a new start pulls an empty or earlier end up to it, and a
   * math day that falls outside the range is cleared. Other keys are set as given.
   */
  function changeDate(row, key, value) {
    var next = Object.assign({}, row);
    next[key] = value;
    if (key === 'exam_date') {
      var end = LMS.toStr(row.exam_end_date);
      next.exam_end_date = !end || (value && end < value) ? value : end;
    }
    if (key === 'exam_date' || key === 'exam_end_date') {
      next.math_exam_date = mathWithin(LMS.toStr(row.math_exam_date), next.exam_date, next.exam_end_date);
    }
    return next;
  }

  function validate(data) {
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
    if (date && !LMS.isIsoDate(date)) throw new Error('시험 시작일 형식이 올바르지 않습니다.');
    var end = LMS.toStr(data.exam_end_date);
    if (end && !LMS.isIsoDate(end)) throw new Error('시험 종료일 형식이 올바르지 않습니다.');
    if (end && !date) throw new Error('시험 시작일을 입력해 주세요.');
    if (end && end < date) throw new Error('종료일이 시작일보다 빠릅니다.');
    var math = LMS.toStr(data.math_exam_date);
    if (math && !LMS.isIsoDate(math)) throw new Error('수학 시험일 형식이 올바르지 않습니다.');
    if (math && !date && !end) {
      date = math;
      end = math;
    }
    if (math && (math < date || math > (end || date))) {
      throw new Error('수학 시험일은 시험 기간 안이어야 합니다.');
    }
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
      exam_end_date: end || date,
      math_exam_date: math,
      textbook: LMS.toStr(data.textbook),
      scope: LMS.toStr(data.scope),
      memo: LMS.toStr(data.memo)
    };
  }

  return {
    validate: validate,
    changeDate: changeDate,
    view: view,
    upcoming: upcoming,
    nextByKey: nextByKey,
    lastDay: lastDay
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
