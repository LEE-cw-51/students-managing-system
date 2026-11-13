'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');

// The AI preview, the module's check and the real write answer from one rule: a refusal carries
// the same message in all three, and when the preview passes the write goes through.
function setup() {
  const store = createMemoryStore();
  const demo = seedDemo(LMS.createService(store));
  const svc = () => LMS.createService(store);
  const check = () => LMS.createAssignments({
    table: (name) => store.readTable(name) || [],
    saveTable: () => { throw new Error('a check wrote'); },
    today: () => store.today(),
    now: () => '',
    nextIds: () => { throw new Error('a check took an id'); }
  }).check;
  const [hong, kim, lee] = demo.students.map((s) => s.student_id);
  const A = demo.class.class_id;
  const api = svc();
  const B = api.createClass({ class_name: '중2 B반', grade: '중2', weekday: '화/목', start_time: '18:00', end_time: '20:00' }).class_id;
  const closed = api.createClass({ class_name: '종료 반', weekday: '금', start_time: '18:00', end_time: '20:00' }).class_id;
  api.closeClass(closed);
  const period = api.saveExamPeriod({ title: '2학기 중간', start_date: '2026-09-21', end_date: '2026-10-10' });
  const exam = api.createClass({
    class_name: '중2 중간대비', grade: '중2', weekday: '토', start_time: '10:00', end_time: '12:00',
    class_type: '시험대비', exam_period_id: period.exam_period_id
  }).class_id;
  const relOf = (sid, cid, status) => store.readTable('StudentClasses')
    .find((r) => r.student_id === sid && r.class_id === cid && r.status === (status || '현재')).id;
  return { store, svc, check, hong, kim, lee, A, B, closed, exam, relOf };
}

function messageOf(fn) {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return assert.fail('expected a refusal');
}

/** preview(tool, args), check() and write(api) refuse with one message; returns it. */
function refusesAlike(t, tool, args, check, write) {
  const fromPreview = messageOf(() => t.svc().previewAgentAction(tool, args));
  assert.equal(check(t.check()), fromPreview, tool + ' check');
  assert.equal(messageOf(() => write(t.svc())), fromPreview, tool + ' write');
  return fromPreview;
}

/** preview(tool, args) and check() pass, and write(api) goes through. */
function passesAlike(t, tool, args, check, write) {
  t.svc().previewAgentAction(tool, args);
  assert.equal(check(t.check()), '', tool + ' check');
  return write(t.svc());
}

describe('assign: preview, check and write agree', () => {
  const assign = (t, sid, cid, start) => refusesAlike(t, 'assign_student_to_class',
    { student_id: sid, class_id: cid, start_date: start },
    (c) => c.assign({ student_id: sid, class_id: cid, start_date: start }),
    (api) => api.assignStudentToClass({ student_id: sid, class_id: cid, start_date: start }));

  it('refuses a withdrawn student, a closed class, an exam class and the same class twice', () => {
    const t = setup();
    t.svc().archiveStudent(t.lee);
    assert.equal(assign(t, t.lee, t.B, '2026-09-15'), '퇴원한 학생은 반에 배정할 수 없습니다.');
    assert.equal(assign(t, t.hong, t.closed, '2026-09-15'), '종료된 반에는 배정할 수 없습니다.');
    assert.equal(assign(t, t.hong, t.exam, '2026-09-15'), '시험대비 반은 시험 화면에서 편성해 주세요.');
    assert.equal(assign(t, t.hong, t.A, '2026-09-15'), '이미 해당 반에 소속되어 있습니다.');
  });

  it('refuses a start overlapping an earlier assignment in the class (the preview used to leave it to the write)', () => {
    const t = setup();
    t.svc().closeStudentClass({ student_id: t.hong, class_id: t.A, end_date: '2026-09-14' });
    assert.equal(assign(t, t.hong, t.A, '2026-09-10'),
      '이 반의 이전 배정(2026-03-01 ~ 2026-09-14)과 기간이 겹칩니다. 시작일을 2026-09-15 이후로 잡아 주세요.');
  });

  it('passes and assigns', () => {
    const t = setup();
    const args = { student_id: t.hong, class_id: t.B, start_date: '2026-09-15' };
    const row = passesAlike(t, 'assign_student_to_class', args, (c) => c.assign(args), (api) => api.assignStudentToClass(args));
    assert.equal(row.class_id, t.B);
  });

  it('a new student created with a class follows the same rule', () => {
    const t = setup();
    const args = { name: '박민수', grade: '중2', class_id: t.closed, enrollment_date: '2026-09-01' };
    const message = refusesAlike(t, 'create_student', args,
      (c) => c.assign({ class_id: t.closed, start_date: '2026-09-01' }, { student_id: '', status: '재원' }),
      (api) => api.createStudent(args));
    assert.equal(message, '종료된 반에는 배정할 수 없습니다.');
    const ok = Object.assign({}, args, { class_id: t.B });
    const created = passesAlike(t, 'create_student', ok,
      (c) => c.assign({ class_id: t.B, start_date: '2026-09-01' }, { student_id: '', status: '재원' }),
      (api) => api.createStudent(ok));
    assert.deepEqual(created.current_classes.map((c) => c.class_id), [t.B]);
  });
});

describe('move: preview, check and write agree', () => {
  const move = (t, sid, to, start) => refusesAlike(t, 'move_student',
    { student_id: sid, class_id: to, start_date: start },
    (c) => c.move({ student_id: sid, class_id: to, from_class_id: t.A, start_date: start }),
    (api) => api.moveStudent({ student_id: sid, class_id: to, from_class_id: t.A, start_date: start }));

  it('refuses each move rule with the write\'s message', () => {
    const t = setup();
    assert.equal(move(t, t.hong, t.A, '2026-09-15'), '지금 다니는 반과 같은 반입니다.');
    assert.equal(move(t, t.hong, t.closed, '2026-09-15'), '종료된 반으로는 옮길 수 없습니다.');
    assert.equal(move(t, t.hong, t.exam, '2026-09-15'), '시험대비 반은 시험 화면에서 편성해 주세요.');
    // The preview used to drop the second sentence of this message.
    assert.equal(move(t, t.hong, t.B, '2026-03-01'),
      '이동일은 지금 반 시작일(2026-03-01) 다음 날부터 고를 수 있습니다. 잘못 넣은 배정이면 배정 삭제 후 다시 배정해 주세요.');
    assert.equal(move(t, t.hong, t.B, '2026-09-14'), '이동일 이후(2026-09-14) 지금 반에 수업 기록이 있습니다. 이동일을 그 뒤로 잡아 주세요.');
    t.svc().assignStudentToClass({ student_id: t.hong, class_id: t.B, start_date: '2026-09-15' });
    assert.equal(refusesAlike(t, 'move_student',
      { student_id: t.hong, class_id: t.B, start_date: '2026-09-20', from_class_id: t.A },
      (c) => c.move({ student_id: t.hong, class_id: t.B, from_class_id: t.A, start_date: '2026-09-20' }),
      (api) => api.moveStudent({ student_id: t.hong, class_id: t.B, from_class_id: t.A, start_date: '2026-09-20' })),
    '이미 중2 B반에 다니고 있습니다.');
  });

  it('passes and moves', () => {
    const t = setup();
    const data = { student_id: t.hong, class_id: t.B, from_class_id: t.A, start_date: '2026-09-15' };
    const row = passesAlike(t, 'move_student', { student_id: t.hong, class_id: t.B, start_date: '2026-09-15' },
      (c) => c.move(data), (api) => api.moveStudent(data));
    assert.equal(row.class_id, t.B);
  });

  it('a batch move refuses with every student\'s reason, or moves them all', () => {
    const t = setup();
    t.svc().closeStudentClass({ student_id: t.kim, class_id: t.A, end_date: '2026-09-14' });
    const data = { from_class_id: t.A, to_class_id: t.B, student_ids: [t.hong, t.kim], date: '2026-09-15' };
    assert.equal(refusesAlike(t, 'move_students', data, (c) => c.moveMany(data), (api) => api.moveStudents(data)),
      '옮기지 않았습니다.\n김철수: 이 반의 정규 배정이 아닙니다.');
    const ok = Object.assign({}, data, { student_ids: [t.hong, t.lee] });
    assert.deepEqual(passesAlike(t, 'move_students', ok, (c) => c.moveMany(ok), (api) => api.moveStudents(ok)), { moved_count: 2 });
  });
});

describe('start, close and remove: preview, check and write agree', () => {
  it('start date: refuses moving it past the first lesson, passes an earlier one', () => {
    const t = setup();
    const id = t.relOf(t.hong, t.A);
    const late = { id, start_date: '2026-09-15' };
    assert.equal(refusesAlike(t, 'update_student_class_start', { rel_id: id, start_date: late.start_date },
      (c) => c.changeStart(late), (api) => api.updateStudentClassStart(late)),
    '이 반 수업 기록이 2026-09-14부터 있어 시작일을 그 뒤로 옮길 수 없습니다.');
    const ok = { id, start_date: '2026-03-02' };
    assert.equal(passesAlike(t, 'update_student_class_start', { rel_id: id, start_date: ok.start_date },
      (c) => c.changeStart(ok), (api) => api.updateStudentClassStart(ok)).start_date, '2026-03-02');
  });

  it('close: refuses an end before the start or before a recorded lesson, and an ended assignment', () => {
    const t = setup();
    const id = t.relOf(t.hong, t.A);
    const close = (end) => refusesAlike(t, 'close_student_class', { rel_id: id, end_date: end },
      (c) => c.close({ id, end_date: end }), (api) => api.closeStudentClass({ id, end_date: end }));
    assert.equal(close('2026-02-01'), '마지막 수업일이 반 시작일(2026-03-01)보다 빠릅니다. 잘못 넣은 배정이면 배정 삭제를 써 주세요.');
    assert.equal(close('2026-09-13'), '마지막 수업일 뒤(2026-09-14)에 이 반 수업 기록이 있습니다. 날짜를 그 뒤로 잡아 주세요.');
    const ok = { id, end_date: '2026-09-14' };
    assert.equal(passesAlike(t, 'close_student_class', { rel_id: id, end_date: ok.end_date },
      (c) => c.close(ok), (api) => api.closeStudentClass(ok)).status, '종료');
    assert.equal(close('2026-09-20'), '현재 반 배정 정보를 찾을 수 없습니다.');
  });

  it('remove: refuses an assignment with lessons, removes one without', () => {
    const t = setup();
    const id = t.relOf(t.hong, t.A);
    assert.equal(refusesAlike(t, 'remove_student_class', { rel_id: id },
      (c) => c.remove({ id }), (api) => api.removeStudentClass({ id })),
    '이 반에 수업 기록이나 숙제 체크가 있어 삭제할 수 없습니다. ‘반에서 빼기’를 써 주세요.');
    t.svc().assignStudentToClass({ student_id: t.hong, class_id: t.B, start_date: '2026-09-15' });
    const fresh = t.relOf(t.hong, t.B);
    assert.deepEqual(passesAlike(t, 'remove_student_class', { rel_id: fresh },
      (c) => c.remove({ id: fresh }), (api) => api.removeStudentClass({ id: fresh })), { deleted: true, id: fresh });
  });
});

describe('exam-prep placements: preview, check and write agree', () => {
  const addTemp = (t, data) => refusesAlike(t, 'add_temp_assignment', data,
    (c) => c.addTemp(data), (api) => api.addTempAssignment(data));

  it('refuses a regular class, a student not 재원, dates outside the period and an overlap', () => {
    const t = setup();
    assert.equal(addTemp(t, { class_id: t.A, student_id: t.hong }), '시험대비 반이 아닙니다.');
    t.svc().setStudentsStatus({ student_ids: [t.kim], status: '휴원' });
    assert.equal(addTemp(t, { class_id: t.exam, student_id: t.kim }), '김철수 학생은 재원생이 아니라 편성할 수 없습니다.');
    assert.equal(addTemp(t, { class_id: t.exam, student_id: t.hong, start_date: '2026-09-20' }), '날짜는 시험대비 기간 안이어야 합니다.');
    const ok = { class_id: t.exam, student_id: t.hong, start_date: '2026-09-21', end_date: '2026-10-01' };
    assert.equal(passesAlike(t, 'add_temp_assignment', ok, (c) => c.addTemp(ok), (api) => api.addTempAssignment(ok)).status, '임시');
    assert.equal(addTemp(t, { class_id: t.exam, student_id: t.hong, start_date: '2026-09-28' }),
      '홍길동 학생은 그 기간에 이미 다른 시험대비 반에 배정되어 있습니다.');
  });

  it('early return: refuses a date before the start or past the period, passes one inside', () => {
    const t = setup();
    t.svc().addTempAssignment({ class_id: t.exam, student_id: t.hong, start_date: '2026-09-25' });
    const id = t.relOf(t.hong, t.exam, '임시');
    const end = (date) => refusesAlike(t, 'end_temp_assignment', { rel_id: id, date },
      (c) => c.endTemp(id, date), (api) => api.endTempAssignment(id, date));
    assert.equal(end('2026-09-24'), '마지막 수업일이 시작일보다 빠릅니다. 배정을 빼려면 ‘제외’를 쓰세요.');
    assert.equal(end('2026-10-11'), '마지막 수업일은 시험대비 기간 안이어야 합니다.');
    assert.equal(passesAlike(t, 'end_temp_assignment', { rel_id: id, date: '2026-10-03' },
      (c) => c.endTemp(id, '2026-10-03'), (api) => api.endTempAssignment(id, '2026-10-03')).end_date, '2026-10-03');
  });
});

describe('assignment module interface', () => {
  it('assign ignores a second argument, so the browser cannot skip the exam-prep sync', () => {
    const t = setup();
    const asg = LMS.createAssignments({
      table: (name) => t.store.readTable(name) || [], saveTable: () => {}, today: () => '2026-09-14', now: () => '', nextIds: () => ['REL-X']
    });
    assert.equal(asg.assign.length, 1);
  });

  it('close_class preview lists the open regular assignments the close ends', () => {
    const t = setup();
    const preview = t.svc().previewAgentAction('close_class', { class_id: t.A });
    assert.match(preview.text, /현재 배정 학생 3명/);
    t.svc().previewAgentAction('close_class', { class_id: t.exam });
  });
});
