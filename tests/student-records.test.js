'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

function svc() {
  return LMS.createService(createMemoryStore({ today: '2026-09-14' }));
}

describe('attendance-only edits', () => {
  it('changes attendance and leaves the score, note and concentration', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '홍길동', class_id: c.class_id });
    const lesson = api.saveLesson({
      lesson_date: '2026-09-14',
      class_id: c.class_id,
      student_id: s.student_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 18,
      test_max_score: 20,
      concentration: 'A',
      special_note: '계산 실수'
    });
    const updated = api.updateLessonAttendance({ lesson_id: lesson.lesson_id, attendance: '결석' });
    assert.equal(updated.attendance, '결석');
    assert.equal(updated.test_score, 18);
    assert.equal(updated.test_status, '실시');
    assert.equal(updated.concentration, 'A');
    assert.equal(updated.special_note, '계산 실수');
    assert.equal(api.updateLessonAttendance({ lesson_id: lesson.lesson_id, attendance: '결석' }).test_score, 18);
    assert.throws(() => api.updateLessonAttendance({ lesson_id: lesson.lesson_id, attendance: '지각' }), /출석/);
  });
});

describe('textbook history', () => {
  it('keeps the previous textbook when the name changes', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반', textbook: '개념원리', textbook_started_on: '2026-03-01' });
    assert.deepEqual(c.textbook_history, [{ textbook: '개념원리', from: '2026-03-01', to: '' }]);
    const next = api.updateClass(Object.assign({}, c, { textbook: '쎈', textbook_started_on: '2026-07-01' }));
    assert.equal(next.textbook, '쎈');
    assert.deepEqual(next.textbook_history, [
      { textbook: '개념원리', from: '2026-03-01', to: '2026-06-30' },
      { textbook: '쎈', from: '2026-07-01', to: '' }
    ]);
    const same = api.updateClass(Object.assign({}, next, { memo: '그대로' }));
    assert.deepEqual(same.textbook_history, next.textbook_history);
    assert.throws(
      () => api.updateClass(Object.assign({}, next, { textbook: '블랙라벨', textbook_started_on: '2026-07-01' })),
      /다음 날/
    );
    const cleared = api.updateClass(Object.assign({}, next, { textbook: '', textbook_started_on: '2026-09-01' }));
    assert.equal(cleared.textbook, '');
    assert.equal(cleared.textbook_history.length, 2);
    assert.equal(cleared.textbook_history[1].to, '2026-08-31');
  });

  it('backfills an open period for classes that already have a textbook', () => {
    const store = createMemoryStore({ today: '2026-09-14' });
    store.writeTable('Classes', [{ class_id: 'CLS_1', class_name: 'A반', textbook: '개념원리', status: '운영' }]);
    store.writeTable('_Meta', [{ prefix: 'SCHEMA', next_seq: 5 }]);
    const api = LMS.createService(store);
    assert.equal(api.ensureSchema(), true);
    assert.deepEqual(api.getClass('CLS_1').textbook_history, [{ textbook: '개념원리', from: '', to: '' }]);
    assert.equal(api.ensureSchema(), false);
  });
});

describe('student score normalization', () => {
  it('uses 100-point scores in student stats and raw scores on the daily report', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '홍길동', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-01', class_id: c.class_id, student_id: s.student_id,
      attendance: '출석', test_status: '실시', test_score: 18, test_max_score: 20
    });
    api.saveLesson({
      lesson_date: '2026-09-08', class_id: c.class_id, student_id: s.student_id,
      attendance: '출석', test_status: '실시', test_score: 40, test_max_score: 50
    });
    const stats = api.getMonthlyStats(s.student_id, 2026, 9);
    assert.equal(stats.test_count, 2);
    assert.equal(stats.test_average, 85);
    assert.match(api.generateMonthlyReport(s.student_id, 2026, 9).generated_text, /100점 환산 평균은 85\.0점/);
    assert.equal(api.getStudentOverview(s.student_id).month.test_average_display, '85.0');
    const grades = api.getStudentGrades(s.student_id, { start: '2026-09-01', end: '2026-09-30' });
    assert.equal(grades.stats.average, 85);
    assert.deepEqual(grades.rows.map((r) => r.score).sort((a, b) => a - b), [18, 40]);
    const classStats = api.getClassStats(c.class_id, 2026, 9);
    assert.equal(classStats.students[0].stats.test_average, 85);
    const daily = LMS.computeDailyClassTestAverage([
      { test_status: '실시', test_score: 18, test_max_score: 20 },
      { test_status: '실시', test_score: 40, test_max_score: 50 }
    ]);
    assert.equal(daily.comparable, false);
    assert.equal(daily.test_average, null);
  });
});

describe('test scope', () => {
  it('copies the scope onto every student lesson and the daily report', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const present = api.createStudent({ name: '홍길동', class_id: c.class_id });
    const absent = api.createStudent({ name: '김철수', class_id: c.class_id });
    const date = '2026-09-14';
    api.saveLessonsBatch([
      {
        lesson_date: date, class_id: c.class_id, student_id: present.student_id,
        attendance: '출석', test_status: '실시', test_score: 8, test_max_score: 10
      },
      {
        lesson_date: date, class_id: c.class_id, student_id: absent.student_id,
        attendance: '결석', test_status: '미실시'
      }
    ]);
    api.saveClassSession({
      lesson_date: date, class_id: c.class_id,
      test_title: '확인', test_scope: '3단원 함수', test_max_score: 10, test_difficulty: '중'
    });
    const lessons = api.getLessons(date, c.class_id);
    assert.equal(lessons.length, 2);
    lessons.forEach((l) => assert.equal(l.test_scope, '3단원 함수'));
    const reports = api.generateDailyReports(date, c.class_id);
    reports.reports.forEach((r) => assert.match(r.text, /범위: 3단원 함수/));
    const taken = reports.reports.find((r) => r.student_name === '홍길동');
    assert.match(taken.text, /8 \/ 10/);
    assert.doesNotMatch(taken.text, /100점 환산/);
    assert.equal(api.getClassTests(c.class_id, { start: date, end: date }).rows[0].scope, '3단원 함수');
    api.saveClassSession({ lesson_date: date, class_id: c.class_id, progress: '진도만' });
    assert.equal(api.getClassSession(date, c.class_id).test_scope, '3단원 함수');
    api.saveClassSession({ lesson_date: date, class_id: c.class_id, test_scope: '' });
    api.getLessons(date, c.class_id).forEach((l) => assert.equal(l.test_scope, ''));
    assert.doesNotMatch(api.generateDailyReports(date, c.class_id).reports[0].text, /범위:/);
  });
});
