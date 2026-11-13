'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

const MONTH = { start: '2026-09-01', end: '2026-09-30' };

function service(today) {
  const api = LMS.createService(createMemoryStore({ today, now: today + 'T09:00:00' }));
  api.ensureSchema();
  return api;
}

function giveHomework(api, classId, date, titles, checks) {
  const saved = api.saveSessionHomework({ lesson_date: date, class_id: classId, titles });
  if (checks.length) {
    api.saveHomeworkChecks({
      lesson_date: date,
      class_id: classId,
      checks: checks.map(([student, index, status]) => ({ student_id: student.student_id, item_id: saved.items[index].item_id, status }))
    });
  }
  return saved.items;
}

const trendRate = (api, classId) => api.getClassTrend(classId, 1).months[0].homework_rate;
const trendAverage = (api, classId) => api.getClassTrend(classId, 1).months[0].homework_average;
const logRow = (api, classId, date) => api.getClassHomeworkLog(classId, MONTH).rows.find((r) => r.date === date);

describe('LMS.homeworkRate', () => {
  it('is the share of graded items that are A, and null when nothing was checked', () => {
    assert.deepEqual(LMS.homeworkRate([{ status: 'A' }, { status: 'F' }, { status: 'A' }]), { done: 2, checked: 3, rate: 67 });
    assert.deepEqual(LMS.homeworkRate([{ status: 'A' }, { status: 'B' }, { status: 'C' }, { status: 'D' }]), { done: 1, checked: 4, rate: 25 });
    assert.deepEqual(LMS.homeworkRate([{ status: '완료' }, { status: '미완료' }, { status: '' }]), { done: 1, checked: 2, rate: 50 });
    assert.deepEqual(LMS.homeworkRate([]), { done: 0, checked: 0, rate: null });
    assert.deepEqual(LMS.homeworkRate(undefined), { done: 0, checked: 0, rate: null });
  });
});

describe('숙제 평균 점수 (LMS.homeworkAverage)', () => {
  it('averages item points over graded items, and is null when nothing was checked', () => {
    assert.equal(LMS.homeworkAverage([{ status: 'A' }, { status: 'F' }, { status: 'A' }]), 83);
    assert.equal(LMS.homeworkAverage([{ status: 'A' }, { status: 'B' }, { status: 'C' }, { status: 'D' }]), 84);
    assert.equal(LMS.homeworkAverage([{ status: 'E' }, { status: '' }]), 59);
    assert.equal(LMS.homeworkAverage([{ status: '완료' }, { status: '미완료' }]), 75);
    assert.equal(LMS.homeworkAverage([]), null);
    assert.equal(LMS.homeworkAverage(undefined), null);
  });

  it('differs from 숙제 완료율 when students got B–D', () => {
    const cells = [{ status: 'B' }, { status: 'B' }, { status: 'C' }];
    assert.equal(LMS.homeworkRate(cells).rate, 0);
    assert.equal(LMS.homeworkAverage(cells), 86);
  });
});

describe('숙제 완료 (LMS.isHomeworkDone)', () => {
  it('counts only A as done; B, C, D, E, F, ungraded and unknown values are not done', () => {
    assert.deepEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(LMS.isHomeworkDone), [true, false, false, false, false, false]);
    assert.equal(LMS.isHomeworkDone('완료'), true);
    assert.equal(LMS.isHomeworkDone('미완료'), false);
    ['', '미확인', undefined, 'X'].forEach((v) => assert.equal(LMS.isHomeworkDone(v), false));
  });

  it('drives the done counts, missing lists and today counts on every screen', () => {
    const api = service('2026-09-28');
    const a = api.createClass({ class_name: 'A반', weekday: '월/수', start_time: '18:00', end_time: '20:00' });
    const s = api.createStudent({ name: '경계', class_id: a.class_id, enrollment_date: '2026-03-01' });
    giveHomework(api, a.class_id, '2026-09-21', ['a', 'b', 'd', 'none'], [[s, 0, 'A'], [s, 1, 'B'], [s, 2, 'D']]);
    const cell = logRow(api, a.class_id, '2026-09-21').cells[s.student_id];
    assert.equal(cell.done, 1);
    assert.equal(cell.checked, 3);
    assert.deepEqual(cell.missing, ['b', 'd']);
    assert.deepEqual(api.getStudentHomework(s.student_id, MONTH).missing.map((m) => m.title), ['b', 'd']);
  });

  it('counts a student with only B grades as incomplete in the lesson record', () => {
    const api = service('2026-09-28');
    const a = api.createClass({ class_name: 'A반', weekday: '월/수', start_time: '18:00', end_time: '20:00' });
    const s = api.createStudent({ name: '비', class_id: a.class_id, enrollment_date: '2026-03-01' });
    const items = api.saveSessionHomework({ lesson_date: '2026-09-21', class_id: a.class_id, titles: ['p1', 'p2'] }).items;
    const saved = api.saveHomeworkChecks({
      lesson_date: '2026-09-21',
      class_id: a.class_id,
      checks: items.map((it) => ({ student_id: s.student_id, item_id: it.item_id, status: 'B' }))
    });
    const g = saved.grades.find((x) => x.student_id === s.student_id);
    assert.equal(g.done, 0);
    assert.equal(g.total, 2);
  });
});

describe('출석률 (LMS.attendanceRate)', () => {
  it('is the share of records that are not 결석, or null without records', () => {
    assert.equal(LMS.attendanceRate([{ attendance: '출석' }, { attendance: '결석' }, { attendance: '' }]), 67);
    assert.equal(LMS.attendanceRate([]), null);
    assert.equal(LMS.attendanceRate(undefined), null);
  });
});

describe('숙제 완료율 across screens', () => {
  // Today is Mon 2026-09-28. A반 meets 월/수, B반 화/목; 이동 moves from A to B on 09-15.
  function leaverSetup() {
    const api = service('2026-09-28');
    const a = api.createClass({ class_name: 'A반', weekday: '월/수', start_time: '18:00', end_time: '20:00' });
    const b = api.createClass({ class_name: 'B반', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
    const stay = api.createStudent({ name: '남음', class_id: a.class_id, enrollment_date: '2026-03-01' });
    const mover = api.createStudent({ name: '이동', class_id: a.class_id, enrollment_date: '2026-03-01' });
    api.moveStudent({ student_id: mover.student_id, class_id: b.class_id, start_date: '2026-09-15' });
    giveHomework(api, a.class_id, '2026-09-02', ['p1'], [[stay, 0, 'A'], [mover, 0, 'A']]);
    giveHomework(api, a.class_id, '2026-09-09', ['p2'], [[stay, 0, 'F'], [mover, 0, 'A']]);
    // A stray check for a student who had already left A must not count anywhere.
    giveHomework(api, a.class_id, '2026-09-21', ['p3'], [[stay, 0, 'A'], [mover, 0, 'A']]);
    giveHomework(api, b.class_id, '2026-09-22', ['q1'], [[mover, 0, 'F']]);
    return { api, a, b, stay, mover };
  }

  it('gives the same class rate on the overview and the stats tab when a student left mid-month', () => {
    const { api, a } = leaverSetup();
    // stay A,F,A + mover's two A's before leaving = 4 A of 5; points (100+50+100+100+100)/5.
    assert.equal(api.getClassOverview(a.class_id).month.homework_rate, 80);
    assert.equal(trendRate(api, a.class_id), 80);
    assert.equal(api.getClassOverview(a.class_id).month.homework_average, 90);
    assert.equal(trendAverage(api, a.class_id), 90);
  });

  it('counts the leaver in the new class only from the move date', () => {
    const { api, b, mover } = leaverSetup();
    assert.equal(api.getClassOverview(b.class_id).month.homework_rate, 0);
    assert.equal(trendRate(api, b.class_id), 0);
    assert.equal(api.getClassOverview(b.class_id).month.homework_average, 50);
    assert.equal(trendAverage(api, b.class_id), 50);
    // A 09-02 A, A 09-09 A, B 09-22 F; the stray A 09-21 check is left out. 2 A of 3, (100+100+50)/3.
    assert.equal(api.getStudentOverview(mover.student_id).month.homework_rate, 67);
    assert.equal(api.getStudentOverview(mover.student_id).month.homework_average, 83);
    const tab = api.getStudentHomework(mover.student_id, MONTH);
    assert.equal(tab.rate, 67);
    assert.equal(tab.average, 83);
    assert.equal(tab.checked, 3);
  });

  it('keeps counting a student who is on leave now', () => {
    const { api, a, stay } = leaverSetup();
    api.updateStudent(Object.assign({}, api.getStudent(stay.student_id), { status: '휴원' }));
    assert.equal(api.getClassOverview(a.class_id).month.homework_rate, 80);
    assert.equal(trendRate(api, a.class_id), 80);
  });

  it('leaves unchecked items out of every rate', () => {
    const api = service('2026-09-28');
    const a = api.createClass({ class_name: 'A반', weekday: '월/수', start_time: '18:00', end_time: '20:00' });
    const s = api.createStudent({ name: '부분', class_id: a.class_id, enrollment_date: '2026-03-01' });
    giveHomework(api, a.class_id, '2026-09-21', ['p1', 'p2'], [[s, 0, 'A']]);
    assert.equal(api.getStudentOverview(s.student_id).month.homework_rate, 100);
    assert.equal(api.getStudentHomework(s.student_id, MONTH).rate, 100);
    const row = logRow(api, a.class_id, '2026-09-21');
    assert.equal(row.rate, 100);
    assert.equal(row.average, 100);
    assert.equal(row.checked, true);
    assert.deepEqual(row.cells[s.student_id], {
      done: 1, total: 2, checked: 1, missing: [], replace_class: false, letter: 'A',
      grades: [{ title: 'p1', grade: 'A' }, { title: 'p2', grade: '' }]
    });
    assert.equal(api.getClassOverview(a.class_id).month.homework_rate, 100);
    assert.equal(trendRate(api, a.class_id), 100);
  });

  it('is null when nothing was checked', () => {
    const api = service('2026-09-28');
    const a = api.createClass({ class_name: 'A반', weekday: '월/수', start_time: '18:00', end_time: '20:00' });
    const s = api.createStudent({ name: '미확인', class_id: a.class_id, enrollment_date: '2026-03-01' });
    giveHomework(api, a.class_id, '2026-09-21', ['p1'], []);
    assert.equal(api.getClassOverview(a.class_id).month.homework_rate, null);
    assert.equal(trendRate(api, a.class_id), null);
    assert.equal(api.getStudentOverview(s.student_id).month.homework_rate, null);
    assert.equal(api.getStudentHomework(s.student_id, MONTH).rate, null);
    assert.equal(api.getClassOverview(a.class_id).month.homework_average, null);
    assert.equal(api.getStudentHomework(s.student_id, MONTH).average, null);
    const row = logRow(api, a.class_id, '2026-09-21');
    assert.equal(row.rate, null);
    assert.equal(row.average, null);
    assert.equal(row.checked, false);
  });
});

describe('AI plan input homework_rate', () => {
  it('follows the same rule per student and for the class', () => {
    const api = service('2026-09-14');
    const cls = api.createClass({
      class_name: 'A반', grade: '중2', weekday: '월/수', start_time: '18:00', end_time: '20:00',
      curriculum: [{ title: '삼각형의 성질', sessions: 4 }]
    });
    const [hong, kim, lee] = ['홍', '김', '이'].map((name) => api.createStudent({ name, grade: '중2', class_id: cls.class_id, enrollment_date: '2026-03-01' }));
    const other = api.createClass({ class_name: '다른반', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
    api.moveStudent({ student_id: lee.student_id, class_id: other.class_id, start_date: '2026-09-08' });
    giveHomework(api, cls.class_id, '2026-09-07', ['p1', 'p2'], [[hong, 0, 'A'], [lee, 0, 'F'], [lee, 1, 'F']]);
    giveHomework(api, cls.class_id, '2026-09-09', ['p3'], [[hong, 0, 'F'], [lee, 0, 'A']]);

    const context = api.getClassPlanContext(cls.class_id, '2026-09');
    const input = context.input;
    // Refs follow the roster sorted by student id; lee has left, so only hong and kim get one.
    const byId = {};
    [hong.student_id, kim.student_id].sort().forEach((id, i) => { byId[id] = input.students.find((s) => s.ref === 'S' + (i + 1)); });
    assert.equal(input.students.length, 2);
    // hong: p1 A, p3 F; p2 was never graded. 1 A of 2.
    assert.equal(byId[hong.student_id].homework_rate, 50);
    assert.equal(byId[hong.student_id].homework_average, 75);
    assert.equal(byId[kim.student_id].homework_rate, null);
    assert.equal(byId[kim.student_id].homework_average, null);
    // The class keeps lee's checks from while lee was in it (09-07), plus hong's 09-09 F. 1 A of 4, (100+50+50+50)/4.
    assert.equal(input.class_stats_last_4_weeks.homework_rate, 25);
    assert.equal(input.class_stats_last_4_weeks.homework_average, 63);
  });

  it('counts class attendance over the same records as the overview, including students who left', () => {
    const api = service('2026-09-14');
    const cls = api.createClass({
      class_name: 'A반', grade: '중2', weekday: '월/수', start_time: '18:00', end_time: '20:00',
      curriculum: [{ title: '삼각형의 성질', sessions: 4 }]
    });
    const [hong, lee] = ['홍', '이'].map((name) => api.createStudent({ name, grade: '중2', class_id: cls.class_id, enrollment_date: '2026-03-01' }));
    const other = api.createClass({ class_name: '다른반', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
    api.moveStudent({ student_id: lee.student_id, class_id: other.class_id, start_date: '2026-09-08' });
    const lesson = (student, date, attendance) => api.saveLesson({ lesson_date: date, class_id: cls.class_id, student_id: student.student_id, attendance });
    lesson(hong, '2026-09-07', '출석');
    lesson(lee, '2026-09-07', '출석');
    lesson(hong, '2026-09-09', '결석');

    const input = api.getClassPlanContext(cls.class_id, '2026-09').input;
    assert.equal(input.students.length, 1);
    assert.equal(input.students[0].attendance_rate, 50);
    // 2 of 3 records are not 결석, the same rule as the class overview.
    assert.equal(input.class_stats_last_4_weeks.attendance_rate, 67);
  });
});
