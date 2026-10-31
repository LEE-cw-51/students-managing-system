'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

const TODAY = '2026-09-15';

function setup() {
  const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
  api.ensureSchema();
  const cls = api.createClass({
    class_name: '화목토반',
    weekday: '화/목/토',
    schedule: [
      { day: '화', start: '19:00', end: '21:00' },
      { day: '목', start: '19:00', end: '21:00' },
      { day: '토', start: '14:00', end: '16:00' }
    ]
  });
  const student = api.createStudent({ name: '김숙제', class_id: cls.class_id, enrollment_date: '2026-09-01' });
  const assigned = '2026-09-12'; // 토
  const checkDate = '2026-09-15'; // 화
  const saved = api.saveSessionHomework({
    lesson_date: assigned,
    class_id: cls.class_id,
    titles: ['워크북 10쪽', '오답노트']
  });
  api.saveHomeworkChecks({
    lesson_date: assigned,
    class_id: cls.class_id,
    check_date: checkDate,
    checks: saved.items.map((it) => ({ student_id: student.student_id, item_id: it.item_id, status: 'A' }))
  });
  return { api, cls, student, assigned, checkDate, items: saved.items };
}

describe('getStudentHomework for student tab edits', () => {
  it('includes item_id and an empty check_date until the checking lesson is recorded', () => {
    const t = setup();
    const hw = t.api.getStudentHomework(t.student.student_id, { start: '2026-09-01', end: '2026-09-30' });
    assert.equal(hw.rows.length, 1);
    const row = hw.rows[0];
    assert.equal(row.date, t.assigned);
    assert.equal(row.class_id, t.cls.class_id);
    assert.equal(row.check_date, '');
    assert.equal(row.items.length, 2);
    assert.ok(row.items.every((it) => it.item_id && it.item_id.startsWith('HWI_')));
    assert.deepEqual(row.items.map((it) => it.status), ['A', 'A']);
  });

  it('lets saveHomeworkChecks flip A to F and refresh the student view', () => {
    const t = setup();
    const before = t.api.getStudentHomework(t.student.student_id, { start: '2026-09-01', end: '2026-09-30' });
    const target = before.rows[0].items[0];
    t.api.saveHomeworkChecks({
      lesson_date: before.rows[0].date,
      class_id: before.rows[0].class_id,
      check_date: before.rows[0].check_date,
      checks: [{ student_id: t.student.student_id, item_id: target.item_id, status: 'F' }]
    });
    const after = t.api.getStudentHomework(t.student.student_id, { start: '2026-09-01', end: '2026-09-30' });
    const flipped = after.rows[0].items.find((it) => it.item_id === target.item_id);
    assert.equal(flipped.status, 'F');
    assert.equal(after.missing.length, 1);
    assert.equal(after.missing[0].title, target.title);
    assert.ok(after.rate < before.rate);
  });
});

describe('student tab homework edits and lesson records', () => {
  const RANGE = { start: '2026-09-01', end: '2026-09-30' };
  const lessonsOf = (t, date) => t.api.getLessons(date, t.cls.class_id);
  const record = (t, date, grade) => t.api.saveLessonsBatch([{
    lesson_date: date, class_id: t.cls.class_id, student_id: t.student.student_id,
    attendance: '출석', assignment_completion: grade
  }]);
  const flip = (t, row, item, status, checkDate) => t.api.saveHomeworkChecks({
    lesson_date: row.date,
    class_id: row.class_id,
    check_date: checkDate === undefined ? row.check_date : checkDate,
    checks: [{ student_id: t.student.student_id, item_id: item.item_id, status }]
  });

  it('saves only the checks when the next lesson is in the future and not recorded', () => {
    const t = setup();
    const today = t.api.saveSessionHomework({ lesson_date: TODAY, class_id: t.cls.class_id, titles: ['프린트'] });
    const row = t.api.getStudentHomework(t.student.student_id, RANGE).rows.find((r) => r.date === TODAY);
    assert.equal(row.check_date, '');
    flip(t, row, today.items[0], 'A', '2026-09-17');
    flip(t, row, today.items[0], 'F');
    assert.deepEqual(lessonsOf(t, '2026-09-17'), []);
    assert.deepEqual(lessonsOf(t, TODAY), []);
    const after = t.api.getStudentHomework(t.student.student_id, RANGE).rows.find((r) => r.date === TODAY);
    assert.equal(after.items[0].status, 'F');
  });

  it('updates the makeup-day lesson that checked the homework, not the scheduled next day', () => {
    const t = setup();
    record(t, '2026-09-14', 'A'); // 월 보강
    const row = t.api.getStudentHomework(t.student.student_id, RANGE).rows[0];
    assert.equal(row.check_date, '2026-09-14');
    flip(t, row, t.items[0], 'F');
    assert.equal(lessonsOf(t, '2026-09-14')[0].assignment_completion, 'C');
    assert.deepEqual(lessonsOf(t, t.checkDate), []);
  });

  it('regrades the recorded checking lesson when A becomes F', () => {
    const t = setup();
    record(t, t.checkDate, 'A');
    const row = t.api.getStudentHomework(t.student.student_id, RANGE).rows[0];
    assert.equal(row.check_date, t.checkDate);
    const result = flip(t, row, t.items[1], 'F');
    assert.equal(result.grades[0].assignment_completion, 'C');
    assert.equal(lessonsOf(t, t.checkDate)[0].assignment_completion, 'C');
  });

  it('ignores a wrong check_date and updates only the lesson the server determines', () => {
    const t = setup();
    record(t, t.checkDate, 'A');
    const row = t.api.getStudentHomework(t.student.student_id, RANGE).rows[0];
    const result = flip(t, row, t.items[0], 'F', '2026-09-19');
    assert.equal(result.check_date, t.checkDate);
    assert.equal(lessonsOf(t, t.checkDate)[0].assignment_completion, 'C');
    assert.deepEqual(lessonsOf(t, '2026-09-19'), []);
  });
});
