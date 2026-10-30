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
    detail.rows.forEach((r) => {
      if (r.score === null) assert.equal(r.rank, null);
      else assert.ok(r.rank >= 1);
    });
  });

  it('detail shares rank on ties and leaves absent or not-taken unranked', () => {
    const { api, demo } = seeded();
    const classId = demo.classes[0].class_id;
    const [a, b, c, d] = demo.students;
    const extra = api.createStudent({
      name: '한가은', grade: '중2', enrollment_date: '2026-03-02', status: '재원', class_id: classId
    });
    const date = '2026-10-19';
    const row = (student, extraFields) => Object.assign({
      lesson_date: date, class_id: classId, student_id: student.student_id, attendance: '출석', test_max_score: 20
    }, extraFields);
    api.saveLessonsBatch([
      row(a, { test_status: '실시', test_score: 20 }),
      row(b, { test_status: '실시', test_score: 16 }),
      row(c, { test_status: '실시', test_score: 16 }),
      row(d, { test_status: '실시', test_score: 10 }),
      row(extra, { attendance: '결석', test_status: '미실시', test_score: '' })
    ]);
    const detail = api.getClassTestDetail(classId, date);
    const byName = Object.fromEntries(detail.rows.map((r) => [r.name, r]));
    assert.equal(byName['김민준'].rank, 1);
    assert.equal(byName['이서연'].rank, 2);
    assert.equal(byName['박지호'].rank, 2);
    assert.equal(byName['최하은'].rank, 4);
    assert.equal(byName['한가은'].score, null);
    assert.equal(byName['한가은'].rank, null);

    api.saveLessonsBatch([row(d, { test_status: '미실시', test_score: '' })]);
    const skipped = api.getClassTestDetail(classId, date);
    const choi = skipped.rows.find((r) => r.name === '최하은');
    assert.equal(choi.score, null);
    assert.equal(choi.rank, null);
    assert.equal(choi.attendance, '출석');
  });

  it('splits the test detail by paper and ranks within each', () => {
    const { api, demo } = seeded();
    const classId = demo.classes[0].class_id;
    const [a, b, c, d] = demo.students;
    const date = '2026-10-19';
    const row = (student, extraFields) => Object.assign({
      lesson_date: date, class_id: classId, student_id: student.student_id, attendance: '출석', test_status: '실시'
    }, extraFields);
    const own = { test_own: 'Y', test_title: '심화', test_max_score: 50, test_difficulty: '상' };
    api.saveLessonsBatch([
      row(a, { test_score: 20, test_max_score: 20 }),
      row(b, { test_score: 16, test_max_score: 20 }),
      row(c, Object.assign({ test_score: 30 }, own)),
      row(d, Object.assign({ test_score: 40 }, own))
    ]);
    const detail = api.getClassTestDetail(classId, date);
    assert.equal(detail.papers.length, 2);
    const [classPaper, ownPaper] = detail.papers;
    assert.equal(classPaper.own, false);
    assert.equal(classPaper.key, 'class');
    assert.equal(classPaper.stats.count, 2);
    assert.equal(classPaper.stats.average, 18);
    assert.deepEqual(classPaper.rows.map((r) => [r.student_id, r.rank]), [[a.student_id, 1], [b.student_id, 2]]);
    assert.equal(ownPaper.own, true);
    assert.equal(ownPaper.title, '심화');
    assert.equal(ownPaper.max, 50);
    assert.equal(ownPaper.difficulty, '상');
    assert.equal(ownPaper.stats.average, 35);
    assert.deepEqual(ownPaper.rows.map((r) => [r.student_id, r.rank]), [[d.student_id, 1], [c.student_id, 2]]);
    assert.deepEqual(detail.stats, classPaper.stats, 'top-level stats are the class paper');
    assert.equal(detail.rows.length, 4);

    const listed = api.getClassTests(classId, { start: date, end: date }).rows[0];
    assert.equal(listed.taken_count, 4);
    assert.equal(listed.other_paper_count, 2);
    assert.equal(listed.average, 18);
    assert.equal(listed.high, 20);
    assert.equal(listed.low, 16);

    const month = api.getClassOverview(classId).month;
    assert.notEqual(month.test_average_display, '-', 'own papers do not break the class month average');
    assert.equal(api.getClassTrend(classId, 1).months[0].test_comparable, true);
  });

  it('progress log skips dates before a new class existed', () => {
    const { api } = seeded();
    const cls = api.createClass({ class_name: '신규반', schedule: [{ day: '월', start: '18:00', end: '20:00' }] });
    const log = api.getClassProgressLog(cls.class_id, { start: '2026-09-01', end: TODAY });
    assert.equal(log.rows.length, 0);
  });
});
