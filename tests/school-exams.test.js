'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

const TODAY = '2026-10-24';

function setup() {
  const api = LMS.createService(createMemoryStore({ today: TODAY }));
  api.ensureSchema();
  const cls = api.createClass({ class_name: '중2 A반', schedule: [{ day: '월', start: '18:00', end: '20:00' }] });
  const other = api.createClass({ class_name: '중3 반', schedule: [{ day: '화', start: '18:00', end: '20:00' }] });
  const mk = (name, grade, school, classId) => api.createStudent({ name, grade, school, status: '재원', enrollment_date: '2026-03-01', class_id: classId });
  const a = mk('가', '중2', '한빛중학교', cls.class_id);
  const b = mk('나', '중2', '한빛 중', cls.class_id);
  const c = mk('다', '중3', '한빛중학교', other.class_id);
  const d = mk('라', '중2', '', cls.class_id);
  return { api, cls, other, students: [a, b, c, d] };
}

const base = { school_year: '2026', semester: '2', exam_type: '기말', grade: '중2' };

describe('school exams', () => {
  it('upserts the same exam across school spellings', () => {
    const { api } = setup();
    const first = api.saveSchoolExam({ ...base, school: '한빛중학교', exam_date: '2026-11-20', scope: '1~2단원' });
    const second = api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-11-21', textbook: '개념원리' });
    assert.equal(second.school_exam_id, first.school_exam_id);
    const rows = api.getSchoolExams({ school_year: '2026', semester: '2' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].exam_date, '2026-11-21');
    assert.equal(rows[0].textbook, '개념원리');
  });

  it('validates required fields and rejects edits that collide', () => {
    const { api } = setup();
    assert.throws(() => api.saveSchoolExam({ ...base, school: '' }), /학교/);
    assert.throws(() => api.saveSchoolExam({ ...base, school: 'A', grade: '' }), /학년/);
    assert.throws(() => api.saveSchoolExam({ ...base, school: 'A', exam_type: '기타' }), /시험 이름/);
    const mid = api.saveSchoolExam({ ...base, exam_type: '중간', school: '한빛중' });
    api.saveSchoolExam({ ...base, school: '한빛중' });
    assert.throws(() => api.saveSchoolExam({ ...mid, exam_type: '기말' }), /이미 있습니다/);
  });

  it('matches enrolled students by school and grade with D-day', () => {
    const { api } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중학교', exam_date: '2026-11-03' });
    const [row] = api.getSchoolExams({ school_year: '2026' });
    assert.equal(row.d_day, 10);
    assert.equal(row.label, '2학기 기말고사');
    assert.deepEqual(row.students.map((s) => s.name).sort(), ['가', '나']);
    assert.deepEqual(row.students[0].classes, ['중2 A반']);
  });

  it('school options group spellings and list students without a school', () => {
    const { api } = setup();
    const opts = api.getSchoolOptions();
    const g = opts.groups.find((x) => x.grade === '중2');
    assert.equal(g.student_count, 2);
    assert.equal(g.school, '한빛중학교');
    assert.deepEqual(opts.missing_school.map((s) => s.name), ['라']);
  });

  it('class overview lists upcoming exams of its students only', () => {
    const { api, cls } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-11-03' });
    api.saveSchoolExam({ ...base, grade: '중3', school: '한빛중', exam_date: '2026-11-04' });
    api.saveSchoolExam({ ...base, exam_type: '중간', school: '한빛중', exam_date: '2026-10-01' });
    const exams = api.getClassOverview(cls.class_id).exams;
    assert.equal(exams.length, 1);
    assert.equal(exams[0].grade, '중2');
    assert.equal(exams[0].students.length, 2);
  });

  it('deletes', () => {
    const { api } = setup();
    const row = api.saveSchoolExam({ ...base, school: '한빛중' });
    api.deleteSchoolExam(row.school_exam_id);
    assert.equal(api.getSchoolExams({}).length, 0);
  });
});
