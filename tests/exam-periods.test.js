'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

const MON = [{ day: '월', start: '18:00', end: '20:00' }];
const TUE = [{ day: '화', start: '18:00', end: '20:00' }];

/** The exam period module over plain tables, with the assignment module wired as in the service. */
function moduleOver(tables, today = '2026-11-05') {
  let seq = 0;
  const base = {
    table: (name) => tables[name] || (tables[name] = []),
    saveTable: (name, rows) => { tables[name] = rows; },
    today: () => today,
    now: () => today + 'T09:00:00',
    nextIds: (prefix, n) => Array.from({ length: n || 1 }, () => prefix + '_' + (++seq))
  };
  let periods = null;
  const asg = LMS.createAssignments({ ...base, resumeStale: (id) => periods.recomputeResume(id) });
  periods = LMS.createExamPeriods({
    ...base,
    assignments: asg,
    requireStudent: (id) => {
      const row = LMS.findById(tables.Students || [], 'student_id', id);
      if (!row) throw new Error('학생 정보를 찾을 수 없습니다.');
      return row;
    }
  });
  return { periods, asg, tables };
}

/** Period P (11-02 ~ 11-30) suspends A (Mon); B (Tue) is not suspended. X is P's exam class, Y another period's. */
function fixture() {
  return moduleOver({
    Classes: [
      { class_id: 'A', class_name: 'A반', class_type: '정규', status: '운영', schedule: MON },
      { class_id: 'B', class_name: 'B반', class_type: '정규', status: '운영', schedule: TUE },
      { class_id: 'X', class_name: '대비반', class_type: '시험대비', status: '운영', exam_period_id: 'P', schedule: MON },
      { class_id: 'Y', class_name: '다른 대비반', class_type: '시험대비', status: '운영', exam_period_id: 'Q', schedule: MON },
      { class_id: 'Z', class_name: '정규인데 기간 값', class_type: '정규', status: '운영', exam_period_id: 'P', schedule: MON }
    ],
    Students: [
      { student_id: 's1', name: '가', status: '재원', school: '한빛중학교', grade: '중2' },
      { student_id: 's2', name: '나', status: '재원', school: '한빛중학교', grade: '중2' },
      { student_id: 's3', name: '다', status: '재원', school: '한빛중학교', grade: '중2' }
    ],
    ExamPeriods: [
      { exam_period_id: 'P', title: '기말', start_date: '2026-11-02', end_date: '2026-11-30', status: '진행', suspended_class_ids: ['A'], class_resume_dates: {} },
      { exam_period_id: 'Q', title: '다음', start_date: '2026-12-07', end_date: '2026-12-20', status: '준비', suspended_class_ids: ['B'], class_resume_dates: {} }
    ],
    StudentClasses: [
      { id: 'r1', student_id: 's1', class_id: 'A', start_date: '2026-09-01', end_date: '', status: '현재' },
      { id: 'r2', student_id: 's2', class_id: 'A', start_date: '2026-09-01', end_date: '', status: '현재' },
      { id: 'r3', student_id: 's3', class_id: 'B', start_date: '2026-09-01', end_date: '', status: '현재' },
      { id: 't1', student_id: 's1', class_id: 'X', start_date: '2026-11-02', end_date: '2026-11-12', status: '임시', source_class_id: 'A' },
      { id: 't2', student_id: 's2', class_id: 'X', start_date: '2026-11-02', end_date: '2026-11-18', status: '임시', source_class_id: 'A' },
      { id: 't3', student_id: 's3', class_id: 'X', start_date: '2026-11-02', end_date: '2026-11-10', status: '임시', source_class_id: 'B' }
    ],
    Lessons: [],
    SchoolExams: []
  });
}

const periodRow = (tables, id = 'P') => tables.ExamPeriods.find((p) => p.exam_period_id === id);

describe('exam period module: 시험대비 반 and state', () => {
  it('answers which classes are the period\'s exam-prep classes', () => {
    const { periods } = fixture();
    assert.deepEqual(periods.classIds('P'), ['X'], 'not another period\'s, not a regular class with a stray period id');
    assert.deepEqual(periods.classes('Q').map((c) => c.class_id), ['Y']);
    assert.deepEqual(periods.classIds('none'), []);
  });

  it('labels the period by its status and dates', () => {
    const { periods } = fixture();
    const p = { start_date: '2026-11-02', end_date: '2026-11-30', status: '진행' };
    assert.equal(periods.state(p, '2026-11-01'), '예정');
    assert.equal(periods.state(p, '2026-11-02'), '진행 중');
    assert.equal(periods.state(p, '2026-12-01'), '끝남');
    assert.equal(periods.state({ ...p, status: '종료' }, '2026-11-10'), '마감');
    assert.equal(periods.state({ ...p, status: '취소' }, '2026-11-10'), '취소');
  });

  it('requirePeriod throws the one Korean message', () => {
    const { periods } = fixture();
    assert.equal(periods.requirePeriod('P').title, '기말');
    assert.throws(() => periods.requirePeriod('nope'), /시험대비 기간을 찾을 수 없습니다/);
  });
});

describe('exam period module: 휴강 반 and 복귀일', () => {
  it('a suspended class resumes the day after its first moved student is back', () => {
    const { periods, tables } = fixture();
    periods.recomputeResume('P');
    // s3 is away from B, which is not suspended, so only s1 and s2 count for A.
    assert.deepEqual(periodRow(tables).class_resume_dates, { A: '2026-11-12' });
    const p = periodRow(tables);
    assert.equal(periods.lastSuspendedDay(p, 'A'), '2026-11-12');
    assert.equal(periods.resumeDate(p, 'A'), '2026-11-13');
    assert.deepEqual(periods.returns(p, 'A'), [
      { date: '2026-11-13', student_ids: ['s1'] },
      { date: '2026-11-19', student_ids: ['s2'] }
    ]);
  });

  it('without moved students the class stays off for the whole period', () => {
    const { periods, tables } = fixture();
    tables.StudentClasses = tables.StudentClasses.filter((r) => r.status !== '임시');
    periods.setSuspended('P', ['A', 'B']);
    assert.deepEqual(periodRow(tables).class_resume_dates, { A: '2026-11-30', B: '2026-11-30' });
    assert.equal(periods.resumeDate(periodRow(tables), 'A'), '2026-12-01');
    assert.deepEqual(periods.returns(periodRow(tables), 'A'), []);
  });

  it('counts a student attending the suspended class even when placed from another class', () => {
    const { periods, tables } = fixture();
    tables.StudentClasses.push({ id: 'r4', student_id: 's3', class_id: 'A', start_date: '2026-09-01', end_date: '', status: '현재' });
    periods.recomputeResume('P');
    assert.equal(periodRow(tables).class_resume_dates.A, '2026-11-10');
  });

  it('placement changes through the assignment module keep resume dates current', () => {
    const { periods, asg, tables } = fixture();
    periods.recomputeResume('P');
    asg.endTemp('t2', '2026-11-05');
    assert.equal(periodRow(tables).class_resume_dates.A, '2026-11-05');
    asg.removeTemp('t2');
    assert.equal(periodRow(tables).class_resume_dates.A, '2026-11-12');
  });

  it('places a class against periods on a date: exam class, suspended, upcoming or none', () => {
    const { periods, tables } = fixture();
    periods.recomputeResume('P');
    const cls = (id) => tables.Classes.find((c) => c.class_id === id);
    assert.deepEqual(periods.classContext(cls('X'), '2026-11-05'), { kind: 'exam_class', period: periodRow(tables) });
    const a = periods.classContext(cls('A'), '2026-11-09');
    assert.equal(a.kind, 'suspended');
    assert.equal(a.resume_date, '2026-11-13');
    assert.equal(periods.classContext(cls('A'), '2026-11-16'), null, 'resumed');
    const b = periods.classContext(cls('B'), '2026-11-05');
    assert.equal(b.kind, 'upcoming');
    assert.equal(b.period.exam_period_id, 'Q');
    assert.equal(b.resume_date, '2026-12-21');
    periodRow(tables, 'Q').status = '취소';
    assert.equal(periods.classContext(cls('B'), '2026-11-05'), null, 'a cancelled period suspends nothing');
  });

  it('lists the regular classes that would meet on a date but are suspended', () => {
    const { periods, tables } = fixture();
    periods.recomputeResume('P');
    assert.deepEqual(periods.suspendedOn('2026-11-09'), [
      { class_id: 'A', class_name: 'A반', period_title: '기말', resume_date: '2026-11-13' }
    ]);
    assert.deepEqual(periods.suspendedOn('2026-11-10'), [], 'A does not meet on Tuesday');
    assert.deepEqual(periods.suspendedOn('2026-11-16'), [], 'A is back');
    tables.Classes.find((c) => c.class_id === 'A').status = '종료';
    assert.deepEqual(periods.suspendedOn('2026-11-09'), []);
  });

  it('suggests the return day from the last day of the matching school exam', () => {
    const { periods, tables } = fixture();
    const key = LMS.schoolGroupKey('한빛중학교', '중2');
    tables.SchoolExams.push(
      { school_exam_id: 'S1', school_key: key, school_year: '2026', semester: '2', exam_type: '기말', exam_date: '2026-11-16', exam_end_date: '2026-11-18', math_exam_date: '2026-11-17' },
      { school_exam_id: 'S2', school_key: key, school_year: '2026', semester: '1', exam_type: '기말', exam_date: '2026-11-05', exam_end_date: '2026-11-05' }
    );
    const p = { ...periodRow(tables), exam_year: '2026', exam_semester: '2', exam_type: '기말' };
    assert.equal(periods.schoolExamLastDay(p, key), '2026-11-18', 'last exam day, not the math day');
    assert.equal(periods.schoolExamLastDay({ ...p, exam_semester: '' }, key), '2026-11-05', 'earliest match without a semester');
    assert.equal(periods.schoolExamLastDay(p, 'other'), '');
  });
});

describe('exam period module: commands', () => {
  it('forgetting a deleted regular class lifts it from suspension lists and resume dates', () => {
    const { periods, tables } = fixture();
    periods.recomputeResume('P');
    periods.forgetClass(tables.Classes.find((c) => c.class_id === 'A'));
    assert.deepEqual(periodRow(tables).suspended_class_ids, []);
    assert.deepEqual(periodRow(tables).class_resume_dates, {});
    assert.deepEqual(periodRow(tables, 'Q').suspended_class_ids, ['B'], 'other periods untouched');
  });

  it('check.remove answers with the message remove throws', () => {
    const { periods, tables } = fixture();
    assert.equal(periods.check.remove('P'), '');
    assert.match(periods.check.remove('nope'), /시험대비 기간을 찾을 수 없습니다/);
    tables.Lessons.push({ lesson_id: 'L1', student_id: 's1', class_id: 'X', lesson_date: '2026-11-02' });
    const problem = periods.check.remove('P');
    assert.match(problem, /수업 기록이 있는 시험대비 기간/);
    assert.throws(() => periods.remove('P'), { message: problem });
    tables.Lessons = [];
    assert.equal(periods.remove('P'), true);
    assert.equal(periods.find('P'), null);
    assert.deepEqual(tables.Classes.map((c) => c.class_id), ['A', 'B', 'Y', 'Z']);
    assert.ok(!tables.StudentClasses.some((r) => r.class_id === 'X'));
  });

  it('shrinking the dates clamps placements and recomputes resume dates', () => {
    const { periods, tables } = fixture();
    periods.save({ exam_period_id: 'P', title: '기말', start_date: '2026-11-02', end_date: '2026-11-11' });
    const t2 = tables.StudentClasses.find((r) => r.id === 't2');
    assert.equal(t2.end_date, '2026-11-11');
    assert.equal(periodRow(tables).class_resume_dates.A, '2026-11-11');
  });

  it('closing closes the period and its exam-prep classes only', () => {
    const { periods, tables } = fixture();
    periods.close('P');
    assert.equal(periodRow(tables).status, '종료');
    const status = (id) => tables.Classes.find((c) => c.class_id === id).status;
    assert.equal(status('X'), '종료');
    assert.equal(status('Y'), '운영');
    assert.equal(status('Z'), '운영');
  });
});

describe('exam period screens agree on 복귀일', () => {
  it('class list, class overview, today board and period detail show the same resume date', () => {
    const TODAY = '2026-11-09';
    const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
    const a = api.createClass({ class_name: 'A반', grade: '중2', weekday: '월', start_time: '18:00', end_time: '20:00' }).class_id;
    const s1 = api.createStudent({ name: '가', grade: '중2', class_id: a, enrollment_date: '2026-09-01' }).student_id;
    const s2 = api.createStudent({ name: '나', grade: '중2', class_id: a, enrollment_date: '2026-09-01' }).student_id;
    const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30' });
    api.applyExamGroups(period.exam_period_id, {
      groups: [{ class_name: '대비반', schedule: [{ day: '월', start: '18:00', end: '20:00' }],
        students: [{ student_id: s1, end_date: '2026-11-12' }, { student_id: s2, end_date: '2026-11-18' }] }],
      suspended_class_ids: [a]
    });
    const listed = api.getClassList().find((c) => c.class_id === a).exam;
    const overview = api.getClassOverview(a).exam;
    const board = api.getTodayBoard(TODAY).suspended.find((c) => c.class_id === a);
    const detail = api.getExamPeriodDetail(period.exam_period_id).suspended.find((c) => c.class_id === a);
    assert.equal(listed.kind, 'suspended');
    assert.deepEqual([listed.resume_date, overview.resume_date, board.resume_date, detail.resume_date], Array(4).fill('2026-11-13'));
    assert.equal(detail.last_suspended, '2026-11-12');
    assert.deepEqual(detail.returns, [{ date: '2026-11-13', names: ['가'] }, { date: '2026-11-19', names: ['나'] }]);
  });
});
