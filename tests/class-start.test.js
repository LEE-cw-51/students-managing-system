'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');

// Demo class meets 월/수; seedDemo records 2026-09-14 (월) for its three students.
function seeded() {
  const api = LMS.createService(createMemoryStore({ today: '2026-09-16' }));
  api.ensureSchema();
  const demo = seedDemo(api);
  return { api, demo, classId: demo.class.class_id };
}

const names = (api, date, classId) => api.getTodayClassSession(date, classId).students.map((s) => s.name);
const relOf = (api, studentId, classId) => api.getStudent(studentId).class_history.find((h) => h.class_id === classId);

describe('class assignment start date', () => {
  it('pulling the start earlier puts a late-registered student on past rosters, with a warning first', () => {
    const { api, classId } = seeded();
    const s = api.createStudent({ name: '신입', grade: '중2', status: '재원', class_id: classId });
    assert.ok(!names(api, '2026-09-14', classId).includes('신입'));
    const rel = relOf(api, s.student_id, classId);
    const preview = api.previewClassStartChange({ id: rel.id, start_date: '2026-09-01' });
    assert.equal(preview.problem, '');
    assert.deepEqual(preview.missing_dates, ['2026-09-14']);
    api.updateStudentClassStart({ id: rel.id, start_date: '2026-09-01' });
    assert.ok(names(api, '2026-09-14', classId).includes('신입'));
  });

  it('cannot start after the first lesson in that class or after the end date', () => {
    const { api, demo, classId } = seeded();
    const rel = relOf(api, demo.students[0].student_id, classId);
    assert.match(api.previewClassStartChange({ id: rel.id, start_date: '2026-09-15' }).problem, /2026-09-14부터/);
    assert.throws(() => api.updateStudentClassStart({ id: rel.id, start_date: '2026-09-15' }), /2026-09-14부터/);
    api.closeStudentClass({ id: rel.id, end_date: '2026-09-14' });
    assert.match(api.previewClassStartChange({ id: rel.id, start_date: '2026-09-20' }).problem, /늦을 수 없습니다/);
  });

  it('a move-created assignment cannot start before the old class ended', () => {
    const { api, demo } = seeded();
    const other = api.createClass({ school_year: '2026', semester: '2', grade: '중2', class_name: 'B반', weekday: '월/수', start_time: '18:00', end_time: '20:00', status: '운영' });
    const [hong] = demo.students;
    api.moveStudent({ student_id: hong.student_id, class_id: other.class_id, start_date: '2026-09-21' });
    const rel = relOf(api, hong.student_id, other.class_id);
    assert.match(api.previewClassStartChange({ id: rel.id, start_date: '2026-09-15' }).problem, /반 이동/);
    assert.equal(api.previewClassStartChange({ id: rel.id, start_date: '2026-09-23' }).problem, '');
  });

  it('assignments of the same class may not overlap, on assign or on start change', () => {
    const { api, demo, classId } = seeded();
    const [hong] = demo.students;
    const rel = relOf(api, hong.student_id, classId);
    api.closeStudentClass({ id: rel.id, end_date: '2026-09-14' });
    assert.throws(() => api.assignStudentToClass({ student_id: hong.student_id, class_id: classId, start_date: '2026-09-10' }), /기간이 겹칩니다/);
    const again = api.assignStudentToClass({ student_id: hong.student_id, class_id: classId, start_date: '2026-09-21' });
    assert.match(api.previewClassStartChange({ id: again.id, start_date: '2026-09-14' }).problem, /겹칩니다/);
  });

  it('changing the enrollment date moves the first assignment only when asked and when it started that day', () => {
    const { api, classId } = seeded();
    const s = api.createStudent({ name: '신입', grade: '중2', status: '재원', class_id: classId, enrollment_date: '2026-09-16' });
    const plain = api.updateStudent(Object.assign({}, api.getStudent(s.student_id), { enrollment_date: '2026-09-10' }));
    assert.equal(plain.class_start_sync, null);
    assert.equal(relOf(api, s.student_id, classId).start_date, '2026-09-16');
    const synced = api.updateStudent(Object.assign({}, api.getStudent(s.student_id), { enrollment_date: '2026-09-16' }));
    assert.equal(synced.class_start_sync, null, 'start no longer equals the old enrollment date');
    const asked = api.updateStudent(Object.assign({}, api.getStudent(s.student_id), { enrollment_date: '2026-09-01', sync_class_start: true }));
    assert.deepEqual(asked.class_start_sync, { synced: true, problem: '' });
    assert.equal(relOf(api, s.student_id, classId).start_date, '2026-09-01');
    assert.ok(names(api, '2026-09-14', classId).includes('신입'));
  });

  it('the overview carries the first class start date for the edit form', () => {
    const { api, demo } = seeded();
    assert.equal(api.getStudentOverview(demo.students[0].student_id).student.first_class_start, '2026-03-01');
  });
});

describe('students on leave', () => {
  it('the recorder lists who was left off for being on leave', () => {
    const { api, demo, classId } = seeded();
    const [, kim] = demo.students;
    api.updateStudent(Object.assign({}, api.getStudent(kim.student_id), { status: '휴원' }));
    const d = api.getTodayClassSession('2026-09-16', classId);
    assert.ok(!d.students.some((s) => s.student_id === kim.student_id));
    assert.deepEqual(d.on_leave, [{ student_id: kim.student_id, name: kim.name }]);
  });
});
