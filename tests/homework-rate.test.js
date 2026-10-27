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
const logRow = (api, classId, date) => api.getClassHomeworkLog(classId, MONTH).rows.find((r) => r.date === date);

describe('LMS.homeworkRate', () => {
  it('counts only check rows and returns null when nothing was checked', () => {
    assert.deepEqual(LMS.homeworkRate([{ status: '완료' }, { status: '미완료' }, { status: '완료' }]), { done: 2, checked: 3, rate: 67 });
    assert.deepEqual(LMS.homeworkRate([]), { done: 0, checked: 0, rate: null });
    assert.deepEqual(LMS.homeworkRate(undefined), { done: 0, checked: 0, rate: null });
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
    giveHomework(api, a.class_id, '2026-09-02', ['p1'], [[stay, 0, '완료'], [mover, 0, '완료']]);
    giveHomework(api, a.class_id, '2026-09-09', ['p2'], [[stay, 0, '미완료'], [mover, 0, '완료']]);
    // A stray check for a student who had already left A must not count anywhere.
    giveHomework(api, a.class_id, '2026-09-21', ['p3'], [[stay, 0, '완료'], [mover, 0, '완료']]);
    giveHomework(api, b.class_id, '2026-09-22', ['q1'], [[mover, 0, '미완료']]);
    return { api, a, b, stay, mover };
  }

  it('gives the same class rate on the overview and the stats tab when a student left mid-month', () => {
    const { api, a } = leaverSetup();
    // stay 2/3 + mover's two A-days before leaving 2/2 = 4/5.
    assert.equal(api.getClassOverview(a.class_id).month.homework_rate, 80);
    assert.equal(trendRate(api, a.class_id), 80);
  });

  it('counts the leaver in the new class only from the move date', () => {
    const { api, b, mover } = leaverSetup();
    assert.equal(api.getClassOverview(b.class_id).month.homework_rate, 0);
    assert.equal(trendRate(api, b.class_id), 0);
    // A 09-02 완료, A 09-09 완료, B 09-22 미완료; the stray A 09-21 check is left out.
    assert.equal(api.getStudentOverview(mover.student_id).month.homework_rate, 67);
    const tab = api.getStudentHomework(mover.student_id, MONTH);
    assert.equal(tab.rate, 67);
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
    giveHomework(api, a.class_id, '2026-09-21', ['p1', 'p2'], [[s, 0, '완료']]);
    assert.equal(api.getStudentOverview(s.student_id).month.homework_rate, 100);
    assert.equal(api.getStudentHomework(s.student_id, MONTH).rate, 100);
    const row = logRow(api, a.class_id, '2026-09-21');
    assert.equal(row.rate, 100);
    assert.equal(row.checked, true);
    assert.deepEqual(row.cells[s.student_id], { done: 1, total: 2, checked: 1, missing: [] });
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
    const row = logRow(api, a.class_id, '2026-09-21');
    assert.equal(row.rate, null);
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
    giveHomework(api, cls.class_id, '2026-09-07', ['p1', 'p2'], [[hong, 0, '완료'], [lee, 0, '미완료'], [lee, 1, '미완료']]);
    giveHomework(api, cls.class_id, '2026-09-09', ['p3'], [[hong, 0, '미완료'], [lee, 0, '완료']]);

    const context = api.getClassPlanContext(cls.class_id, '2026-09');
    const input = context.input;
    const byId = {};
    Object.entries(context.aliases).forEach(([ref, id]) => { byId[id] = input.students.find((s) => s.ref === ref); });
    assert.equal(byId[lee.student_id], undefined);
    // hong: p1 완료, p3 미완료; p2 was never checked.
    assert.equal(byId[hong.student_id].homework_rate, 50);
    assert.equal(byId[kim.student_id].homework_rate, null);
    // The class keeps lee's checks from while lee was in it (09-07), not the stray 09-09 one.
    assert.equal(input.class_stats_last_4_weeks.homework_rate, 25);
  });
});
