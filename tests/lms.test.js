'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');

function svc() {
  return LMS.createService(createMemoryStore());
}

describe('IDs and scores', () => {
  it('formats sequential IDs', () => {
    assert.equal(LMS.formatId('STU', 1), 'STU_000001');
    assert.equal(LMS.formatId('CLS', 127), 'CLS_000127');
  });

  it('normalizes scores across different max values', () => {
    assert.equal(LMS.normalizedScore(18, 20), 90);
    assert.equal(LMS.normalizedScore(45, 50), 90);
    assert.equal(LMS.normalizedScore(27, 30), 90);
  });

  it('returns null instead of NaN for invalid scores', () => {
    assert.equal(LMS.normalizedScore(10, 0), null);
    assert.equal(LMS.normalizedScore('', 20), null);
    assert.equal(LMS.formatAverageDisplay(null), '-');
    assert.equal(LMS.formatAverageDisplay(undefined), '-');
    assert.equal(LMS.formatAverageDisplay(Number.NaN), '-');
  });
});

describe('students classes and lessons', () => {
  it('creates IDs and does not change student_id on update', () => {
    const api = svc();
    const s = api.createStudent({ name: '홍길동', grade: '중2' });
    assert.equal(s.student_id, 'STU_000001');
    const updated = api.updateStudent({ student_id: s.student_id, name: '홍길동2', grade: '중2', status: '재원' });
    assert.equal(updated.student_id, 'STU_000001');
    assert.equal(updated.name, '홍길동2');
  });

  it('keeps class history when moving students', () => {
    const api = svc();
    const a = api.createClass({ class_name: '중2 A반', grade: '중2', weekday: '월/수' });
    const b = api.createClass({ class_name: '중2 B반', grade: '중2', weekday: '화/목' });
    const s = api.createStudent({ name: '홍길동', grade: '중2', class_id: a.class_id, enrollment_date: '2026-03-01' });
    api.saveLesson({
      lesson_date: '2026-03-10',
      student_id: s.student_id,
      class_id: a.class_id,
      attendance: '출석',
      test_status: '미실시'
    });
    api.moveStudent({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-07-01' });
    const hist = api.getStudentClasses(s.student_id);
    assert.equal(hist.length, 2);
    const ended = hist.filter((r) => r.status === '종료')[0];
    const current = hist.filter((r) => r.status === '현재')[0];
    assert.equal(ended.class_id, a.class_id);
    assert.equal(ended.end_date, '2026-06-30');
    assert.equal(current.class_id, b.class_id);
    const oldLesson = api.getStudentLessons(s.student_id)[0];
    assert.equal(oldLesson.class_id, a.class_id);
  });

  it('upserts lessons by date + student + class', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '김철수', class_id: c.class_id });
    const first = api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 10,
      test_max_score: 20,
      progress: '삼각형'
    });
    const second = api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 18,
      test_max_score: 20,
      progress: '사각형'
    });
    assert.equal(first.lesson_id, second.lesson_id);
    assert.equal(api.getLessons('2026-09-14', c.class_id).length, 1);
    assert.equal(second.test_score, 18);
    assert.equal(second.progress, '사각형');
  });

  it('rejects zero max score', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '이영희', class_id: c.class_id });
    assert.throws(() => api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 10,
      test_max_score: 0
    }), /만점은 0보다 커야/);
  });

  it('archives students instead of deleting them', () => {
    const api = svc();
    const s = api.createStudent({ name: '박민수' });
    const archived = api.archiveStudent(s.student_id);
    assert.equal(archived.status, '퇴원');
    assert.equal(api.getStudent(s.student_id).name, '박민수');
  });
});

describe('reports and stats', () => {
  it('excludes 미실시 tests from monthly average', () => {
    const api = svc();
    const seeded = seedDemo(api);
    api.saveLesson({
      lesson_date: '2026-09-16',
      student_id: seeded.students[0].student_id,
      class_id: seeded.class.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 40,
      test_max_score: 50
    });
    const stats = api.getMonthlyStats(seeded.students[0].student_id, 2026, 9);
    assert.equal(stats.test_count, 2);
    assert.equal(stats.test_average, 85);
    assert.equal(stats.test_median, 85);
    assert.equal(stats.test_high, 90);
    assert.equal(stats.test_low, 80);
    assert.equal(stats.test_median_display, '85.0');
    const monthly = api.generateMonthlyReport(seeded.students[0].student_id, 2026, 9);
    assert.match(monthly.text, /평균은 85\.0점입니다\. \(중간값 85\.0점, 최고 90\.0점, 최저 80\.0점\)/);
    const none = api.getMonthlyStats(seeded.students[1].student_id, 2026, 9);
    assert.equal(none.test_count, 0);
    assert.equal(none.test_average_display, '-');
    assert.equal(none.test_median_display, '-');
  });

  it('builds daily reports from lessons and settings', () => {
    const api = svc();
    const seeded = seedDemo(api);
    const batch = api.generateDailyReports('2026-09-14', seeded.class.class_id);
    assert.equal(batch.class_test_average.test_count, 2);
    assert.equal(batch.class_test_average.test_average, 95);
    assert.equal(batch.class_test_average.test_median, 95);
    assert.equal(batch.class_test_average.test_high, 100);
    assert.equal(batch.class_test_average.test_low, 90);
    assert.equal(batch.class_test_average.test_average_display, '95.0');
    assert.equal(batch.class_test_average.test_median_display, '95.0');
    assert.equal(batch.class_test_average.test_high_display, '100.0');
    assert.equal(batch.class_test_average.test_low_display, '90.0');
    assert.deepEqual(batch.reports.map((r) => r.student_name), ['김철수', '이영희', '홍길동']);

    const undone = api.getTodayClassSession('2026-09-14', seeded.class.class_id)
      .students.find((s) => s.name === '김철수');
    const text = api.generateDailyReport(undone.lesson.lesson_id).text;
    assert.match(text, /2026년 9월 14일 월요일/);
    assert.match(text, /김철수 학생/);
    assert.match(text, /1\. 출석: 출석/);
    assert.match(text, /2\. 테스트: 미실시/);
    assert.doesNotMatch(text, /반 평균/);
    assert.match(text, /3\. 과제 이행률: B\(89~70%\)/);
    assert.match(text, /4\. 집중도: B/);
    assert.match(text, /5\. 학습 진도:/);
    assert.match(text, /6\. 과제 안내:/);
    assert.doesNotMatch(text, /과제이행률/);
    assert.doesNotMatch(text, /NaN|undefined|null|#DIV\/0!/);

    const hong = api.getTodayClassSession('2026-09-14', seeded.class.class_id)
      .students.find((s) => s.name === '홍길동');
    const t2 = api.generateDailyReport(hong.lesson.lesson_id).text;
    assert.match(t2, /18 \/ 20/);
    assert.match(t2, /난이도: 중/);
    assert.match(t2, /\(반 평균 95\.0 · 중간값 95\.0 · 최고 100\.0 · 최저 90\.0\)/);
    assert.match(t2, /4\. 집중도: A/);
    assert.match(t2, /7\. 특이사항: 계산 실수가 잦음/);
  });

  it('omits class average from daily reports when no tests were taken', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'B반' });
    const s = api.createStudent({ name: '박민수', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '결석',
      test_status: '미실시',
      concentration: 'ABSENT'
    });
    const batch = api.generateDailyReports('2026-09-14', c.class_id);
    assert.equal(batch.class_test_average.test_count, 0);
    assert.equal(batch.class_test_average.test_average_display, '-');
    assert.match(batch.reports[0].text, /1\. 출석: 결석/);
    assert.match(batch.reports[0].text, /2\. 테스트: 미실시/);
    assert.doesNotMatch(batch.reports[0].text, /반 평균/);
    assert.match(batch.reports[0].text, /4\. 집중도: 결석/);
  });

  it('averages daily class tests after normalizing different max scores', () => {
    const avg = LMS.computeDailyClassTestAverage([
      { test_status: '실시', test_score: 18, test_max_score: 20 },
      { test_status: '실시', test_score: 40, test_max_score: 50 },
      { test_status: '미실시', test_score: 0, test_max_score: 20 }
    ]);
    assert.equal(avg.test_count, 2);
    assert.equal(avg.test_average, 85);
    assert.equal(avg.test_median, 85);
    assert.equal(avg.test_high, 90);
    assert.equal(avg.test_low, 80);
    assert.equal(avg.test_average_display, '85.0');
    assert.equal(avg.test_median_display, '85.0');
    assert.equal(avg.test_high_display, '90.0');
    assert.equal(avg.test_low_display, '80.0');
  });

  it('computes median for odd and even score lists', () => {
    assert.equal(LMS.median([10, 30, 20]), 20);
    assert.equal(LMS.median([10, 40, 20, 30]), 25);
    assert.equal(LMS.median([]), null);
  });

  it('collapses repeated progress in monthly reports', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '홍길동', class_id: c.class_id });
    ['2026-09-01', '2026-09-03', '2026-09-05'].forEach((d) => {
      api.saveLesson({
        lesson_date: d,
        student_id: s.student_id,
        class_id: c.class_id,
        attendance: '출석',
        test_status: '미실시',
        progress: '삼각형의 성질'
      });
    });
    api.saveLesson({
      lesson_date: '2026-09-08',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      progress: '사각형의 성질'
    });
    const stats = api.getMonthlyStats(s.student_id, 2026, 9);
    assert.equal(stats.progress_summary, '삼각형의 성질 → 사각형의 성질');
    const report = api.generateMonthlyReport(s.student_id, 2026, 9);
    assert.match(report.text, /삼각형의 성질 → 사각형의 성질/);
    const saved = api.saveMonthlyReport({
      student_id: s.student_id,
      year: 2026,
      month: 9,
      report_text: report.text,
      status: '확정'
    });
    assert.equal(saved.status, '확정');
    assert.match(saved.monthly_report_id, /^MTH_/);
  });

  it('computes dashboard counts from lessons', () => {
    const api = svc();
    seedDemo(api);
    const dash = api.getDashboard('2026-09-14');
    assert.equal(dash.today_class_count, 1);
    assert.equal(dash.today_student_count, 3);
    assert.equal(dash.recorded_count, 3);
    assert.equal(dash.incomplete_count, 0);
    assert.equal(dash.date_label, '2026년 9월 14일 월요일');
  });
});

describe('bootstrap and caching', () => {
  it('returns dashboard, classes and students in one bootstrap payload', () => {
    const api = svc();
    seedDemo(api);
    const boot = api.getBootstrap();
    assert.equal(boot.settings.academy_name, '수학의 힘');
    assert.equal(boot.today, '2026-09-14');
    assert.equal(boot.classes.length, 1);
    assert.equal(boot.students.length, 3);
    assert.equal(boot.dashboard.today_student_count, 3);
    assert.equal(boot.grades.length, LMS.GRADE_OPTIONS.length);
  });

  it('reads each table at most once per bootstrap', () => {
    const store = createMemoryStore();
    seedDemo(LMS.createService(store));
    const counts = {};
    const orig = store.readTable.bind(store);
    store.readTable = function (name) {
      counts[name] = (counts[name] || 0) + 1;
      return orig(name);
    };
    LMS.createService(store).getBootstrap();
    Object.keys(counts).forEach((name) => {
      assert.ok(counts[name] <= 1, name + ' read ' + counts[name] + ' times');
    });
    assert.equal(counts.Students, 1);
    assert.equal(counts.StudentClasses, 1);
    assert.equal(counts.Classes, 1);
    assert.equal(counts.Lessons, 1);
  });

  it('diffs table rows into updates and appends', () => {
    const prev = [{ lesson_id: 'LES_000001', progress: 'a' }];
    const next = [
      { lesson_id: 'LES_000001', progress: 'b' },
      { lesson_id: 'LES_000002', progress: 'c' }
    ];
    const headers = ['lesson_id', 'progress'];
    const diff = LMS.diffTableRows(prev, next, 'lesson_id', headers);
    assert.equal(diff.needsFullRewrite, false);
    assert.equal(diff.updates.length, 1);
    assert.equal(diff.updates[0].row, 2);
    assert.deepEqual(diff.updates[0].values, ['LES_000001', 'b']);
    assert.equal(diff.appends.length, 1);
    assert.deepEqual(diff.appends[0], ['LES_000002', 'c']);
  });

  it('rewrites when a row is removed', () => {
    const diff = LMS.diffTableRows(
      [{ key: 'a', value: '1' }, { key: 'b', value: '2' }],
      [{ key: 'a', value: '1' }],
      'key',
      ['key', 'value']
    );
    assert.equal(diff.needsFullRewrite, true);
  });

  it('detects sheet header changes for new student and class columns', () => {
    const oldStudents = [
      'student_id', 'name', 'grade', 'parent_phone', 'enrollment_date',
      'status', 'memo', 'created_at', 'updated_at'
    ];
    const oldClasses = [
      'class_id', 'school_year', 'semester', 'grade', 'class_name', 'teacher',
      'weekday', 'start_time', 'end_time', 'memo', 'status', 'created_at', 'updated_at'
    ];
    assert.equal(LMS.headersMatch(oldStudents, LMS.TABLES.Students), false);
    assert.equal(LMS.headersMatch(oldClasses, LMS.TABLES.Classes), false);
    assert.equal(LMS.headersMatch(LMS.TABLES.Students, LMS.TABLES.Students), true);
    assert.deepEqual(
      LMS.compactHeaderRow(['student_id', 'name', '', 'grade']),
      ['student_id', 'name']
    );
  });
});

describe('student extras counseling makeup and calendar', () => {
  it('stores student phone and school', () => {
    const api = svc();
    const s = api.createStudent({
      name: '최민아',
      grade: '중1',
      school: '한빛중학교',
      student_phone: '010-7777-8888',
      parent_phone: '010-9999-0000'
    });
    assert.equal(s.school, '한빛중학교');
    assert.equal(s.student_phone, '010-7777-8888');
    const updated = api.updateStudent(Object.assign({}, s, { school: '새봄중학교' }));
    assert.equal(updated.school, '새봄중학교');
    assert.equal(api.getStudents({ query: '새봄' })[0].student_id, s.student_id);
  });

  it('previews and promotes enrolled students one grade', () => {
    const api = svc();
    api.createStudent({ name: '중2학생', grade: '중2', status: '재원' });
    api.createStudent({ name: '고3학생', grade: '고3', status: '재원' });
    api.createStudent({ name: '휴원학생', grade: '중2', status: '휴원' });
    const preview = api.previewGradePromotion();
    const mid = preview.items.filter((i) => i.from_grade === '중2')[0];
    assert.equal(mid.count, 1);
    assert.equal(mid.to_grade, '중3');
    assert.equal(preview.skipped.length, 1);
    assert.equal(preview.skipped[0].name, '고3학생');
    const result = api.promoteGrades();
    assert.equal(result.updated_count, 1);
    assert.equal(api.getStudent(result.updated[0].student_id).grade, '중3');
    const paused = api.getStudents({ status: '휴원' })[0];
    assert.equal(paused.grade, '중2');
    const high = api.getStudents({ query: '고3학생' })[0];
    assert.equal(high.grade, '고3');
  });

  it('saves class textbook progress and homework', () => {
    const api = svc();
    const c = api.createClass({
      class_name: '중2 A반',
      grade: '중2',
      textbook: '개념원리 중2-2',
      current_progress: '삼각형의 성질',
      class_homework: '워크북 12쪽'
    });
    assert.equal(c.textbook, '개념원리 중2-2');
    const updated = api.updateClass(Object.assign({}, c, { current_progress: '사각형의 성질' }));
    assert.equal(updated.current_progress, '사각형의 성질');
    assert.equal(api.getClass(c.class_id).class_homework, '워크북 12쪽');
  });

  it('creates updates and deletes counseling notes by kind', () => {
    const api = svc();
    const s = api.createStudent({ name: '상담학생', grade: '중2' });
    const note = api.saveCounselingNote({
      student_id: s.student_id,
      kind: '학생',
      counsel_date: '2026-09-10',
      title: '집중도',
      content: '수업 중 산만함'
    });
    assert.match(note.note_id, /^NTS_/);
    const parent = api.saveCounselingNote({
      student_id: s.student_id,
      kind: '학부모',
      counsel_date: '2026-09-12',
      title: '통화',
      content: '숙제 점검 요청'
    });
    const list = api.getCounselingNotes(s.student_id);
    assert.equal(list.length, 2);
    const edited = api.saveCounselingNote(Object.assign({}, note, { content: '집중이 좋아짐' }));
    assert.equal(edited.note_id, note.note_id);
    assert.equal(edited.content, '집중이 좋아짐');
    api.deleteCounselingNote(parent.note_id);
    assert.equal(api.getCounselingNotes(s.student_id).length, 1);
  });

  it('rejects invalid counseling and makeup input', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '김학생', class_id: c.class_id });
    assert.throws(() => api.saveCounselingNote({
      student_id: s.student_id,
      kind: '학생',
      counsel_date: '2026-09-10',
      content: ''
    }), /상담 내용/);
    assert.throws(() => api.saveMakeupSession({
      kind: '반',
      makeup_date: '2026-09-16'
    }), /반을 선택/);
    assert.throws(() => api.saveMakeupSession({
      kind: '학생',
      makeup_date: '2026-09-16',
      student_id: ''
    }), /학생을 선택/);
  });

  it('puts regular classes and makeup sessions on the calendar', () => {
    const api = svc();
    const seeded = seedDemo(api);
    const classMakeup = api.saveMakeupSession({
      kind: '반',
      class_id: seeded.class.class_id,
      makeup_date: '2026-09-16',
      start_time: '18:00',
      end_time: '20:00',
      title: '중간고사 보강'
    });
    const personal = api.saveMakeupSession({
      kind: '학생',
      student_id: seeded.students[0].student_id,
      class_id: seeded.class.class_id,
      makeup_date: '2026-09-17',
      start_time: '19:00:00',
      end_time: '20:00:00'
    });
    assert.equal(personal.start_time, '19:00');
    const cal = api.getCalendar('2026-09-14', '2026-09-17');
    const regularMon = cal.events.filter((e) => e.event_type === '정규' && e.date === '2026-09-14');
    const regularTue = cal.events.filter((e) => e.event_type === '정규' && e.date === '2026-09-15');
    assert.equal(regularMon.length, 1);
    assert.equal(regularTue.length, 0);
    assert.equal(cal.events.filter((e) => e.event_type === '반보강').length, 1);
    assert.equal(cal.events.filter((e) => e.event_type === '개인보강')[0].title, '홍길동 보강');
    api.cancelMakeupSession(classMakeup.makeup_id);
    const after = api.getCalendar('2026-09-14', '2026-09-17');
    assert.equal(after.events.filter((e) => e.event_type === '반보강').length, 0);
  });

  it('computes monday-based week range', () => {
    const week = LMS.weekRange('2026-09-16');
    assert.equal(week.start, '2026-09-14');
    assert.equal(week.end, '2026-09-20');
    assert.equal(LMS.nextGrade('중2'), '중3');
    assert.equal(LMS.nextGrade('고3'), '');
    assert.equal(LMS.nextGrade('기타'), '');
  });
});
