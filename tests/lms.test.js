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
    const none = api.getMonthlyStats(seeded.students[1].student_id, 2026, 9);
    assert.equal(none.test_count, 0);
    assert.equal(none.test_average_display, '-');
  });

  it('builds daily reports from lessons and settings', () => {
    const api = svc();
    const seeded = seedDemo(api);
    const undone = api.getTodayClassSession('2026-09-14', seeded.class.class_id)
      .students.find((s) => s.name === '김철수');
    const text = api.generateDailyReport(undone.lesson.lesson_id).text;
    assert.match(text, /2026년 9월 14일 월요일/);
    assert.match(text, /김철수 학생/);
    assert.match(text, /1\. 테스트: 미실시/);
    assert.match(text, /A\(100~90%\)|B\(89~70%\)/);
    assert.doesNotMatch(text, /NaN|undefined|null|#DIV\/0!/);

    const hong = api.getTodayClassSession('2026-09-14', seeded.class.class_id)
      .students.find((s) => s.name === '홍길동');
    const t2 = api.generateDailyReport(hong.lesson.lesson_id).text;
    assert.match(t2, /18 \/ 20/);
    assert.match(t2, /난이도: 중/);
    assert.match(t2, /계산 실수가 잦음/);
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
