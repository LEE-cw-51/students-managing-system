'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
const { seedRich } = require('../scripts/dev-data.js');

const TODAY = '2026-10-26';

function seeded() {
  const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
  api.ensureSchema();
  return { api, demo: seedRich(api, TODAY) };
}

describe('monthly report board and bulk generation', () => {
  it('lists class members with lesson counts and statuses', () => {
    const { api, demo } = seeded();
    const board = api.getMonthlyReportBoard(demo.classes[0].class_id, 2026, 10);
    assert.equal(board.rows.length, 4);
    assert.ok(board.rows.every((r) => r.status === '미작성' && r.lesson_count > 0));
    assert.equal(api.getMonthlyReportBoard('', 2026, 10).rows.length, 12, 'all enrolled students');
  });

  it('creates drafts, never touches confirmed reports, overwrites drafts only on request', () => {
    const { api, demo } = seeded();
    const ids = api.getMonthlyReportBoard(demo.classes[0].class_id, 2026, 10).rows.map((r) => r.student_id);
    api.saveMonthlyReport({ student_id: ids[0], year: 2026, month: 10, report_text: '직접 쓴 확정본', status: '확정' });
    const first = api.generateMonthlyReportsBulk(ids, 2026, 10, {});
    assert.deepEqual(first.map((r) => r.result), ['skipped', 'created', 'created', 'created']);
    assert.equal(first[0].reason, '확정됨');
    assert.ok(api.generateMonthlyReportsBulk(ids, 2026, 10, {}).every((r) => r.result === 'skipped'));
    const again = api.generateMonthlyReportsBulk(ids, 2026, 10, { overwrite: true });
    assert.deepEqual(again.map((r) => r.result), ['skipped', 'created', 'created', 'created']);
    assert.equal(api.generateMonthlyReport(ids[0], 2026, 10).text, '직접 쓴 확정본');
  });

  it('skips students without lessons that month', () => {
    const { api, demo } = seeded();
    const res = api.generateMonthlyReportsBulk([demo.students[0].student_id], 2026, 5, {});
    assert.equal(res[0].reason, '이 달 수업 기록 없음');
  });
});

describe('daily report board', () => {
  it('returns reports and students with no record that day', () => {
    const { api, demo } = seeded();
    const classId = demo.classes[0].class_id;
    const full = api.getDailyReportBoard('2026-10-21', classId);
    assert.equal(full.reports.length, 4);
    assert.equal(full.missing.length, 0);
    const empty = api.getDailyReportBoard('2026-10-26', classId);
    assert.equal(empty.reports.length, 0);
    assert.equal(empty.missing.length, 4);
  });
});
