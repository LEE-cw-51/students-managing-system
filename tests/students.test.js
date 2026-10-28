'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
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
  });
});
