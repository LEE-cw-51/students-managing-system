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
    checks: saved.items.map((it) => ({ student_id: student.student_id, item_id: it.item_id, status: '완료' }))
  });
  return { api, cls, student, assigned, checkDate, items: saved.items };
}

describe('getStudentHomework for student tab edits', () => {
  it('includes item_id and next-meeting check_date', () => {
    const t = setup();
    const hw = t.api.getStudentHomework(t.student.student_id, { start: '2026-09-01', end: '2026-09-30' });
    assert.equal(hw.rows.length, 1);
    const row = hw.rows[0];
    assert.equal(row.date, t.assigned);
    assert.equal(row.class_id, t.cls.class_id);
    assert.equal(row.check_date, t.checkDate);
    assert.equal(row.items.length, 2);
    assert.ok(row.items.every((it) => it.item_id && it.item_id.startsWith('HWI_')));
    assert.deepEqual(row.items.map((it) => it.status), ['완료', '완료']);
  });

  it('lets saveHomeworkChecks flip 완료 to 미완료 and refresh the student view', () => {
    const t = setup();
    const before = t.api.getStudentHomework(t.student.student_id, { start: '2026-09-01', end: '2026-09-30' });
    const target = before.rows[0].items[0];
    t.api.saveHomeworkChecks({
      lesson_date: before.rows[0].date,
      class_id: before.rows[0].class_id,
      check_date: before.rows[0].check_date,
      checks: [{ student_id: t.student.student_id, item_id: target.item_id, status: '미완료' }]
    });
    const after = t.api.getStudentHomework(t.student.student_id, { start: '2026-09-01', end: '2026-09-30' });
    const flipped = after.rows[0].items.find((it) => it.item_id === target.item_id);
    assert.equal(flipped.status, '미완료');
    assert.equal(after.missing.length, 1);
    assert.equal(after.missing[0].title, target.title);
    assert.ok(after.rate < before.rate);
  });
});
