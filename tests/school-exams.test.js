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

  it('exam planning material carries each student\'s school exam date for the period', () => {
    const { api } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-11-12' });
    api.saveSchoolExam({ ...base, exam_type: '중간', school: '한빛중', exam_date: '2026-11-05' });
    api.saveSchoolExam({ ...base, grade: '중3', school: '한빛중학교', exam_date: '2026-12-10' });
    const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30', exam_year: '2026', exam_semester: '2', exam_type: '기말' });
    const dates = Object.fromEntries(api.proposeExamGroups(period.exam_period_id).students.map((s) => [s.name, s.exam_date]));
    assert.deepEqual(dates, { 가: '2026-11-12', 나: '2026-11-12', 다: '', 라: '' }, 'spellings match; other exam types and out-of-period dates do not');
  });

  it('saves a date range; an empty end means a one-day exam', () => {
    const { api } = setup();
    const ranged = api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-11-03', exam_end_date: '2026-11-06' });
    assert.equal(ranged.exam_end_date, '2026-11-06');
    const single = api.saveSchoolExam({ ...base, grade: '중3', school: '한빛중', exam_date: '2026-11-04' });
    assert.equal(single.exam_end_date, '2026-11-04');
    const row = api.getSchoolExams({ school_year: '2026' }).find((x) => x.grade === '중2');
    assert.equal(row.d_day, 10, 'D-day counts from the first day');
    assert.equal(row.in_progress, false);
  });

  it('rejects an end before the start or without a start', () => {
    const { api } = setup();
    assert.throws(() => api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-11-06', exam_end_date: '2026-11-03' }), /종료일이 시작일보다 빠릅니다/);
    assert.throws(() => api.saveSchoolExam({ ...base, school: '한빛중', exam_end_date: '2026-11-03' }), /시작일/);
  });

  it('keeps an exam in progress in upcoming lists until its last day', () => {
    const { api, cls } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-10-22', exam_end_date: '2026-10-27' });
    const exams = api.getClassOverview(cls.class_id).exams;
    assert.equal(exams.length, 1);
    assert.equal(exams[0].in_progress, true);
    assert.equal(exams[0].d_day, -2);
    const student = api.getStudentList({}).find((s) => s.name === '가');
    assert.deepEqual([student.next_exam.date, student.next_exam.end_date], ['2026-10-22', '2026-10-27']);
  });

  it('exam planning returns students on the last exam day of a range overlapping the period', () => {
    const { api } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-10-30', exam_end_date: '2026-11-04' });
    const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30', exam_year: '2026', exam_semester: '2', exam_type: '기말' });
    const dates = Object.fromEntries(api.proposeExamGroups(period.exam_period_id).students.map((s) => [s.name, s.exam_date]));
    assert.equal(dates['가'], '2026-11-04');
  });

  it('rejects a math exam date outside the exam range', () => {
    const { api } = setup();
    const range = { ...base, school: '한빛중', exam_date: '2026-11-03', exam_end_date: '2026-11-06' };
    assert.throws(() => api.saveSchoolExam({ ...range, math_exam_date: '2026-11-02' }), /수학 시험일은 시험 기간 안이어야 합니다/);
    assert.throws(() => api.saveSchoolExam({ ...range, math_exam_date: '2026-11-07' }), /수학 시험일은 시험 기간 안이어야 합니다/);
    assert.throws(() => api.saveSchoolExam({ ...range, math_exam_date: '11/5' }), /수학 시험일 형식/);
  });

  it('a math exam date alone fills the start and end', () => {
    const { api } = setup();
    const row = api.saveSchoolExam({ ...base, school: '한빛중', math_exam_date: '2026-11-05' });
    assert.deepEqual([row.exam_date, row.exam_end_date, row.math_exam_date], ['2026-11-05', '2026-11-05', '2026-11-05']);
  });

  it('counts D-day toward the math exam date when set', () => {
    const { api, cls } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-11-03', exam_end_date: '2026-11-06', math_exam_date: '2026-11-05' });
    const [row] = api.getSchoolExams({ school_year: '2026' });
    assert.equal(row.d_day, 12);
    assert.equal(row.math_exam_date, '2026-11-05');
    assert.equal(api.getClassOverview(cls.class_id).exams[0].d_day, 12);
    const student = api.getStudentList({}).find((s) => s.name === '가');
    assert.deepEqual([student.next_exam.math_date, student.next_exam.d_day], ['2026-11-05', 12]);
  });

  it('upcoming windows include an exam by its math D-day or while in progress', () => {
    const { api, cls } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-12-20', exam_end_date: '2026-12-26', math_exam_date: '2026-12-24' });
    assert.equal(api.getClassOverview(cls.class_id).exams.length, 0, 'starts at D-57 but math is D-61');
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-12-20', exam_end_date: '2026-12-26', math_exam_date: '2026-12-23' });
    assert.deepEqual(api.getClassOverview(cls.class_id).exams.map((x) => x.d_day), [60]);
    const exam = { exam_date: '2026-10-20', exam_end_date: '2026-12-31', math_exam_date: '2026-12-30' };
    assert.equal(LMS.schoolExamDueBy(exam, TODAY, '2026-10-31'), true, 'in progress');
    assert.equal(LMS.schoolExamDueBy({ ...exam, exam_end_date: '2026-10-23', math_exam_date: '' }, TODAY, '2026-10-31'), false, 'over');
  });

  it('marks the student list exam in progress before the math exam day', () => {
    const { api } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-10-22', exam_end_date: '2026-10-27', math_exam_date: '2026-10-26' });
    const student = api.getStudentList({}).find((s) => s.name === '가');
    assert.deepEqual([student.next_exam.in_progress, student.next_exam.d_day], [true, 2]);
  });

  it('without a math exam date D-day uses the start and the return date stays the last day', () => {
    const { api } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-11-03', exam_end_date: '2026-11-06' });
    api.saveSchoolExam({ ...base, grade: '중3', school: '한빛중', exam_date: '2026-11-03', exam_end_date: '2026-11-06', math_exam_date: '2026-11-04' });
    const rows = api.getSchoolExams({ school_year: '2026' });
    assert.equal(rows.find((x) => x.grade === '중2').d_day, 10);
    const student = api.getStudentList({}).find((s) => s.name === '가');
    assert.deepEqual([student.next_exam.math_date, student.next_exam.d_day], ['', 10]);
    const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30', exam_year: '2026', exam_semester: '2', exam_type: '기말' });
    const dates = Object.fromEntries(api.proposeExamGroups(period.exam_period_id).students.map((s) => [s.name, s.exam_date]));
    assert.deepEqual([dates['가'], dates['다']], ['2026-11-06', '2026-11-06'], 'return date is the last exam day, with or without a math date');
  });

  it('deletes', () => {
    const { api } = setup();
    const row = api.saveSchoolExam({ ...base, school: '한빛중' });
    api.deleteSchoolExam(row.school_exam_id);
    assert.equal(api.getSchoolExams({}).length, 0);
  });
});
