'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

// Store "today" is 2026-09-14 (월).
function setup() {
  const store = createMemoryStore();
  const api = LMS.createService(store);
  const a = api.createClass({ class_name: 'A반', grade: '중2', weekday: '월/수', start_time: '18:00', end_time: '20:00' });
  const b = api.createClass({ class_name: 'B반', grade: '중2', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
  const s = api.createStudent({ name: '홍길동', grade: '중2', class_id: a.class_id, enrollment_date: '2026-03-01' });
  return { store, api, a, b, s };
}

const names = (rows) => rows.map((r) => r.class_name);
const countOf = (api, classId) => api.getClassList({}).find((c) => c.class_id === classId).student_count;
const classIdsOf = (api, sid) => api.getShellBootstrap().search.students.find((x) => x.id === sid).class_ids;

describe('screens agree on a student’s classes (T1)', () => {
  it('after a move dated next week', () => {
    const { api, a, b, s } = setup();
    api.moveStudent({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-09-21' });

    const row = api.getStudentList({ status: '재원' }).find((r) => r.student_id === s.student_id);
    assert.deepEqual(names(row.classes), ['A반']);
    assert.deepEqual(names(row.upcoming), ['B반']);
    const overview = api.getStudentOverview(s.student_id);
    assert.deepEqual(names(overview.classes), ['A반']);
    assert.deepEqual(names(overview.upcoming_classes), ['B반']);
    assert.deepEqual(names(api.getStudent(s.student_id).current_classes), ['A반']);

    assert.equal(countOf(api, a.class_id), 1);
    assert.equal(api.getClass(a.class_id).student_count, 1, 'class detail counts like the class list');
    assert.equal(countOf(api, b.class_id), 0);
    assert.equal(api.getClass(b.class_id).student_count, 0);
    assert.deepEqual(api.getClassMembers(b.class_id).upcoming.map((m) => m.name), ['홍길동']);

    assert.deepEqual(classIdsOf(api, s.student_id), [b.class_id], 'the booked class is the one a further move acts on');
  });
});

describe('students on leave (T2)', () => {
  it('stay class members but are not lesson-record targets', () => {
    const { api, a, s } = setup();
    const t = api.createStudent({ name: '김철수', grade: '중2', class_id: a.class_id, enrollment_date: '2026-03-01' });
    api.saveSessionHomework({ lesson_date: '2026-09-09', class_id: a.class_id, items: [{ title: '프린트' }] });
    api.updateStudent(Object.assign({}, api.getStudent(s.student_id), { status: '휴원' }));

    assert.equal(countOf(api, a.class_id), 2);
    assert.equal(api.getClass(a.class_id).student_count, 2);
    assert.ok(api.getClassRoster(a.class_id).some((x) => x.student_id === s.student_id));

    const session = api.getTodayClassSession('2026-09-14', a.class_id);
    assert.deepEqual(session.students.map((x) => x.student_id), [t.student_id]);
    assert.deepEqual(session.on_leave, [{ student_id: s.student_id, name: '홍길동' }]);
    assert.deepEqual(api.getClassOverview(a.class_id).roster.map((x) => x.student_id), [t.student_id]);
    const log = api.getClassHomeworkLog(a.class_id, { start: '2026-09-01', end: '2026-09-14' });
    assert.deepEqual(log.students.map((x) => x.student_id), [t.student_id]);
  });
});

describe('exam-prep placements (T3)', () => {
  it('count in the exam class and leave the source roster, still listed as away', () => {
    const { api, a, s } = setup();
    const period = api.saveExamPeriod({ title: '중간', start_date: '2026-09-14', end_date: '2026-09-30' });
    const res = api.applyExamGroups(period.exam_period_id, {
      groups: [{ class_name: '대비반', schedule: [{ day: '금', start: '18:00', end: '20:00' }], students: [{ student_id: s.student_id, source_class_id: a.class_id }] }],
      suspended_class_ids: [a.class_id]
    });
    const exam = res.classes[0].class_id;

    assert.equal(api.getClass(exam).student_count, 1);
    assert.equal(countOf(api, exam), 1);
    assert.equal(api.getClass(a.class_id).student_count, 0);
    assert.ok(!api.getClassRoster(a.class_id).some((x) => x.student_id === s.student_id));
    const current = api.getClassMembers(a.class_id).current;
    assert.equal(current.length, 1);
    assert.equal(current[0].away.class_id, exam);
  });
});

describe('assignments module (T4)', () => {
  const tables = {
    Classes: [
      { class_id: 'R1', class_name: '정규1', class_type: '정규' },
      { class_id: 'R2', class_name: '정규2', class_type: '정규' },
      { class_id: 'X', class_name: '대비반', class_type: '시험대비' }
    ],
    Students: [
      { student_id: 's1', name: '가', status: '재원' },
      { student_id: 's2', name: '나', status: '퇴원' },
      { student_id: 's3', name: '다', status: '휴원' },
      { student_id: 's4', name: '라', status: '재원' }
    ],
    StudentClasses: [
      { id: 'dead', student_id: 's1', class_id: 'R2', start_date: '2026-01-01', end_date: '', status: '종료' },
      { id: 'r1', student_id: 's1', class_id: 'R1', start_date: '2026-03-01', end_date: '', status: '현재' },
      { id: 'next', student_id: 's1', class_id: 'R2', start_date: '2026-10-01', end_date: '', status: '현재' },
      { id: 'tmp', student_id: 's1', class_id: 'X', start_date: '2026-09-10', end_date: '2026-09-20', status: '임시', source_class_id: 'R1' },
      { id: 'gone', student_id: 's2', class_id: 'R1', start_date: '2026-03-01', end_date: '2026-09-10', status: '종료' },
      { id: 'leave', student_id: 's3', class_id: 'R1', start_date: '2026-03-01', end_date: '', status: '현재' }
    ]
  };
  const asg = LMS.createAssignments({ table: (name) => tables[name] || [], today: () => '2026-09-14' });
  const ids = (rows, key) => rows.map((r) => r[key || 'id']).sort();

  it('다니는 반 covers the date, temporary included; booked ones are upcoming', () => {
    assert.deepEqual(ids(asg.attending('s1')), ['r1', 'tmp']);
    assert.deepEqual(ids(asg.attending('s1', '2026-09-25')), ['r1']);
    assert.deepEqual(ids(asg.upcoming('s1')), ['next']);
    assert.deepEqual(ids(asg.attending('s1', '2026-10-01')), ['next', 'r1']);
  });

  it('열린 정규 배정 skips temporary placements and dead rows', () => {
    assert.deepEqual(ids(asg.openRegular('s1')), ['next', 'r1']);
    assert.equal(asg.firstRegular('s1').id, 'r1', 'a 종료 row without an end never counted');
  });

  it('반 구성원 drops students away in an exam class and keeps 퇴원 on closed past dates', () => {
    assert.deepEqual(ids(asg.members('R1'), 'student_id'), ['s3'], '가 is away, 나 left');
    assert.deepEqual(ids(asg.members('R1', '2026-09-05'), 'student_id'), ['s1', 's2', 's3']);
    assert.deepEqual(ids(asg.members('X'), 'student_id'), ['s1']);
    assert.deepEqual(ids(asg.awayFrom('R1')), ['tmp']);
  });

  it('수업 기록 대상 leaves 휴원 out as onLeave', () => {
    const t = asg.recordTargets('R1', '2026-09-05');
    assert.deepEqual(ids(t.students, 'student_id'), ['s1', 's2']);
    assert.deepEqual(ids(t.onLeave, 'student_id'), ['s3']);
  });

  it('미배정 is a 재원 student with no class and none booked', () => {
    assert.equal(asg.isUnassigned(tables.Students[3]), true);
    assert.equal(asg.isUnassigned(tables.Students[0]), false);
    assert.equal(asg.isUnassigned(tables.Students[2]), false, '휴원 is not 미배정');
  });

  it('range queries are inclusive and ignore dead rows', () => {
    assert.deepEqual(asg.regularClassIdsDuring('s1', '2026-09-01', '2026-09-30'), ['R1']);
    assert.deepEqual(asg.regularClassIdsDuring('s1', '2026-09-01', '2026-10-01').sort(), ['R1', 'R2']);
    assert.deepEqual(asg.membersDuring('R2', '2026-01-01', '2026-09-30'), []);
    assert.deepEqual(asg.membersDuring('R1', '2026-09-11', '2026-09-30').sort(), ['s1', 's3']);
  });

  it('inClassOn, history and tempPlacements', () => {
    assert.equal(asg.inClassOn('s1', 'X', '2026-09-20'), true);
    assert.equal(asg.inClassOn('s1', 'X', '2026-09-21'), false);
    assert.equal(asg.inClassOn('s1', 'R2'), false, 'booked, and the dead row never counted');
    assert.equal(asg.inClassOn('s2', 'R1', '2026-09-10'), true);
    assert.deepEqual(asg.history('s1').map((r) => r.id), ['next', 'tmp', 'r1', 'dead']);
    assert.deepEqual(ids(asg.tempPlacements(['X', 'R1'])), ['tmp']);
  });
});

// A반 (월/수) suspended 11-02 ~ 11-30 (11-02 is 월). 홍길동 is in A반 from 09-01 and placed in 대비반
// (월/금) 11-02 ~ 11-20, away from A반. `withB` also puts him in B반 (화/목) from 09-01.
function examSetup(today, withB) {
  const store = createMemoryStore({ today, now: today + 'T09:00:00' });
  const api = LMS.createService(store);
  const a = api.createClass({ class_name: 'A반', grade: '중2', weekday: '월/수', start_time: '18:00', end_time: '20:00' }).class_id;
  const b = api.createClass({ class_name: 'B반', grade: '중2', weekday: '화/목', start_time: '18:00', end_time: '20:00' }).class_id;
  const s = api.createStudent({ name: '홍길동', grade: '중2', class_id: a, enrollment_date: '2026-09-01' }).student_id;
  if (withB) api.assignStudentToClass({ student_id: s, class_id: b, start_date: '2026-09-01' });
  const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30' });
  const exam = api.applyExamGroups(period.exam_period_id, {
    groups: [{ class_name: '대비반', schedule: [{ day: '월', start: '18:00', end: '20:00' }, { day: '금', start: '18:00', end: '20:00' }],
      students: [{ student_id: s, source_class_id: a, end_date: '2026-11-20' }] }],
    suspended_class_ids: [a]
  }).classes[0].class_id;
  const temps = () => store.readTable('StudentClasses').filter((r) => r.status === '임시')
    .map((r) => [r.start_date, r.end_date, r.source_class_id]).sort();
  const resume = () => LMS.findById(api.getExamPeriods(), 'exam_period_id', period.exam_period_id).class_resume_dates[a];
  const regular = (cid) => api.getStudent(s).class_history.find((h) => h.class_id === cid);
  const lesson = (date) => api.saveLessonsBatch([{ lesson_date: date, class_id: exam, student_id: s, attendance: '출석' }]);
  const inExam = (date) => api.getClassRoster(exam, date).some((x) => x.student_id === s);
  return { api, a, b, s, exam, temps, resume, regular, lesson, inExam };
}

describe('exam-prep placements end with the regular assignment (T6)', () => {
  it('withdrawing mid-placement ends it yesterday', () => {
    const t = examSetup('2026-11-05');
    t.api.archiveStudent(t.s);
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-04', t.a]]);
    assert.equal(t.resume(), '2026-11-04');
    assert.equal(t.inExam('2026-11-06'), false);
  });

  it('withdrawing keeps the placement up to a later exam-class lesson', () => {
    const t = examSetup('2026-11-09');
    t.lesson('2026-11-09');
    t.api.archiveStudent(t.s);
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-09', t.a]]);
  });

  it('withdrawing ends the placement even when another regular class covers it', () => {
    const t = examSetup('2026-11-05', true);
    t.api.archiveStudent(t.s);
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-04', t.a]]);
  });

  it('taking the student out mid-placement ends it on the last lesson day', () => {
    const t = examSetup('2026-11-09');
    t.api.closeStudentClass({ id: t.regular(t.a).id, end_date: '2026-11-06' });
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-06', t.a]]);
    assert.equal(t.resume(), '2026-11-06');
    assert.equal(t.inExam('2026-11-09'), false);
    assert.ok(!t.api.getClassRoster(t.a, '2026-11-09').some((x) => x.student_id === t.s));
  });

  it('taking the student out before a started placement keeps it while it has lessons', () => {
    const t = examSetup('2026-11-05');
    t.lesson('2026-11-02');
    t.api.closeStudentClass({ id: t.regular(t.a).id, end_date: '2026-10-31' });
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-02', t.a]]);
  });

  it('taking the student out points the rest at another regular class', () => {
    const t = examSetup('2026-11-09', true);
    t.api.closeStudentClass({ id: t.regular(t.a).id, end_date: '2026-11-06' });
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-06', t.a], ['2026-11-07', '2026-11-20', t.b]]);
    assert.equal(t.inExam('2026-11-10'), true);
    assert.ok(!t.api.getClassRoster(t.b, '2026-11-10').some((x) => x.student_id === t.s), 'away from B반');
  });

  it('closing the class mid-placement ends it yesterday', () => {
    const t = examSetup('2026-11-05');
    t.api.closeClass(t.a);
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-04', t.a]]);
    assert.equal(t.resume(), '2026-11-04');
  });

  it('closing the class before the period drops the placement', () => {
    const t = examSetup('2026-10-26');
    t.api.closeClass(t.a);
    assert.deepEqual(t.temps(), []);
    assert.equal(t.resume(), '2026-11-30');
  });

  it('deleting the assignment drops a placement made from it', () => {
    const t = examSetup('2026-10-26');
    t.api.removeStudentClass({ id: t.regular(t.a).id });
    assert.deepEqual(t.temps(), []);
    assert.equal(t.resume(), '2026-11-30');
    assert.equal(t.inExam('2026-11-02'), false);
  });

  it('deleting one of two assignments points the placement at the other', () => {
    const t = examSetup('2026-10-26', true);
    t.api.removeStudentClass({ id: t.regular(t.a).id });
    assert.deepEqual(t.temps(), [['2026-11-02', '2026-11-20', t.b]]);
  });
});

describe('assignments module commands (T7)', () => {
  function moduleTables() {
    const tables = {
      Classes: [
        { class_id: 'A', class_name: 'A반', class_type: '정규', status: '운영' },
        { class_id: 'X', class_name: '대비반', class_type: '시험대비', status: '운영', exam_period_id: 'P' }
      ],
      Students: [{ student_id: 's1', name: '가', status: '재원' }, { student_id: 's2', name: '나', status: '재원' }],
      ExamPeriods: [{ exam_period_id: 'P', start_date: '2026-11-02', end_date: '2026-11-30', suspended_class_ids: ['A'], class_resume_dates: {} }],
      StudentClasses: [
        { id: 'r1', student_id: 's1', class_id: 'A', start_date: '2026-09-01', end_date: '', status: '현재' },
        { id: 'r2', student_id: 's2', class_id: 'A', start_date: '2026-09-01', end_date: '', status: '현재' },
        { id: 't1', student_id: 's1', class_id: 'X', start_date: '2026-11-02', end_date: '2026-11-20', status: '임시', source_class_id: 'A' },
        { id: 't2', student_id: 's2', class_id: 'X', start_date: '2026-11-09', end_date: '2026-11-25', status: '임시', source_class_id: 'A' }
      ],
      Lessons: []
    };
    let seq = 0;
    const asg = LMS.createAssignments({
      table: (name) => tables[name] || (tables[name] = []),
      saveTable: (name, rows) => { tables[name] = rows; },
      today: () => '2026-11-05',
      now: () => '2026-11-05T09:00:00',
      nextIds: (prefix, n) => Array.from({ length: n || 1 }, () => prefix + '_' + (++seq))
    });
    return { tables, asg };
  }
  const temp = (tables, id) => tables.StudentClasses.find((r) => r.id === id);

  it('close ends running placements, drops later ones and recomputes resume dates', () => {
    const { tables, asg } = moduleTables();
    asg.close({ id: 'r1', end_date: '2026-11-04' });
    assert.equal(temp(tables, 't1').end_date, '2026-11-04');
    asg.close({ id: 'r2', end_date: '2026-11-04' });
    assert.equal(temp(tables, 't2'), undefined, 'not started yet');
    assert.deepEqual(tables.ExamPeriods[0].class_resume_dates, { A: '2026-11-04' });
  });

  it('endForClassClose and endForWithdrawal use the same rule', () => {
    const one = moduleTables();
    one.asg.endForClassClose('A');
    assert.equal(temp(one.tables, 't1').end_date, '2026-11-04');
    assert.equal(temp(one.tables, 't2'), undefined);
    const two = moduleTables();
    two.tables.Lessons.push({ lesson_id: 'L1', student_id: 's2', class_id: 'X', lesson_date: '2026-11-09' });
    two.asg.endForWithdrawal('s2');
    assert.equal(temp(two.tables, 't2').end_date, '2026-11-09', 'kept up to its lesson');
    assert.equal(temp(two.tables, 't1').end_date, '2026-11-20', 'other students untouched');
  });
});

describe('answers follow changes in the same service instance (T5)', () => {
  it('take out, then assign elsewhere', () => {
    const { api, a, b, s } = setup();
    assert.ok(api.getClassRoster(a.class_id).some((x) => x.student_id === s.student_id));
    api.closeStudentClass({ student_id: s.student_id, class_id: a.class_id, end_date: '2026-09-13' });
    assert.equal(api.getClassRoster(a.class_id).length, 0);
    assert.equal(api.getStudentOverview(s.student_id).unassigned, true);
    assert.deepEqual(classIdsOf(api, s.student_id), []);
    api.assignStudentToClass({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-09-14' });
    assert.equal(countOf(api, b.class_id), 1);
    assert.deepEqual(classIdsOf(api, s.student_id), [b.class_id]);
    assert.equal(api.getStudentOverview(s.student_id).unassigned, false);
  });
});
