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

  it('rejects saving new text over a confirmed report until it is un-confirmed', () => {
    const { api, demo } = seeded();
    const sid = demo.students[0].student_id;
    const key = { student_id: sid, year: 2026, month: 10 };
    api.saveMonthlyReport({ ...key, report_text: '확정본', status: '확정' });
    for (const status of ['임시', '확정']) {
      assert.throws(() => api.saveMonthlyReport({ ...key, report_text: '덮어쓴 내용', status }),
        { message: '확정된 월간 보고서는 고칠 수 없습니다. 확정을 취소한 뒤 고쳐 주세요.' });
    }
    assert.equal(api.generateMonthlyReport(sid, 2026, 10).existing.report_text, '확정본');
    assert.equal(api.saveMonthlyReport({ ...key, report_text: '확정본', status: '확정' }).status, '확정', 're-confirming the same text is a no-op');
    assert.equal(api.saveMonthlyReport({ ...key, report_text: '확정본', status: '임시' }).status, '임시', '확정 취소');
    const edited = api.saveMonthlyReport({ ...key, report_text: '고친 내용', status: '확정' });
    assert.equal(edited.report_text, '고친 내용');
    assert.equal(edited.status, '확정');
  });

  it('bulk generation skips a report confirmed even with overwrite, and keeps going', () => {
    const { api, demo } = seeded();
    const ids = api.getMonthlyReportBoard(demo.classes[0].class_id, 2026, 10).rows.map((r) => r.student_id);
    api.generateMonthlyReportsBulk(ids, 2026, 10, {});
    api.saveMonthlyReport({ student_id: ids[1], year: 2026, month: 10, report_text: '확정본', status: '확정' });
    const res = api.generateMonthlyReportsBulk(ids, 2026, 10, { overwrite: true });
    assert.deepEqual(res.map((r) => r.result), ['created', 'skipped', 'created', 'created']);
    assert.equal(res[1].reason, '확정됨');
    assert.equal(api.generateMonthlyReport(ids[1], 2026, 10).text, '확정본');
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
