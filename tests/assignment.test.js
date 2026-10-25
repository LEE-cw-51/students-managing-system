'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

// Store "today" is 2026-09-14.
function setup() {
  const store = createMemoryStore();
  const api = LMS.createService(store);
  const a = api.createClass({ class_name: 'A반', grade: '중2', weekday: '월/수', start_time: '18:00', end_time: '20:00' });
  const b = api.createClass({ class_name: 'B반', grade: '중2', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
  const c = api.createClass({ class_name: 'C반', grade: '중2', weekday: '금', start_time: '18:00', end_time: '20:00' });
  const s = api.createStudent({ name: '홍길동', grade: '중2', class_id: a.class_id, enrollment_date: '2026-03-01' });
  return { store, api, a, b, c, s };
}

const relsOf = (store, sid) => store.readTable('StudentClasses').filter((r) => r.student_id === sid);
const lesson = (api, s, cls, date) => api.saveLesson({ lesson_date: date, student_id: s.student_id, class_id: cls.class_id, attendance: '출석', test_status: '미실시' });

describe('moving a student', () => {
  it('ends only the class they leave when they attend two', () => {
    const { store, api, a, b, c, s } = setup();
    api.assignStudentToClass({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-04-01' });
    assert.throws(() => api.moveStudent({ student_id: s.student_id, class_id: c.class_id, start_date: '2026-09-15' }), /어느 반에서/);
    api.moveStudent({ student_id: s.student_id, class_id: c.class_id, start_date: '2026-09-15', from_class_id: a.class_id });
    const rels = relsOf(store, s.student_id);
    assert.equal(rels.find((r) => r.class_id === a.class_id).status, '종료');
    assert.equal(rels.find((r) => r.class_id === a.class_id).end_date, '2026-09-14');
    assert.equal(rels.find((r) => r.class_id === b.class_id).status, '현재');
    assert.equal(rels.find((r) => r.class_id === c.class_id).status, '현재');
  });

  it('refuses a move date on the start day, before later lessons, or into a class they attend', () => {
    const { api, a, b, s } = setup();
    assert.throws(() => api.moveStudent({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-03-01' }), /배정 삭제/);
    lesson(api, s, a, '2026-09-14');
    assert.throws(() => api.moveStudent({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-09-14' }), /2026-09-14/);
    assert.throws(() => api.moveStudent({ student_id: s.student_id, class_id: a.class_id, start_date: '2026-09-20' }), /같은 반/);
  });

  it('moves several students together, or nobody when one cannot move', () => {
    const { store, api, a, b, s } = setup();
    const t = api.createStudent({ name: '김철수', grade: '중2', class_id: a.class_id, enrollment_date: '2026-03-01' });
    lesson(api, s, a, '2026-09-21');
    assert.throws(() => api.moveStudents({ from_class_id: a.class_id, to_class_id: b.class_id, student_ids: [s.student_id, t.student_id], date: '2026-09-16' }),
      /홍길동: 이동일 이후\(2026-09-21\)/);
    assert.equal(relsOf(store, t.student_id)[0].status, '현재', 'nobody moved');
    const res = api.moveStudents({ from_class_id: a.class_id, to_class_id: b.class_id, student_ids: [s.student_id, t.student_id], date: '2026-09-22' });
    assert.equal(res.moved_count, 2);
    const members = api.getClassMembers(b.class_id);
    assert.deepEqual(members.upcoming.map((m) => m.name).sort(), ['김철수', '홍길동'].sort(), 'booked from 9/22, not yet current');
    assert.equal(members.past.length, 0);
    assert.equal(api.getClassMembers(a.class_id).current.length, 2, 'still in A until 9/21');
  });
});

describe('taking a student out of a class', () => {
  it('ends the assignment, making the student unassigned', () => {
    const { api, a, s } = setup();
    lesson(api, s, a, '2026-09-07');
    assert.throws(() => api.closeStudentClass({ student_id: s.student_id, class_id: a.class_id, end_date: '2026-02-01' }), /시작일/);
    assert.throws(() => api.closeStudentClass({ student_id: s.student_id, class_id: a.class_id, end_date: '2026-09-01' }), /2026-09-07/);
    api.closeStudentClass({ student_id: s.student_id, class_id: a.class_id, end_date: '2026-09-10' });
    const list = api.getStudentList({ status: '재원', class_id: '__none__' });
    assert.deepEqual(list.map((r) => r.name), ['홍길동']);
    assert.equal(api.getStudentOverview(s.student_id).unassigned, true);
    assert.equal(api.getTodayBoard('2026-09-14').unassigned_count, 1);
  });

  it('deletes a mistaken assignment only when it left no records', () => {
    const { store, api, a, b, s } = setup();
    const wrong = api.assignStudentToClass({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-09-14' });
    assert.equal(api.getClassMembers(b.class_id).current[0].removable, true);
    api.removeStudentClass({ id: wrong.id });
    assert.equal(relsOf(store, s.student_id).length, 1);
    lesson(api, s, a, '2026-09-07');
    const kept = relsOf(store, s.student_id)[0];
    assert.equal(api.getClassMembers(a.class_id).current[0].removable, false);
    assert.throws(() => api.removeStudentClass({ id: kept.id }), /반에서 빼기/);
  });

  it('counts a booked future class as assigned', () => {
    const { api, a, b, s } = setup();
    api.closeStudentClass({ student_id: s.student_id, class_id: a.class_id, end_date: '2026-09-13' });
    api.assignStudentToClass({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-10-01' });
    const row = api.getStudentList({ status: '재원' }).find((r) => r.student_id === s.student_id);
    assert.equal(row.unassigned, false);
    assert.deepEqual(row.upcoming.map((u) => [u.class_name, u.start_date]), [['B반', '2026-10-01']]);
  });
});

describe('assigning', () => {
  it('refuses closed classes, exam-prep classes and withdrawn students', () => {
    const { api, b, s } = setup();
    api.closeClass(b.class_id);
    assert.throws(() => api.assignStudentToClass({ student_id: s.student_id, class_id: b.class_id }), /종료된 반/);
    const exam = api.createClass({ class_name: '시험반', class_type: '시험대비' });
    assert.throws(() => api.assignStudentToClass({ student_id: s.student_id, class_id: exam.class_id }), /시험 화면/);
    const gone = api.createStudent({ name: '퇴원생', status: '퇴원' });
    const c = api.createClass({ class_name: 'D반' });
    assert.throws(() => api.assignStudentToClass({ student_id: gone.student_id, class_id: c.class_id }), /퇴원/);
  });

  it('lists regular class ids per student in the search index', () => {
    const { api, a, s } = setup();
    const boot = api.getShellBootstrap();
    assert.deepEqual(boot.search.students.find((x) => x.id === s.student_id).class_ids, [a.class_id]);
  });
});
