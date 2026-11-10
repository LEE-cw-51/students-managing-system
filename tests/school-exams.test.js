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
    assert.deepEqual([student.next_exam.exam_date, student.next_exam.exam_end_date], ['2026-10-22', '2026-10-27']);
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
    assert.deepEqual([student.next_exam.math_exam_date, student.next_exam.d_day], ['2026-11-05', 12]);
  });

  it('upcoming windows include an exam by its math D-day or while in progress', () => {
    const { api, cls } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-12-20', exam_end_date: '2026-12-26', math_exam_date: '2026-12-24' });
    assert.equal(api.getClassOverview(cls.class_id).exams.length, 0, 'starts at D-57 but math is D-61');
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-12-20', exam_end_date: '2026-12-26', math_exam_date: '2026-12-23' });
    assert.deepEqual(api.getClassOverview(cls.class_id).exams.map((x) => x.d_day), [60]);
    const exam = { school_exam_id: 'SCX-1', exam_date: '2026-10-20', exam_end_date: '2026-12-31', math_exam_date: '2026-12-30' };
    assert.equal(LMS.schoolExams.upcoming([exam], TODAY, 7).length, 1, 'in progress');
    assert.equal(LMS.schoolExams.upcoming([{ ...exam, exam_end_date: '2026-10-23', math_exam_date: '' }], TODAY, 7).length, 0, 'over');
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
    assert.deepEqual([student.next_exam.math_exam_date, student.next_exam.d_day], ['', 10]);
    const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30', exam_year: '2026', exam_semester: '2', exam_type: '기말' });
    const dates = Object.fromEntries(api.proposeExamGroups(period.exam_period_id).students.map((s) => [s.name, s.exam_date]));
    assert.deepEqual([dates['가'], dates['다']], ['2026-11-06', '2026-11-06'], 'return date is the last exam day, with or without a math date');
  });

  it('upcoming exams sort by the math D-day, not the first exam day', () => {
    const { api, cls } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-10-28', exam_end_date: '2026-11-07', math_exam_date: '2026-11-06' });
    api.saveSchoolExam({ ...base, exam_type: '기타', title: '모의고사', school: '한빛중', exam_date: '2026-11-01', exam_end_date: '2026-11-05', math_exam_date: '2026-11-04' });
    api.saveSchoolExam({ ...base, exam_type: '중간', school: '한빛중', exam_date: '2026-10-30', exam_end_date: '2026-11-06' });
    const exams = api.getClassOverview(cls.class_id).exams;
    assert.deepEqual(exams.map((x) => [x.exam_date, x.d_day]), [['2026-10-30', 6], ['2026-11-01', 11], ['2026-10-28', 13]]);
  });

  it('student list next exam is the nearest by math D-day', () => {
    const { api } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-10-28', exam_end_date: '2026-11-07', math_exam_date: '2026-11-06' });
    api.saveSchoolExam({ ...base, exam_type: '기타', title: '모의고사', school: '한빛중', exam_date: '2026-11-01', exam_end_date: '2026-11-05', math_exam_date: '2026-11-04' });
    api.saveSchoolExam({ ...base, exam_type: '중간', school: '한빛중', exam_date: '2026-10-01', math_exam_date: '2026-10-01' });
    const student = api.getStudentList({}).find((s) => s.name === '가');
    assert.deepEqual([student.next_exam.exam_date, student.next_exam.math_exam_date, student.next_exam.d_day], ['2026-11-01', '2026-11-04', 11]);
  });

  it('deletes', () => {
    const { api } = setup();
    const row = api.saveSchoolExam({ ...base, school: '한빛중' });
    api.deleteSchoolExam(row.school_exam_id);
    assert.equal(api.getSchoolExams({}).length, 0);
  });

  it('every screen gets the same view shape with D-day label and tone', () => {
    const { api, cls } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-10-22', exam_end_date: '2026-11-06', math_exam_date: '2026-11-05' });
    const pick = (x) => [x.d_day, x.in_progress, x.d_day_label, x.d_day_tone, x.math_label, x.label];
    const expected = [12, true, '시험 중', 'danger', '수학 11/5', '2학기 기말고사'];
    assert.deepEqual(pick(api.getSchoolExams({ school_year: '2026' })[0]), expected);
    assert.deepEqual(pick(api.getClassOverview(cls.class_id).exams[0]), expected);
    assert.deepEqual(pick(api.getStudentList({}).find((s) => s.name === '가').next_exam), expected);
    assert.deepEqual(pick(api.getTodayBoard(TODAY).exams_soon[0]), expected);
  });

  it('class plan AI input lists upcoming exams by math D-day', () => {
    const { api, cls, students } = setup();
    api.saveSchoolExam({ ...base, school: '한빛중', exam_date: '2026-10-28', exam_end_date: '2026-11-07', math_exam_date: '2026-11-06' });
    api.saveSchoolExam({ ...base, grade: '중3', school: '한빛중', exam_date: '2026-11-01', exam_end_date: '2026-11-05', math_exam_date: '2026-11-04' });
    api.updateStudent({ ...students[3], school: '한빛중', grade: '중3' });
    api.updateClass({ ...cls, curriculum: [{ title: '삼각형', sessions: 2 }] });
    const input = api.getClassPlanContext(cls.class_id, '2026-10').input;
    assert.deepEqual(input.upcoming_school_exams.map((e) => [e.grade, e.exam_date, e.d_day]), [['중3', '2026-11-01', 11], ['중2', '2026-10-28', 13]]);
    assert.deepEqual(input.students.map((s) => s.next_school_exam && s.next_school_exam.math_exam_date).sort(), ['2026-11-04', '2026-11-06', '2026-11-06']);
  });
});

describe('school exam view module', () => {
  const X = LMS.schoolExams;
  const row = (id, start, end, math, extra) => ({ school_exam_id: id, school: '한빛중', school_key: 'k', semester: '2', exam_type: '기말', exam_date: start, exam_end_date: end, math_exam_date: math, ...extra });

  it('counts D-day toward the math date, else the first day', () => {
    assert.equal(X.view(row('a', '2026-11-03', '2026-11-06', '2026-11-05'), TODAY).d_day, 12);
    assert.equal(X.view(row('a', '2026-11-03', '2026-11-06', ''), TODAY).d_day, 10);
    const old = X.view(row('a', '2026-11-03', '', ''), TODAY);
    assert.deepEqual([old.exam_end_date, old.math_label], ['2026-11-03', '']);
    assert.equal(X.view(row('a', '2026-11-05', '2026-11-05', '2026-11-05'), TODAY).math_label, '', 'one-day exam needs no math label');
  });

  it('tone: in progress danger, ≤7 danger, ≤21 amber, past muted, undated none', () => {
    const at = (math, start, end) => X.view(row('a', start || math, end || math, math), TODAY);
    const pair = (v) => [v.d_day_label, v.d_day_tone];
    assert.deepEqual(pair(at('2026-11-16')), ['D-23', '']);
    assert.deepEqual(pair(at('2026-11-15')), ['D-22', '']);
    assert.deepEqual(pair(at('2026-11-14')), ['D-21', 'amber']);
    assert.deepEqual(pair(at('2026-11-01')), ['D-8', 'amber']);
    assert.deepEqual(pair(at('2026-10-31')), ['D-7', 'danger']);
    assert.deepEqual(pair(at('2026-10-24')), ['D-day', 'danger']);
    assert.deepEqual(pair(at('2026-11-10', '2026-10-20', '2026-11-12')), ['시험 중', 'danger'], 'in progress beats the 21-day band');
    assert.deepEqual(pair(at('2026-10-23', '2026-10-20', '2026-10-27')), ['시험 중', 'danger'], 'math day passed, exam still running');
    assert.deepEqual(pair(at('2026-10-21')), ['D+3', 'muted']);
    assert.deepEqual(pair(X.view(row('a', '', '', ''), TODAY)), ['', '']);
    assert.equal(X.view(row('a', '', '', ''), TODAY).d_day, null);
  });

  it('upcoming orders by math date over range start, then start, school and id', () => {
    const list = X.upcoming([
      row('late-math', '2026-10-26', '2026-11-06', '2026-11-05'),
      row('early-math', '2026-10-30', '2026-11-03', '2026-11-02'),
      row('tie-b', '2026-10-28', '2026-10-28', '', { school: '하늘중' }),
      row('tie-c2', '2026-10-27', '2026-10-28', '2026-10-28'),
      row('tie-a', '2026-10-28', '2026-10-28', '', { school: '가람중' }),
      row('tie-c1', '2026-10-27', '2026-10-28', '2026-10-28')
    ], TODAY, null);
    assert.deepEqual(list.map((x) => x.school_exam_id), ['tie-c1', 'tie-c2', 'tie-a', 'tie-b', 'early-math', 'late-math']);
  });

  it('upcoming drops finished and undated exams and windows by math date', () => {
    const rows = [
      row('over', '2026-10-20', '2026-10-23', ''),
      row('undated', '', '', ''),
      row('running', '2026-10-22', '2026-10-27', '2026-10-23'),
      row('math-in', '2026-10-28', '2026-11-06', '2026-10-31'),
      row('math-out', '2026-10-28', '2026-11-06', '2026-11-01')
    ];
    assert.deepEqual(X.upcoming(rows, TODAY, 7).map((x) => x.school_exam_id), ['running', 'math-in']);
    assert.deepEqual(X.upcoming(rows, TODAY, null).map((x) => x.school_exam_id), ['running', 'math-in', 'math-out']);
  });

  it('nextByKey keeps the soonest math D-day per school and grade', () => {
    const next = X.nextByKey([
      row('a', '2026-10-28', '2026-11-07', '2026-11-06'),
      row('b', '2026-11-01', '2026-11-05', '2026-11-04'),
      row('c', '2026-10-25', '2026-10-25', '', { school_key: 'other' }),
      row('d', '2026-10-01', '2026-10-01', '', { school_key: 'gone' })
    ], TODAY, null);
    assert.deepEqual(Object.keys(next).sort(), ['k', 'other']);
    assert.equal(next.k.school_exam_id, 'b');
    assert.equal(next.k.d_day_label, 'D-11');
  });

  it('changeDate keeps the end on or after the start and the math day inside the range', () => {
    const f = { exam_date: '', exam_end_date: '', math_exam_date: '' };
    let s = X.changeDate(f, 'exam_date', '2026-11-03');
    assert.deepEqual([s.exam_date, s.exam_end_date], ['2026-11-03', '2026-11-03']);
    s = X.changeDate(X.changeDate(s, 'exam_end_date', '2026-11-06'), 'math_exam_date', '2026-11-05');
    assert.equal(X.changeDate(s, 'exam_date', '2026-11-04').math_exam_date, '2026-11-05', 'still inside');
    s = X.changeDate(s, 'exam_date', '2026-11-08');
    assert.deepEqual([s.exam_end_date, s.math_exam_date], ['2026-11-08', ''], 'later start pulls the end and clears math');
    const t = X.changeDate({ exam_date: '2026-11-03', exam_end_date: '2026-11-06', math_exam_date: '2026-11-05' }, 'exam_end_date', '2026-11-04');
    assert.equal(t.math_exam_date, '', 'shorter range clears math');
  });
});
