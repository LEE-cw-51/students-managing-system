/**
 * Shared domain constants and pure functions.
 * Works in Apps Script (global) and Node (module.exports).
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
  classSession: 'CSN'
};

LMS.TABLES = {
  Students: [
    'student_id', 'name', 'grade', 'school', 'student_phone', 'parent_phone',
    'enrollment_date', 'status', 'memo', 'created_at', 'updated_at'
  ],
  Classes: [
    'class_id', 'school_year', 'semester', 'grade', 'class_name', 'teacher',
    'weekday', 'start_time', 'end_time', 'textbook', 'current_progress',
    'class_homework', 'memo', 'status', 'created_at', 'updated_at'
  ],
  StudentClasses: [
    'id', 'student_id', 'class_id', 'start_date', 'end_date',
    'status', 'created_at', 'updated_at'
  ],
  Lessons: [
    'lesson_id', 'lesson_date', 'student_id', 'class_id', 'attendance',
    'test_status', 'test_score', 'test_max_score', 'test_difficulty',
    'assignment_completion', 'concentration', 'progress', 'homework',
    'special_note', 'created_at', 'updated_at'
  ],
  ClassSessionNotices: [
    'id', 'lesson_date', 'class_id', 'class_notice', 'created_at', 'updated_at'
  ],
  MonthlyReports: [
    'monthly_report_id', 'student_id', 'year', 'month', 'report_text',
    'generated_at', 'updated_at', 'status'
  ],
  CounselingNotes: [
    'note_id', 'student_id', 'kind', 'counsel_date', 'title', 'content',
    'created_at', 'updated_at'
  ],
  MakeupSessions: [
    'makeup_id', 'makeup_date', 'start_time', 'end_time', 'kind',
    'class_id', 'student_id', 'title', 'memo', 'status', 'created_at', 'updated_at'
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
LMS.REL_STATUS = ['현재', '종료'];
LMS.TEST_STATUS = ['미실시', '실시'];
LMS.DIFFICULTY = ['상', '중', '하'];
LMS.ASSIGNMENT = ['A', 'B', 'C'];
LMS.CONCENTRATION = ['A', 'B', 'C', 'D', 'ABSENT'];
LMS.ATTENDANCE = ['출석', '결석'];
LMS.REPORT_STATUS = ['임시', '확정'];
LMS.COUNSEL_KIND = ['학생', '학부모'];
LMS.MAKEUP_KIND = ['반', '학생'];
LMS.MAKEUP_STATUS = ['예정', '완료', '취소'];
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

LMS.META_PREFIXES = ['STU', 'CLS', 'REL', 'LES', 'MTH', 'NTS', 'MKP', 'CSN'];

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

LMS.buildRegularClassEvents = function (classes, start, end) {
  var events = [];
  var dates = LMS.datesInRange(start, end);
  (classes || []).forEach(function (cls) {
    if (LMS.toStr(cls.status) !== '운영') return;
    dates.forEach(function (date) {
      if (!LMS.classMeetsOn(cls.weekday, date)) return;
      events.push({
        event_type: '정규',
        date: date,
        start_time: LMS.toStr(cls.start_time),
        end_time: LMS.toStr(cls.end_time),
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

LMS.collectNormalizedScores = function (lessons) {
  var scores = [];
  (lessons || []).forEach(function (row) {
    if (LMS.toStr(row.test_status) !== '실시') return;
    var n = LMS.normalizedScore(row.test_score, row.test_max_score);
    if (n !== null) scores.push(n);
  });
  return scores;
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
  var stats = LMS.computeScoreStats(LMS.collectNormalizedScores(lessons));
  return {
    test_count: stats.count,
    test_average: stats.average,
    test_median: stats.median,
    test_high: stats.high,
    test_low: stats.low,
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

    if (LMS.toStr(row.test_status) === '실시') {
      var n = LMS.normalizedScore(row.test_score, row.test_max_score);
      if (n !== null) scores.push(n);
    }

    var ac = LMS.assignmentCode(row.assignment_completion);
    if (ac) assign[ac] += 1;

    var cv = LMS.toStr(row.concentration);
    if (cv === '결석') cv = 'ABSENT';
    if (conc[cv] !== undefined) conc[cv] += 1;
  });

  var scoreStats = LMS.computeScoreStats(scores);

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
  var feedback = LMS.toStr(lesson.special_note);
  if (classNotice) {
    lines.push(section + '. 공지사항: ' + classNotice);
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
  return {
    class_id: LMS.toStr(data.class_id),
    school_year: LMS.toStr(data.school_year),
    semester: semester,
    grade: LMS.toStr(data.grade),
    class_name: className,
    teacher: LMS.toStr(data.teacher),
    weekday: LMS.toStr(data.weekday),
    start_time: LMS.toStr(data.start_time),
    end_time: LMS.toStr(data.end_time),
    textbook: LMS.toStr(data.textbook),
    current_progress: LMS.toStr(data.current_progress),
    class_homework: LMS.toStr(data.class_homework),
    memo: LMS.toStr(data.memo),
    status: status
  };
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
  return {
    note_id: LMS.toStr(data.note_id),
    student_id: LMS.toStr(data.student_id),
    kind: kind,
    counsel_date: date,
    title: LMS.toStr(data.title),
    content: content
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
  var start = LMS.toStr(data.start_time);
  var end = LMS.toStr(data.end_time);
  if (start && !LMS.isTime(start)) throw new Error('시작 시간 형식이 올바르지 않습니다.');
  if (end && !LMS.isTime(end)) throw new Error('종료 시간 형식이 올바르지 않습니다.');
  if (start) start = start.slice(0, 5);
  if (end) end = end.slice(0, 5);
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
    special_note: LMS.toStr(data.special_note)
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
  MonthlyReports: 'monthly_report_id',
  CounselingNotes: 'note_id',
  MakeupSessions: 'makeup_id',
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
