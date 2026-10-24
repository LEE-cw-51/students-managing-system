'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
const { seedRich } = require('../scripts/dev-data.js');

const TODAY = '2026-10-24';

function seeded() {
  const store = createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' });
  const api = LMS.createService(store);
  api.ensureSchema();
  const demo = seedRich(api, TODAY);
  return { api, demo };
}

describe('class workspace views', () => {
  it('lists classes with schedule labels and next meeting', () => {
    const { api } = seeded();
    const list = api.getClassList({ status: '운영' });
    assert.equal(list.length, 3);
    const b = list.find((c) => c.class_name === '중2 B반');
    assert.equal(b.schedule_label, '화 19:00–21:00 · 목 19:00–21:00 · 토 14:00–16:00');
    assert.deepEqual(b.next, { date: '2026-10-24', time: { start: '14:00', end: '16:00' } });
    assert.equal(b.student_count, 4);
  });

  it('progress log merges sessions, schedule and daily plans', () => {
    const { api, demo } = seeded();
    const classId = demo.classes[0].class_id;
    api.saveClassPlan({ class_id: classId, period_type: '일간', period_key: '2026-10-21', title: '닮음 도입' });
    const log = api.getClassProgressLog(classId, { start: '2026-10-01', end: TODAY });
    const row = log.rows.find((r) => r.date === '2026-10-21');
    assert.ok(row.progress);
    assert.equal(row.plan.title, '닮음 도입');
    assert.equal(row.roster_count, 4);
    assert.ok(log.rows.every((r, i, all) => i === 0 || all[i - 1].date > r.date), 'newest first');
  });

  it('homework log reports per-student completion', () => {
    const { api, demo } = seeded();
    const log = api.getClassHomeworkLog(demo.classes[1].class_id, { start: '2026-10-01', end: TODAY });
    assert.equal(log.students.length, 4);
    const checked = log.rows.find((r) => r.checked);
    const cell = checked.cells[log.students[0].student_id];
    assert.equal(cell.total, 2);
    assert.ok(cell.done >= 0 && cell.done <= 2);
  });

  it('tests summarise scores and detail sorts by score', () => {
    const { api, demo } = seeded();
    const classId = demo.classes[1].class_id;
    const tests = api.getClassTests(classId, {});
    assert.ok(tests.rows.length > 0);
    const detail = api.getClassTestDetail(classId, tests.rows[0].date);
    const scores = detail.rows.map((r) => r.score).filter((s) => s !== null);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
    assert.equal(detail.stats.count, tests.rows[0].taken_count);
  });

  it('progress log skips dates before a new class existed', () => {
    const { api } = seeded();
    const cls = api.createClass({ class_name: '신규반', schedule: [{ day: '월', start: '18:00', end: '20:00' }] });
    const log = api.getClassProgressLog(cls.class_id, { start: '2026-09-01', end: TODAY });
    assert.equal(log.rows.length, 0);
  });
});
