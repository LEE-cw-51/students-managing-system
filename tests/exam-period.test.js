'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
const { seedRich } = require('../scripts/dev-data.js');

const TODAY = '2026-10-26';

function setup() {
  const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
  api.ensureSchema();
  const demo = seedRich(api, TODAY); // exams: 한빛중2 11-11, 푸른중2 11-15, 새솔중2 11-18, 한빛중3 11-07, 새솔중3 11-29
  const period = api.saveExamPeriod({ title: '2학기 기말', start_date: '2026-11-02', end_date: '2026-11-30', exam_year: '2026', exam_semester: '2', exam_type: '기말' });
  const proposal = api.proposeExamGroups(period.exam_period_id);
  return { api, demo, period, proposal, classA: demo.classes[0].class_id, classB: demo.classes[1].class_id };
}

function applyAll(t) {
  return t.api.applyExamGroups(t.period.exam_period_id, {
    groups: t.proposal.groups,
    suspended_class_ids: t.proposal.regular_classes.filter((c) => c.suggested).map((c) => c.class_id)
  });
}

describe('exam period proposal', () => {
  it('groups by school+grade across spellings and defaults the end to the school exam date', () => {
    const t = setup();
    const hanbit = t.proposal.groups.find((g) => g.target_school === '한빛중학교' && g.target_grade === '중2');
    assert.equal(hanbit.students.length, 3, '한빛중 + 한빛중학교 together');
    assert.equal(hanbit.end_date, '2026-11-11');
    assert.equal(hanbit.schedule.length, 2, 'schedule copied from the main source class');
    assert.deepEqual(t.proposal.unassigned.map((u) => u.name), ['윤지우']);
  });
});

describe('applying groups', () => {
  it('creates exam classes, suspends originals and moves rosters by date', () => {
    const t = setup();
    const res = applyAll(t);
    assert.equal(res.classes.length, 5);
    const periods = [LMS.findById(t.api.getExamPeriods(), 'exam_period_id', t.period.exam_period_id)];
    const clsA = t.api.getClass(t.classA);
    assert.equal(LMS.classMeetsOnDate(clsA, '2026-11-04', periods), false, 'original suspended');
    const hanbit = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    assert.equal(LMS.classMeetsOnDate(hanbit, '2026-11-04', periods), true);
    assert.equal(LMS.classMeetsOnDate(hanbit, '2026-10-28', periods), false, 'not before the period');
    const session = t.api.getTodayClassSession('2026-11-04', hanbit.class_id);
    assert.equal(session.students.length, 3);
    assert.equal(t.api.getTodayClassSession('2026-10-28', hanbit.class_id).students.length, 0);
  });

  it('returns each student after their own exam; the class restarts with the first one back (E1)', () => {
    const t = setup();
    applyAll(t);
    const detail = () => t.api.getExamPeriodDetail(t.period.exam_period_id);
    const a = () => detail().suspended.find((s) => s.class_id === t.classA);
    const p = () => [LMS.findById(t.api.getExamPeriods(), 'exam_period_id', t.period.exam_period_id)];
    // A반: 한빛중 (exam 11-11) and 푸른중 (exam 11-15) students
    assert.equal(a().resume_date, '2026-11-12', 'first student back the day after 11-11');
    assert.deepEqual(a().returns.map((r) => r.date), ['2026-11-12', '2026-11-16']);
    assert.equal(LMS.classMeetsOnDate(t.api.getClass(t.classA), '2026-11-04', p()), false, 'everyone away → suspended');
    const classA = t.api.getClass(t.classA);
    const meetDay = LMS.nextMeetingDateFor(classA, '2026-11-12', p());
    assert.equal(meetDay, '2026-11-16', 'first A반 lesson after resuming (월/수)');
    const roster = (d) => t.api.getTodayClassSession(d, t.classA).students.map((s) => s.name).sort();
    assert.deepEqual(roster('2026-11-16'), ['김민준', '박지호', '이서연', '최하은'], 'all back on 11-16');

    // 푸른중 students finish early on 11-09 → they rejoin A반 from 11-10 while 한빛중 is still away.
    const pureun = detail().classes.find((c) => c.class_name.startsWith('푸른중 중2'));
    pureun.students.forEach((m) => t.api.endTempAssignment(m.rel_id, '2026-11-09'));
    assert.equal(a().resume_date, '2026-11-10');
    assert.equal(LMS.classMeetsOnDate(t.api.getClass(t.classA), '2026-11-11', p()), true);
    assert.deepEqual(roster('2026-11-11'), ['박지호', '최하은'], 'only returned students in A반');
    const hanbit = detail().classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    assert.equal(t.api.getTodayClassSession('2026-11-11', hanbit.class_id).students.length, 3, '한빛중 still in exam class');
  });

  it('keeps moved students off a class that was not suspended (E2)', () => {
    const t = setup();
    t.api.applyExamGroups(t.period.exam_period_id, { groups: t.proposal.groups, suspended_class_ids: [] });
    const roster = t.api.getTodayClassSession('2026-11-02', t.classA).students.map((s) => s.name);
    assert.deepEqual(roster, [], 'all A반 students are in exam classes that day');
    const after = t.api.getTodayClassSession('2026-11-30', t.classA).students.length;
    assert.equal(after, 4, 'back after their exams');
  });

  it('rejects double placement (E3) and reports unplaced students (E5)', () => {
    const t = setup();
    applyAll(t);
    const someone = t.proposal.groups[0].students[0];
    const other = t.api.getExamPeriodDetail(t.period.exam_period_id).classes[1];
    assert.throws(() => t.api.addTempAssignment({ class_id: other.class_id, student_id: someone.student_id }), /이미 다른 시험대비 반/);
    const b = t.api.getExamPeriodDetail(t.period.exam_period_id).suspended.find((s) => s.class_id === t.classB);
    assert.deepEqual(b.unplaced.map((u) => u.name), ['윤지우']);
  });

  it('class stats count temporary members (E6)', () => {
    const t = setup();
    const res = applyAll(t);
    const hanbit = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    t.api.saveLessonsBatch(t.api.getTodayClassSession('2026-11-02', hanbit.class_id).students.map((s) => ({
      lesson_date: '2026-11-02', class_id: hanbit.class_id, student_id: s.student_id, attendance: '출석'
    })));
    assert.equal(t.api.getClassStats(hanbit.class_id, 2026, 11).students.length, 3);
  });

  it('first lesson after the suspension checks the homework from before it (E9)', () => {
    const t = setup();
    applyAll(t);
    const ses = t.api.getTodayClassSession('2026-11-16', t.classA);
    assert.equal(ses.prior_homework.assigned_date, '2026-10-28', 'last A반 meeting before the suspension');
  });

  it('deletes only periods without lessons and clips assignments when dates shrink', () => {
    const t = setup();
    const res = applyAll(t);
    t.api.saveExamPeriod({ ...t.period, end_date: '2026-11-20' });
    const ends = t.api.getExamPeriodDetail(t.period.exam_period_id).classes.flatMap((c) => c.students.map((m) => m.end_date));
    assert.ok(ends.every((d) => d <= '2026-11-20'), 'assignments clipped (E8)');
    const hanbit = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    t.api.saveLessonsBatch([{ lesson_date: '2026-11-02', class_id: hanbit.class_id, student_id: t.proposal.groups.find((g) => g.class_name === hanbit.class_name).students[0].student_id, attendance: '출석' }]);
    assert.throws(() => t.api.deleteExamPeriod(t.period.exam_period_id), /삭제할 수 없습니다/);
    t.api.closeExamPeriod(t.period.exam_period_id);
    assert.equal(t.api.getClass(hanbit.class_id).status, '종료');
    const fresh = t.api.saveExamPeriod({ title: '빈 기간', start_date: '2026-12-01', end_date: '2026-12-10' });
    t.api.deleteExamPeriod(fresh.exam_period_id);
    assert.ok(!t.api.getExamPeriods().some((p) => p.exam_period_id === fresh.exam_period_id));
  });
});
