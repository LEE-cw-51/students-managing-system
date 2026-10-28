'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
const { seedRich } = require('../scripts/dev-data.js');
const { studentEndDate } = require('../lib/exam-planner.js');

const TODAY = '2026-10-26';

function setup() {
  const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
  api.ensureSchema();
  const demo = seedRich(api, TODAY); // exams: 한빛중2 11-11, 푸른중2 11-15, 새솔중2 11-18, 한빛중3 11-07, 새솔중3 11-29
  const period = api.saveExamPeriod({ title: '2학기 기말', start_date: '2026-11-02', end_date: '2026-11-30', exam_year: '2026', exam_semester: '2', exam_type: '기말' });
  const proposal = api.proposeExamGroups(period.exam_period_id);
  return { api, demo, period, proposal, classA: demo.classes[0].class_id, classB: demo.classes[1].class_id };
}

/** Most frequent non-empty value first; ties go to the longer one. */
function ranked(values) {
  const n = new Map();
  values.filter(Boolean).forEach((v) => n.set(v, (n.get(v) || 0) + 1));
  return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || b.length - a.length);
}

/** Hand-built school+grade groups from the flat student list, as a teacher might arrange them. */
function schoolGroups(t, proposal = t.proposal) {
  const byKey = new Map();
  proposal.students.forEach((s) => {
    const key = LMS.schoolGroupKey(s.school, s.grade);
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  });
  return [...byKey.values()].map((students) => {
    const school = ranked(students.map((s) => String(s.school).trim()))[0];
    const grade = students[0].grade;
    const mainSrc = ranked(students.map((s) => s.source_class_id))[0];
    const examDate = students[0].exam_date;
    return {
      target_school: school,
      target_grade: grade,
      class_name: `${school.replace(/학교$/, '')} ${grade} 시험대비`,
      schedule: mainSrc ? LMS.classSchedule(t.api.getClass(mainSrc)) : [],
      teacher: '',
      start_date: t.period.start_date,
      end_date: examDate || t.period.end_date,
      students
    };
  });
}

function applyAll(t) {
  return t.api.applyExamGroups(t.period.exam_period_id, {
    groups: schoolGroups(t),
    suspended_class_ids: t.proposal.regular_classes.filter((c) => c.suggested).map((c) => c.class_id)
  });
}

describe('exam period planning material', () => {
  it('lists unplaced students flat, sorted by grade then name, with their school exam date', () => {
    const t = setup();
    assert.ok(!('groups' in t.proposal) && !('unassigned' in t.proposal), 'no automatic grouping');
    assert.deepEqual(t.proposal.students.map((s) => s.name), [
      '강서윤', '김민준', '박지호', '윤지우', '이서연', '정도윤', '조예준', '최하은',
      '오수아', '임하린', '장시우', '한주원'
    ]);
    const by = Object.fromEntries(t.proposal.students.map((s) => [s.name, s]));
    assert.deepEqual(Object.keys(by['김민준']).sort(), ['exam_date', 'grade', 'name', 'school', 'source_class_id', 'source_class_name', 'student_id']);
    assert.equal(by['김민준'].exam_date, '2026-11-11');
    assert.equal(by['이서연'].exam_date, '2026-11-11', '한빛중 matches 한빛중학교');
    assert.equal(by['박지호'].exam_date, '2026-11-15');
    assert.equal(by['조예준'].exam_date, '2026-11-18');
    assert.equal(by['장시우'].exam_date, '2026-11-07');
    assert.equal(by['한주원'].exam_date, '2026-11-29');
    assert.equal(by['윤지우'].exam_date, '', 'no school → no exam date, still listed');
    assert.equal(by['김민준'].source_class_id, t.classA);
    assert.equal(by['김민준'].source_class_name, '중2 A반');
    assert.deepEqual(t.proposal.existing_classes, []);
    assert.equal(t.proposal.regular_classes.filter((c) => c.suggested).length, 3, 'every source class suggested for suspension');
  });

  it('includes enrolled students without a regular class, but not 휴원/퇴원 students', () => {
    const t = setup();
    const mk = (name, school, grade, status) => t.api.createStudent({ name, school, grade, status, enrollment_date: '2026-09-01' });
    const noClass = mk('반없음', '한빛중', '중2', '재원');
    const solo = mk('혼자', '별빛중', '중1', '재원');
    mk('쉬는중', '한빛중', '중2', '휴원');
    mk('나간학생', '한빛중', '중2', '퇴원');
    const proposal = t.api.proposeExamGroups(t.period.exam_period_id);
    const names = proposal.students.map((s) => s.name);
    assert.ok(!names.includes('쉬는중') && !names.includes('나간학생'), '휴원/퇴원 excluded');
    const entry = proposal.students.find((s) => s.student_id === noClass.student_id);
    assert.equal(entry.source_class_id, '');
    assert.equal(entry.source_class_name, '');
    assert.equal(entry.exam_date, '2026-11-11');
    const soloEntry = proposal.students.find((s) => s.student_id === solo.student_id);
    assert.equal(soloEntry.source_class_id, '');
    assert.equal(soloEntry.exam_date, '', 'no exam registered for 별빛중');
    const suggested = (p) => p.regular_classes.filter((c) => c.suggested).map((c) => c.class_id).sort();
    assert.deepEqual(suggested(proposal), suggested(t.proposal), 'no-class students suggest no suspension');

    const built = schoolGroups(t, proposal);
    const hanbit = built.find((g) => g.class_name === '한빛중 중2 시험대비');
    assert.equal(hanbit.schedule.length, 2, 'schedule from the main source class');
    const soloGroup = built.find((g) => g.class_name === '별빛중 중1 시험대비');
    const groups = [hanbit, { ...soloGroup, schedule: [{ day: '금', start: '18:00', end: '20:00' }] }];
    const res = t.api.applyExamGroups(t.period.exam_period_id, { groups, suspended_class_ids: [] });
    const hanbitCls = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    const roster = t.api.getTodayClassSession('2026-11-04', hanbitCls.class_id).students.map((s) => s.student_id);
    assert.ok(roster.includes(noClass.student_id), 'placed into the exam class');
    const soloCls = res.classes.find((c) => c.class_name.startsWith('별빛중 중1'));
    assert.deepEqual(t.api.getTodayClassSession('2026-11-06', soloCls.class_id).students.map((s) => s.student_id), [solo.student_id]);
    const after = t.api.proposeExamGroups(t.period.exam_period_id);
    assert.ok(!after.students.some((s) => s.student_id === noClass.student_id), 'placed students leave the list');
    assert.deepEqual(after.existing_classes.map((c) => c.class_id).sort(), [hanbitCls.class_id, soloCls.class_id].sort());
    const ex = after.existing_classes.find((c) => c.class_id === soloCls.class_id);
    assert.equal(ex.class_name, '별빛중 중1 시험대비');
    assert.equal(ex.status, '운영');
    assert.equal(ex.schedule.length, 1);
    assert.ok(ex.schedule_label.includes('금'));
  });

  it('a hand-made mixed class returns each student on their own exam date', () => {
    const t = setup();
    const pickNames = ['김민준', '박지호', '윤지우'];
    const cls = { class_name: '중2 혼합반', schedule: [{ day: '금', start: '18:00', end: '20:00' }], start_date: '2026-11-02', end_date: '2026-11-20' };
    const students = t.proposal.students.filter((s) => pickNames.includes(s.name));
    const res = t.api.applyExamGroups(t.period.exam_period_id, {
      groups: [{ ...cls, students: students.map((s) => ({ student_id: s.student_id, source_class_id: s.source_class_id, start_date: cls.start_date, end_date: studentEndDate(s, cls) })) }],
      suspended_class_ids: []
    });
    const detail = t.api.getExamPeriodDetail(t.period.exam_period_id).classes.find((c) => c.class_id === res.classes[0].class_id);
    const ends = Object.fromEntries(detail.students.map((m) => [m.name, m.end_date]));
    assert.deepEqual(ends, { 김민준: '2026-11-11', 박지호: '2026-11-15', 윤지우: '2026-11-20' });
  });
});

describe('exam class lessons and daily reports', () => {
  it('records lessons, builds daily reports and shows on today, even after the period closes', () => {
    const t = setup();
    const res = applyAll(t);
    const hanbit = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    const date = '2026-11-04';
    const student = t.api.getTodayClassSession(date, hanbit.class_id).students[0];
    t.api.saveLesson({ lesson_date: date, class_id: hanbit.class_id, student_id: student.student_id, attendance: '출석' });
    const daily = t.api.generateDailyReports(date, hanbit.class_id);
    assert.deepEqual(daily.reports.map((r) => r.student_id), [student.student_id]);
    assert.ok(daily.reports[0].text.length > 0);

    const task = t.api.getTodayTeachingTasks(date).regular_classes.find((c) => c.class_id === hanbit.class_id);
    assert.equal(task.class_type, '시험대비');
    assert.equal(task.recorded_count, 1);
    assert.ok(t.api.getTodayBoard(date).classes.some((c) => c.class_id === hanbit.class_id));
    assert.ok(t.api.getDailyReportClasses(date).class_ids.includes(hanbit.class_id));

    t.api.closeExamPeriod(t.period.exam_period_id);
    assert.equal(t.api.getClass(hanbit.class_id).status, '종료');
    assert.ok(t.api.getDailyReportClasses(date).class_ids.includes(hanbit.class_id), 'closed exam class still selectable');
    assert.ok(!t.api.getDailyReportClasses('2026-11-05').class_ids.includes(hanbit.class_id), 'no lessons that day');
  });
});

describe('applying groups', () => {
  it('creates exam classes, suspends originals and moves rosters by date', () => {
    const t = setup();
    const res = applyAll(t);
    assert.equal(res.classes.length, 5);
    const periods = [LMS.findById(t.api.getExamPeriods(), 'exam_period_id', t.period.exam_period_id)];
    const clsA = t.api.getClass(t.classA);
    assert.equal(LMS.classMeetsOnDate(clsA, '2026-11-04', periods), false, 'original suspended');
    const hanbit = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    assert.equal(LMS.classMeetsOnDate(hanbit, '2026-11-04', periods), true);
    assert.equal(LMS.classMeetsOnDate(hanbit, '2026-10-28', periods), false, 'not before the period');
    const session = t.api.getTodayClassSession('2026-11-04', hanbit.class_id);
    assert.equal(session.students.length, 3);
    assert.equal(t.api.getTodayClassSession('2026-10-28', hanbit.class_id).students.length, 0);
  });

  it('returns each student after their own exam; the class restarts with the first one back (E1)', () => {
    const t = setup();
    applyAll(t);
    const detail = () => t.api.getExamPeriodDetail(t.period.exam_period_id);
    const a = () => detail().suspended.find((s) => s.class_id === t.classA);
    const p = () => [LMS.findById(t.api.getExamPeriods(), 'exam_period_id', t.period.exam_period_id)];
    // A반: 한빛중 (exam 11-11) and 푸른중 (exam 11-15) students
    assert.equal(a().resume_date, '2026-11-12', 'first student back the day after 11-11');
    assert.deepEqual(a().returns.map((r) => r.date), ['2026-11-12', '2026-11-16']);
    assert.equal(LMS.classMeetsOnDate(t.api.getClass(t.classA), '2026-11-04', p()), false, 'everyone away → suspended');
    const classA = t.api.getClass(t.classA);
    const meetDay = LMS.nextMeetingDateFor(classA, '2026-11-12', p());
    assert.equal(meetDay, '2026-11-16', 'first A반 lesson after resuming (월/수)');
    const roster = (d) => t.api.getTodayClassSession(d, t.classA).students.map((s) => s.name).sort();
    assert.deepEqual(roster('2026-11-16'), ['김민준', '박지호', '이서연', '최하은'], 'all back on 11-16');

    // 푸른중 students finish early on 11-09 → they rejoin A반 from 11-10 while 한빛중 is still away.
    const pureun = detail().classes.find((c) => c.class_name.startsWith('푸른중 중2'));
    pureun.students.forEach((m) => t.api.endTempAssignment(m.rel_id, '2026-11-09'));
    assert.equal(a().resume_date, '2026-11-10');
    assert.equal(LMS.classMeetsOnDate(t.api.getClass(t.classA), '2026-11-11', p()), true);
    assert.deepEqual(roster('2026-11-11'), ['박지호', '최하은'], 'only returned students in A반');
    const hanbit = detail().classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    assert.equal(t.api.getTodayClassSession('2026-11-11', hanbit.class_id).students.length, 3, '한빛중 still in exam class');
  });

  it('keeps moved students off a class that was not suspended (E2)', () => {
    const t = setup();
    t.api.applyExamGroups(t.period.exam_period_id, { groups: schoolGroups(t), suspended_class_ids: [] });
    const roster = t.api.getTodayClassSession('2026-11-02', t.classA).students.map((s) => s.name);
    assert.deepEqual(roster, [], 'all A반 students are in exam classes that day');
    const after = t.api.getTodayClassSession('2026-11-30', t.classA).students.length;
    assert.equal(after, 4, 'back after their exams');
  });

  it('rejects double placement (E3) and reports unplaced students (E5)', () => {
    const t = setup();
    applyAll(t);
    const someone = schoolGroups(t)[0].students[0];
    const other = t.api.getExamPeriodDetail(t.period.exam_period_id).classes[1];
    assert.throws(() => t.api.addTempAssignment({ class_id: other.class_id, student_id: someone.student_id }), /이미 다른 시험대비 반/);
    const b = t.api.getExamPeriodDetail(t.period.exam_period_id).suspended.find((s) => s.class_id === t.classB);
    assert.deepEqual(b.unplaced.map((u) => u.name), ['윤지우']);
  });

  it('class stats count temporary members (E6)', () => {
    const t = setup();
    const res = applyAll(t);
    const hanbit = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    t.api.saveLessonsBatch(t.api.getTodayClassSession('2026-11-02', hanbit.class_id).students.map((s) => ({
      lesson_date: '2026-11-02', class_id: hanbit.class_id, student_id: s.student_id, attendance: '출석'
    })));
    assert.equal(t.api.getClassStats(hanbit.class_id, 2026, 11).students.length, 3);
  });

  it('first lesson after the suspension checks the homework from before it (E9)', () => {
    const t = setup();
    applyAll(t);
    const ses = t.api.getTodayClassSession('2026-11-16', t.classA);
    assert.equal(ses.prior_homework.assigned_date, '2026-10-28', 'last A반 meeting before the suspension');
  });

  it('deletes only periods without lessons and clips assignments when dates shrink', () => {
    const t = setup();
    const res = applyAll(t);
    t.api.saveExamPeriod({ ...t.period, end_date: '2026-11-20' });
    const ends = t.api.getExamPeriodDetail(t.period.exam_period_id).classes.flatMap((c) => c.students.map((m) => m.end_date));
    assert.ok(ends.every((d) => d <= '2026-11-20'), 'assignments clipped (E8)');
    const hanbit = res.classes.find((c) => c.class_name.startsWith('한빛중 중2'));
    t.api.saveLessonsBatch([{ lesson_date: '2026-11-02', class_id: hanbit.class_id, student_id: schoolGroups(t).find((g) => g.class_name === hanbit.class_name).students[0].student_id, attendance: '출석' }]);
    assert.throws(() => t.api.deleteExamPeriod(t.period.exam_period_id), /삭제할 수 없습니다/);
    t.api.closeExamPeriod(t.period.exam_period_id);
    assert.equal(t.api.getClass(hanbit.class_id).status, '종료');
    const fresh = t.api.saveExamPeriod({ title: '빈 기간', start_date: '2026-12-01', end_date: '2026-12-10' });
    t.api.deleteExamPeriod(fresh.exam_period_id);
    assert.ok(!t.api.getExamPeriods().some((p) => p.exam_period_id === fresh.exam_period_id));
  });
});

describe('same-name exam groups', () => {
  const pick = (t, school) => schoolGroups(t).find((g) => g.target_school.startsWith(school) && g.target_grade === '중2');
  const roster = (t, classId, date) => t.api.getTodayClassSession(date, classId).students.map((s) => s.student_id).sort();
  const detailClass = (t, classId) => t.api.getExamPeriodDetail(t.period.exam_period_id).classes.find((c) => c.class_id === classId);

  it('merges groups whose names differ only in spacing into one class', () => {
    const t = setup();
    const hanbit = pick(t, '한빛중');
    const pureun = pick(t, '푸른중');
    const groups = [
      { ...hanbit, class_name: '중2 연합반' },
      { ...pureun, class_name: '  중2   연합반 ', schedule: [] }
    ];
    const res = t.api.applyExamGroups(t.period.exam_period_id, { groups, suspended_class_ids: [] });
    assert.equal(res.classes.length, 1);
    const cls = res.classes[0];
    assert.equal(cls.class_name, '중2 연합반');
    assert.deepEqual(LMS.normalizeSchedule(cls.schedule), LMS.normalizeSchedule(hanbit.schedule), 'first group schedule');
    assert.equal(cls.target_school, [hanbit.target_school, pureun.target_school].join(' · '));
    assert.equal(cls.target_grade, '중2');
    const all = [...hanbit.students, ...pureun.students].map((s) => s.student_id).sort();
    assert.deepEqual(roster(t, cls.class_id, '2026-11-02'), all);
    const ends = Object.fromEntries(detailClass(t, cls.class_id).students.map((m) => [m.student_id, m.end_date]));
    hanbit.students.forEach((s) => assert.equal(ends[s.student_id], hanbit.end_date));
    pureun.students.forEach((s) => assert.equal(ends[s.student_id], pureun.end_date));
    assert.notEqual(hanbit.end_date, pureun.end_date, 'fixture has distinct exam dates');
  });

  it('adds students to an existing class with the same name instead of creating one', () => {
    const t = setup();
    const hanbit = pick(t, '한빛중');
    const first = t.api.applyExamGroups(t.period.exam_period_id, { groups: [{ ...hanbit, class_name: '중2 연합반' }], suspended_class_ids: [] });
    const classId = first.classes[0].class_id;
    const countBefore = t.api.getExamPeriodDetail(t.period.exam_period_id).classes.length;
    const saesol = pick(t, '새솔중');
    const res = t.api.applyExamGroups(t.period.exam_period_id, { groups: [{ ...saesol, class_name: '중2  연합반', schedule: [] }] });
    assert.deepEqual(res.classes.map((c) => c.class_id), [classId]);
    assert.equal(t.api.getExamPeriodDetail(t.period.exam_period_id).classes.length, countBefore, 'no new class');
    const all = [...hanbit.students, ...saesol.students].map((s) => s.student_id).sort();
    assert.deepEqual(roster(t, classId, '2026-11-02'), all);
  });

  it('keeps differently named groups as separate classes', () => {
    const t = setup();
    const groups = [{ ...pick(t, '한빛중'), class_name: '연합 A' }, { ...pick(t, '푸른중'), class_name: '연합 B' }];
    const res = t.api.applyExamGroups(t.period.exam_period_id, { groups, suspended_class_ids: [] });
    assert.deepEqual(res.classes.map((c) => c.class_name), ['연합 A', '연합 B']);
    assert.notEqual(res.classes[0].class_id, res.classes[1].class_id);
  });
});

describe('resume dates follow regular assignment changes', () => {
  // A반 (월/수) and B반 (화/목) suspended 11-02 ~ 11-30. 가 (A반) is placed until 11-10, 나 (B반) until 11-20.
  // `extra` adds 가 to B반 from that date before the placement is made.
  function small(extra) {
    const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
    api.ensureSchema();
    const mk = (name, weekday) => api.createClass({ school_year: '2026', semester: '2', grade: '중2', class_name: name, weekday, start_time: '18:00', end_time: '20:00', status: '운영' });
    const a = mk('A반', '월/수').class_id;
    const b = mk('B반', '화/목').class_id;
    const st = (name, classId) => api.createStudent({ name, grade: '중2', school: '한빛중', enrollment_date: '2026-09-01', status: '재원', class_id: classId });
    const ga = st('가', a);
    const na = st('나', b);
    if (extra) api.assignStudentToClass({ student_id: ga.student_id, class_id: b, start_date: extra });
    const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30' });
    api.applyExamGroups(period.exam_period_id, {
      groups: [{ class_name: '대비반', schedule: [{ day: '금', start: '18:00', end: '20:00' }], students: [
        { student_id: ga.student_id, source_class_id: a, end_date: '2026-11-10' },
        { student_id: na.student_id, source_class_id: b, end_date: '2026-11-20' }
      ] }],
      suspended_class_ids: [a, b]
    });
    const id = period.exam_period_id;
    const resume = () => LMS.findById(api.getExamPeriods(), 'exam_period_id', id).class_resume_dates;
    const rel = (sid, cid) => api.getStudent(sid).class_history.find((h) => h.class_id === cid);
    return { api, a, b, ga, na, resume, rel, periods: () => api.getExamPeriods() };
  }

  it('assigning a student to a suspended class during the period', () => {
    const t = small();
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-10', [t.b]: '2026-11-20' });
    t.api.assignStudentToClass({ student_id: t.ga.student_id, class_id: t.b, start_date: '2026-11-01' });
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-10', [t.b]: '2026-11-10' });
    assert.equal(LMS.classMeetsOnDate(t.api.getClass(t.b), '2026-11-12', t.periods()), true, 'B반 back once 가 returns');
  });

  it('closing the source assignment points the placement at the other class', () => {
    const t = small('2026-10-01');
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-10', [t.b]: '2026-11-10' });
    t.api.closeStudentClass({ id: t.rel(t.ga.student_id, t.a).id, end_date: '2026-10-31' });
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-30', [t.b]: '2026-11-10' });
    assert.ok(t.api.getClassRoster(t.b, '2026-11-05').every((s) => s.student_id !== t.ga.student_id), '가 is away from B반');
  });

  it('closing a sole assignment drops a placement that has not started', () => {
    const t = small();
    t.api.closeStudentClass({ id: t.rel(t.na.student_id, t.b).id, end_date: '2026-10-31' });
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-10', [t.b]: '2026-11-30' }, 'B반 no longer waits for 나');
    assert.ok(!t.api.getStudent(t.na.student_id).class_history.some((h) => h.status === '임시'));
  });

  it('removing a mistaken assignment', () => {
    const t = small('2026-10-01');
    t.api.removeStudentClass({ id: t.rel(t.ga.student_id, t.b).id });
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-10', [t.b]: '2026-11-20' });
    const t2 = small('2026-10-01');
    t2.api.removeStudentClass({ id: t2.rel(t2.ga.student_id, t2.a).id });
    assert.deepEqual(t2.resume(), { [t2.a]: '2026-11-30', [t2.b]: '2026-11-10' });
  });

  it('withdrawing a student', () => {
    const t = small('2026-10-01');
    t.api.archiveStudent(t.ga.student_id);
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-30', [t.b]: '2026-11-20' }, 'neither class waits for 가');
    assert.ok(!t.api.getStudent(t.ga.student_id).class_history.some((h) => h.status === '임시'), 'the placement had not started');
  });

  it('closing a class', () => {
    const t = small('2026-10-01');
    t.api.closeClass(t.a);
    assert.deepEqual(t.resume(), { [t.a]: '2026-11-30', [t.b]: '2026-11-10' });
    assert.ok(t.api.getClassRoster(t.b, '2026-11-05').every((s) => s.student_id !== t.ga.student_id), '가 is away from B반');
  });
});
