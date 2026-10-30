'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const { seedRich } = require('../scripts/dev-data.js');

const TODAY = '2026-10-24';

function seeded() {
  const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
  api.ensureSchema();
  const demo = seedRich(api, TODAY);
  return { api, demo };
}

const lesson = (date, extra) => Object.assign({ lesson_date: date, attendance: '출석', assignment_completion: 'A', concentration: 'A' }, extra);

describe('student badges', () => {
  it('flags absences once instead of also as low concentration', () => {
    const badges = LMS.studentBadges([
      lesson('2026-10-01'),
      lesson('2026-10-05', { attendance: '결석', concentration: 'ABSENT', assignment_completion: '' }),
      lesson('2026-10-08', { attendance: '결석', concentration: 'ABSENT', assignment_completion: '' })
    ], {});
    assert.deepEqual(badges.map((b) => b.code), ['absent_streak']);
  });

  it('flags missing homework in 2 of the last 3 checks', () => {
    const badges = LMS.studentBadges([], {
      homeworkDates: [
        { date: '2026-09-01', incomplete: true },
        { date: '2026-10-01', incomplete: true },
        { date: '2026-10-05', incomplete: false },
        { date: '2026-10-08', incomplete: true }
      ]
    });
    assert.equal(badges[0].code, 'homework_missing');
    assert.match(badges[0].label, /2회/);
  });

  it('flags a counseling gap only for students enrolled 60+ days', () => {
    assert.equal(LMS.studentBadges([], { today: TODAY, enrollmentDate: '2026-10-01' }).length, 0);
    const gap = LMS.studentBadges([], { today: TODAY, enrollmentDate: '2026-03-01', lastCounselDate: '2026-07-01' });
    assert.equal(gap[0].code, 'counsel_gap');
    assert.equal(gap[0].tone, 'muted');
    assert.equal(LMS.studentBadges([], { today: TODAY, enrollmentDate: '2026-03-01', lastCounselDate: '2026-10-01' }).length, 0);
  });
});

describe('counseling follow-ups', () => {
  it('creates, moves, completes and cancels the linked task', () => {
    const { api, demo } = seeded();
    const sid = demo.students[0].student_id;
    const note = api.saveCounselingNote({ student_id: sid, kind: '학부모', counsel_date: TODAY, content: '통화', follow_up_date: '2026-11-07' });
    assert.ok(note.follow_up_task_id);
    const task = () => api.getDayAgenda('2026-11-07').items.find((i) => i.task_id === note.follow_up_task_id || i.id === note.follow_up_task_id);
    assert.ok(task(), 'shows on the agenda of that day');

    const moved = api.saveCounselingNote({ ...note, follow_up_date: '2026-11-10', follow_up_title: '재통화' });
    assert.equal(moved.follow_up_task_id, note.follow_up_task_id, 'same task is moved');
    assert.ok(!task());

    api.updateTaskStatus(note.follow_up_task_id, '완료');
    const [listed] = api.getCounselingNotes(sid).filter((n) => n.note_id === note.note_id);
    assert.equal(listed.follow_up_status, '완료');

    const cleared = api.saveCounselingNote({ ...moved, follow_up_date: '' });
    assert.equal(cleared.follow_up_task_id, '');
    const n2 = api.saveCounselingNote({ student_id: sid, kind: '학생', counsel_date: TODAY, content: 'x', follow_up_date: '2026-11-01' });
    api.deleteCounselingNote(n2.note_id);
    const agenda = api.getDayAgenda('2026-11-01').items.filter((i) => i.task_id === n2.follow_up_task_id || i.id === n2.follow_up_task_id);
    assert.ok(agenda.every((i) => i.status === '취소'), 'deleted note cancels its task');
  });

  it('refuses to move a note to another student on update', () => {
    const { api, demo } = seeded();
    const [a, b] = demo.students;
    const note = api.saveCounselingNote({ student_id: a.student_id, kind: '학부모', counsel_date: TODAY, content: '통화' });
    assert.throws(() => api.saveCounselingNote({ ...note, student_id: b.student_id, content: '바꿈' }),
      { message: '다른 학생의 상담일지는 수정할 수 없습니다.' });
    const [stored] = api.getCounselingNotes(a.student_id).filter((n) => n.note_id === note.note_id);
    assert.equal(stored.content, '통화');
    assert.equal(api.getCounselingNotes(b.student_id).some((n) => n.note_id === note.note_id), false);
  });
});

describe('bulk status change', () => {
  function twoInClass() {
    const api = LMS.createService(createMemoryStore());
    const a = api.createClass({ class_name: 'A반', grade: '중2', weekday: '월/수', start_time: '18:00', end_time: '20:00' }).class_id;
    const ids = ['홍길동', '김철수'].map((name) => api.createStudent({ name, grade: '중2', class_id: a, enrollment_date: '2026-03-01' }).student_id);
    return { api, a, ids };
  }
  const statusOf = (api, sid) => api.getStudent(sid).status;
  const classesOf = (api, sid) => api.getStudent(sid).current_classes.length;

  it('휴원 keeps the class assignments', () => {
    const { api, ids } = twoInClass();
    assert.deepEqual(api.setStudentsStatus({ student_ids: ids, status: '휴원' }), { count: 2 });
    ids.forEach((sid) => {
      assert.equal(statusOf(api, sid), '휴원');
      assert.equal(classesOf(api, sid), 1);
    });
  });

  it('퇴원 ends the class assignments', () => {
    const { api, a, ids } = twoInClass();
    assert.equal(api.setStudentsStatus({ student_ids: ids, status: '퇴원' }).count, 2);
    ids.forEach((sid) => {
      assert.equal(statusOf(api, sid), '퇴원');
      assert.equal(classesOf(api, sid), 0);
    });
    assert.equal(api.getClassRoster(a).length, 0);
  });

  it('rejects an unknown status or no students', () => {
    const { api, ids } = twoInClass();
    assert.throws(() => api.setStudentsStatus({ student_ids: ids, status: '졸업' }), /학생 상태 값이 올바르지 않습니다/);
    assert.throws(() => api.setStudentsStatus({ student_ids: [], status: '휴원' }), /학생을 골라 주세요/);
    ids.forEach((sid) => assert.equal(statusOf(api, sid), '재원'));
  });
});

describe('student views', () => {
  it('list carries classes, badges and next exam', () => {
    const { api } = seeded();
    const list = api.getStudentList({ status: '재원' });
    assert.equal(list.length, 12);
    const parkJiho = list.find((r) => r.name === '박지호');
    assert.deepEqual(parkJiho.classes.map((c) => c.class_name), ['중2 A반']);
    assert.ok(parkJiho.badges.some((b) => b.code === 'assignment_c_streak'));
    assert.equal(parkJiho.next_exam.d_day, 20);
    assert.equal(api.getStudentList({ query: '한빛' }).length, 5);
  });

  it('attendance month marks scheduled, recorded and future days', () => {
    const { api, demo } = seeded();
    const m = api.getStudentAttendanceMonth(demo.students[0].student_id, '2026-10');
    const kinds = (date) => m.days.find((d) => d.date === date).entries.map((e) => e.kind);
    assert.deepEqual(kinds('2026-10-21'), ['present']);
    assert.deepEqual(kinds('2026-10-26'), ['scheduled']);
    assert.deepEqual(kinds('2026-10-20'), []);
    assert.equal(m.counts.missing, 0);
  });

  it('grades include class average and rank', () => {
    const { api, demo } = seeded();
    const g = api.getStudentGrades(demo.students[0].student_id, {});
    assert.ok(g.rows.length > 0);
    assert.ok(g.rows[0].rank >= 1 && g.rows[0].rank <= g.rows[0].taken);
    g.rows.forEach((row) => {
      assert.equal(row.score_100, (row.score / row.max_score) * 100);
      assert.ok(row.class_average_100 >= 0 && row.class_average_100 <= 100);
    });
  });

  it('converts each taker to 100 points before averaging, even when maxes differ', () => {
    const api = LMS.createService(createMemoryStore({ today: '2026-09-21', now: '2026-09-21T09:00:00' }));
    api.ensureSchema();
    const demo = seedDemo(api);
    const classId = demo.class.class_id;
    const [hong, kim, lee] = demo.students;
    api.saveLessonsBatch([
      { lesson_date: '2026-09-16', class_id: classId, student_id: hong.student_id, attendance: '출석', test_status: '실시', test_score: 8, test_max_score: 10 },
      { lesson_date: '2026-09-16', class_id: classId, student_id: kim.student_id, attendance: '출석', test_status: '실시', test_score: 40, test_max_score: 50 },
      { lesson_date: '2026-09-16', class_id: classId, student_id: lee.student_id, attendance: '결석', test_status: '미실시' }
    ]);
    const g = api.getStudentGrades(hong.student_id, { start: '2026-09-01', end: '2026-09-21' });
    const sameMax = g.rows.find((r) => r.date === '2026-09-14');
    assert.equal(sameMax.score, 18);
    assert.equal(sameMax.max_score, 20);
    assert.equal(sameMax.score_100, 90);
    assert.equal(sameMax.class_average, 19);
    assert.equal(sameMax.class_average_100, 95);
    assert.equal(sameMax.rank, 2);
    assert.equal(sameMax.taken, 2);
    const mixed = g.rows.find((r) => r.date === '2026-09-16');
    assert.equal(mixed.score_100, 80);
    assert.equal(mixed.class_average, 24);
    assert.equal(mixed.class_average_100, 80);
    assert.equal(mixed.rank, 2);
    assert.equal(mixed.taken, 2);
    const kimGrades = api.getStudentGrades(kim.student_id, { start: '2026-09-16', end: '2026-09-16' });
    assert.equal(kimGrades.rows[0].score_100, 80);
    assert.equal(kimGrades.rows[0].class_average_100, 80);
    assert.equal(kimGrades.rows[0].rank, 1);
  });

  it('grades share rank on ties', () => {
    const { api, demo } = seeded();
    const classId = demo.classes[0].class_id;
    const [a, b, c, d] = demo.students;
    const date = '2026-10-19';
    const row = (student, extraFields) => Object.assign({
      lesson_date: date, class_id: classId, student_id: student.student_id, attendance: '출석', test_max_score: 20
    }, extraFields);
    api.saveLessonsBatch([
      row(a, { test_status: '실시', test_score: 20 }),
      row(b, { test_status: '실시', test_score: 16 }),
      row(c, { test_status: '실시', test_score: 16 }),
      row(d, { test_status: '실시', test_score: 10 })
    ]);
    const rankOf = (student) => api.getStudentGrades(student.student_id, { start: date, end: date }).rows[0];
    assert.deepEqual([a, b, c, d].map((s) => rankOf(s).rank), [1, 2, 2, 4]);
    [a, b, c, d].forEach((s) => assert.equal(rankOf(s).taken, 4));
  });

  it('ranks among the same paper and converts the whole class for the 100-point average', () => {
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
    const gradeOf = (student) => api.getStudentGrades(student.student_id, { start: date, end: date }).rows[0];
    const session = api.getClassSession(date, classId);

    const ga = gradeOf(a);
    assert.equal(ga.own_paper, false);
    assert.equal(ga.title, session.test_title);
    assert.equal(ga.rank, 1);
    assert.equal(ga.taken, 2);
    assert.equal(ga.class_average, 18);
    assert.equal(ga.class_average_100, 80);

    const gc = gradeOf(c);
    assert.equal(gc.own_paper, true);
    assert.equal(gc.title, '심화');
    assert.equal(gc.difficulty, '상');
    assert.equal(gc.max_score, 50);
    assert.equal(gc.rank, 2);
    assert.equal(gc.taken, 2);
    assert.equal(gc.class_average, 35);
    assert.equal(gc.score_100, 60);
    assert.equal(gc.class_average_100, 80, '100-point average spans every taker of the day');
    assert.equal(gradeOf(d).rank, 1);
  });
});
