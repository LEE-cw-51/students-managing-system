'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const { APP_SESSION, apply } = require('../lib/proposals.js');

// Every write action goes through the real flow: preview, save as a proposal, approve, verify.
function setup() {
  const store = createMemoryStore();
  const demo = seedDemo(LMS.createService(store));
  // Like withService: every step reads the store again.
  const svc = () => LMS.createService(store);
  const run = async (fn) => fn(svc());
  const [hong, kim, lee] = demo.students.map((s) => s.student_id);

  // Applies without judging the read-back (verification_status left to the test).
  async function propose(tool, args) {
    const api = svc();
    const preview = api.previewAgentAction(tool, args);
    const saved = api.saveAgentTurn({ message: 'test ' + tool, reply: 'ok', calls: [{ tool, args: preview.args, preview }] });
    const applied = await apply(APP_SESSION, { proposal_id: saved.message.proposal.proposal_id }, run);
    assert.equal(applied.status, 'applied', tool);
    return { preview, applied };
  }

  async function act(tool, args) {
    const out = await propose(tool, args);
    assert.equal(out.applied.verification_status, 'verified', `${tool}: ${JSON.stringify(out.applied.result)}`);
    return out;
  }

  return { store, svc, run, act, propose, A: demo.class.class_id, hong, kim, lee };
}

const findStudent = (api, name) => api.getStudents({}).find((s) => s.name === name);
const findClass = (api, name) => api.getClasses({}).find((c) => c.class_name === name);
const table = (store, name) => store.readTable(name);

describe('agent write actions: students', () => {
  it('creates, updates, changes status and archives a student', async () => {
    const { svc, act, A } = setup();
    await act('create_student', { name: '박민수', grade: '중2', class_id: A, enrollment_date: '2026-09-01' });
    const park = findStudent(svc(), '박민수');
    assert.ok(park);
    await act('update_student', { student_id: park.student_id, school: '한빛중', memo: '수학 약함' });
    assert.equal(findStudent(svc(), '박민수').school, '한빛중');
    assert.throws(() => svc().previewAgentAction('update_student', { student_id: park.student_id, school: '한빛중' }));
    await act('set_students_status', { student_ids: [park.student_id], status: '휴원' });
    await act('archive_student', { student_id: park.student_id });
    await act('promote_grades', {});
  });
});

describe('agent write actions: class assignments', () => {
  it('assigns, moves, closes and removes class assignments', async () => {
    const { svc, act, A, hong, kim, lee } = setup();
    await act('create_class', { class_name: '중2 B반', grade: '중2', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
    const B = findClass(svc(), '중2 B반').class_id;
    await act('create_student', { name: '박민수', grade: '중2', class_id: A, enrollment_date: '2026-09-01' });
    const park = findStudent(svc(), '박민수').student_id;
    await act('assign_student_to_class', { student_id: park, class_id: B, start_date: '2026-09-15' });
    await act('update_student_class_start', { student_id: park, class_id: B, start_date: '2026-09-11' });
    await act('remove_student_class', { student_id: park, class_id: B });
    assert.throws(() => svc().previewAgentAction('remove_student_class', { student_id: hong, class_id: A }));
    await act('move_student', { student_id: hong, class_id: B, start_date: '2026-09-15' });
    await act('move_students', { from_class_id: A, to_class_id: B, student_ids: [kim, lee], date: '2026-09-15' });
    await act('close_student_class', { student_id: park, class_id: A, end_date: '2026-09-20' });
  });

  it('adds and ends a temporary exam-prep assignment', async () => {
    const { store, svc, act, hong } = setup();
    await act('create_exam_period', { title: '2학기 중간', start_date: '2026-09-21', end_date: '2026-10-10', exam_type: '중간' });
    const [period] = table(store, 'ExamPeriods');
    const exam = svc().createClass({
      class_name: '중2 중간대비', grade: '중2', weekday: '토', start_time: '10:00', end_time: '12:00',
      class_type: '시험대비', exam_period_id: period.exam_period_id
    });
    await act('add_temp_assignment', { class_id: exam.class_id, student_id: hong });
    await act('end_temp_assignment', { student_id: hong, class_id: exam.class_id, date: '2026-10-03' });
  });
});

describe('agent write actions: classes', () => {
  it('creates, updates, cancels a date, deletes and closes classes', async () => {
    const { svc, act, A } = setup();
    await act('create_class', { class_name: '중2 B반', grade: '중2', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
    const B = findClass(svc(), '중2 B반').class_id;
    await act('update_class', { class_id: B, teacher: '김선생', weekday: '화/금' });
    assert.equal(findClass(svc(), '중2 B반').teacher, '김선생');
    await act('cancel_class_date', { class_id: B, date: '2026-09-18', reason: '학교 행사' });
    assert.throws(() => svc().previewAgentAction('cancel_class_date', { class_id: B, date: '2026-09-16' }));
    await act('create_class', { class_name: '임시 반', weekday: '토', start_time: '09:00', end_time: '10:00' });
    await act('delete_class', { class_id: findClass(svc(), '임시 반').class_id });
    assert.equal(findClass(svc(), '임시 반'), undefined);
    assert.throws(() => svc().previewAgentAction('delete_class', { class_id: A }));
    await act('close_class', { class_id: B });
  });

  it('update_class keeps per-day times and refuses a single time on a non-uniform schedule', async () => {
    const { svc, act } = setup();
    const slots = (id) => LMS.classSchedule(svc().getClass(id)).map((s) => `${s.day} ${s.start}-${s.end}`);
    await act('create_class', { class_name: '중3 B반', weekday: '화/목', start_time: '18:00', end_time: '20:00' });
    const B = findClass(svc(), '중3 B반').class_id;
    const set = await act('update_class', { class_id: B, schedule: [{ day: '화', start: '18:00', end: '20:00' }, { day: '목', start: '19:00', end: '21:00' }] });
    assert.match(set.preview.text, /시간표 화\/목 18:00–20:00 → 화 18:00–20:00 · 목 19:00–21:00/);
    assert.deepEqual(slots(B), ['화 18:00-20:00', '목 19:00-21:00']);

    await act('update_class', { class_id: B, memo: '심화반' });
    assert.deepEqual(slots(B), ['화 18:00-20:00', '목 19:00-21:00']);

    assert.throws(() => svc().previewAgentAction('update_class', { class_id: B, end_time: '22:00' }), /요일마다 시간이 다른 반입니다.*schedule/);
    assert.throws(() => svc().previewAgentAction('update_class', { class_id: B, weekday: '화/목/토' }), /토요일을 더하려면 schedule/);
    assert.deepEqual(slots(B), ['화 18:00-20:00', '목 19:00-21:00']);

    // Dropping a day keeps the remaining day's own time.
    await act('update_class', { class_id: B, weekday: '목' });
    assert.deepEqual(slots(B), ['목 19:00-21:00']);
    assert.equal(svc().getClass(B).start_time, '19:00');

    // One-slot (uniform) schedule: a single time applies to every day.
    await act('update_class', { class_id: B, end_time: '21:30' });
    await act('update_class', { class_id: B, weekday: '월/목' });
    assert.deepEqual(slots(B), ['월 19:00-21:30', '목 19:00-21:30']);
  });
});

describe('agent write actions: lessons', () => {
  it('saves, updates and batch-saves lessons and class sessions', async () => {
    const { svc, act, A, hong, kim } = setup();
    await act('save_lesson', { student_id: hong, class_id: A, lesson_date: '2026-09-09', attendance: '결석' });
    assert.throws(() => svc().previewAgentAction('save_lesson', { student_id: hong, class_id: A, lesson_date: '2026-09-09' }));
    const lesson = svc().getStudentLessons(hong, '2026-09-09', '2026-09-09')[0];
    await act('update_lesson', { lesson_id: lesson.lesson_id, attendance: '출석', special_note: '지각' });
    assert.equal(svc().getStudentLessons(hong, '2026-09-09', '2026-09-09')[0].special_note, '지각');
    await act('update_attendance', { lesson_id: lesson.lesson_id, attendance: '결석' });
    await act('save_lessons_batch', {
      class_id: A, lesson_date: '2026-09-07', class_notice: '다음 주 시험',
      items: [{ student_id: hong, test_status: '실시', test_score: 15, test_max_score: 20 }, { student_id: kim, attendance: '결석' }]
    });
    await act('save_class_session', { class_id: A, lesson_date: '2026-09-14', content: '삼각형 복습', test_scope: '2단원' });
    await act('save_class_session_notice', { class_id: A, lesson_date: '2026-09-14', text: '교재 지참' });
  });

  it('update_lesson verifies progress and homework against the stored class record', async () => {
    const { svc, act, propose, A, hong, kim } = setup();
    const lessonOn = (sid) => svc().getStudentLessons(sid, '2026-09-14', '2026-09-14')[0];
    await act('update_lesson', { lesson_id: lessonOn(hong).lesson_id, progress: '3단원', homework: '프린트 A\n프린트 B' });
    assert.equal(svc().getClassSession('2026-09-14', A).progress, '3단원');
    assert.equal(lessonOn(kim).progress, '3단원');
    assert.equal(lessonOn(kim).homework, '프린트 A\n프린트 B');
    // A cleared row progress follows the class record again, so the read-back differs.
    const cleared = await propose('update_lesson', { lesson_id: lessonOn(hong).lesson_id, progress: '' });
    assert.equal(cleared.applied.verification_status, 'mismatch');
    assert.equal(lessonOn(hong).progress, '3단원');
  });

  it('save_lessons_batch verifies every given field, not only attendance', async () => {
    const { svc, act, propose, A, hong, kim, lee } = setup();
    const lessonOn = (sid) => svc().getStudentLessons(sid, '2026-09-21', '2026-09-21')[0];
    await act('save_lessons_batch', {
      class_id: A, lesson_date: '2026-09-21',
      items: [
        { student_id: hong, concentration: '결석', assignment_completion: 'C', special_note: '조퇴' },
        { student_id: kim, test_status: '실시', test_score: '17', test_max_score: '20', test_difficulty: '중' }
      ]
    });
    assert.equal(lessonOn(hong).concentration, 'ABSENT');
    // Difficulty is one class value: the most common one wins, so 홍길동's '상' is not stored.
    const mixed = await propose('save_lessons_batch', {
      class_id: A, lesson_date: '2026-09-28',
      items: [hong, kim, lee].map((sid, i) => ({ student_id: sid, test_status: '실시', test_score: 10, test_max_score: 20, test_difficulty: i ? '하' : '상' }))
    });
    assert.equal(mixed.applied.verification_status, 'mismatch');
  });

  it('save_lesson verifies every given field, with the class record winning over a cleared difficulty', async () => {
    const { svc, act, propose, A, hong, kim } = setup();
    const lessonOn = (sid, d) => svc().getStudentLessons(sid, d, d)[0];
    await act('save_lesson', {
      student_id: hong, class_id: A, lesson_date: '2026-09-21',
      test_status: '실시', test_score: '17', test_max_score: 20, assignment_completion: 'B', special_note: '오답 정리 잘함'
    });
    assert.equal(lessonOn(hong, '2026-09-21').special_note, '오답 정리 잘함');
    // Untested row: the class record clears max / difficulty, which is not a mismatch.
    await act('save_lesson', { student_id: kim, class_id: A, lesson_date: '2026-09-21', test_max_score: 20, test_difficulty: '상', concentration: '결석' });
    assert.equal(lessonOn(kim, '2026-09-21').test_difficulty, '');

    await act('save_class_session', { class_id: A, lesson_date: '2026-09-28', test_max_score: 20, test_difficulty: '중' });
    const cleared = await propose('save_lesson', { student_id: hong, class_id: A, lesson_date: '2026-09-28', test_status: '실시', test_score: 12, test_difficulty: '' });
    assert.equal(cleared.applied.verification_status, 'mismatch');
    assert.equal(lessonOn(hong, '2026-09-28').test_difficulty, '중');
  });

  it('save_lessons_batch verifies the class notice it was given', async () => {
    const { store, svc, act, A, hong } = setup();
    const ctx = () => ({ table: (name) => store.readTable(name), api: svc() });
    const { preview } = await act('save_lessons_batch', { class_id: A, lesson_date: '2026-09-21', class_notice: '교재 지참', items: [{ student_id: hong }] });
    assert.equal(svc().getClassSessionNotice('2026-09-21', A), '교재 지참');
    const verify = LMS.agentActions.get('save_lessons_batch').verify;
    assert.equal(verify(ctx(), preview.args).ok, true);
    svc().saveClassSessionNotice('2026-09-21', A, '다른 공지');
    assert.equal(verify(ctx(), preview.args).ok, false);
  });
});

describe('agent write actions: homework', () => {
  it('sets, checks, shrinks and personalises homework', async () => {
    const { act, A, hong, kim } = setup();
    await act('save_session_homework', { class_id: A, lesson_date: '2026-09-09', titles: ['프린트1', '프린트2'] });
    // replace_class is stored on the student's lesson, so that lesson must exist.
    await act('save_lesson', { student_id: hong, class_id: A, lesson_date: '2026-09-09', attendance: '출석' });
    await act('save_homework_checks', {
      class_id: A, lesson_date: '2026-09-09',
      checks: [{ student_id: hong, title: '프린트1', status: 'B' }, { student_id: kim, title: '프린트2', status: 'A' }]
    });
    await act('save_session_homework', { class_id: A, lesson_date: '2026-09-09', titles: ['프린트1'] });
    await act('save_student_homework_items', { class_id: A, student_id: hong, lesson_date: '2026-09-09', titles: ['개인 오답'], replace_class: true });
  });
});

describe('agent write actions: makeup', () => {
  it('creates, updates and cancels makeup sessions', async () => {
    const { store, svc, act, A, hong, kim } = setup();
    await act('create_makeup', { kind: '학생', makeup_date: '2026-09-19', start_time: '14:00', end_time: '15:00', student_ids: [hong, kim] });
    await act('create_makeup', { kind: '반', makeup_date: '2026-09-26', class_id: A });
    const mk = table(store, 'MakeupSessions').find((m) => m.makeup_date === '2026-09-19');
    assert.ok(mk);
    await act('update_makeup', { makeup_id: mk.makeup_id, start_time: '15:00', end_time: '16:00', memo: '시간 변경' });
    await act('cancel_makeup', { makeup_id: mk.makeup_id });
    assert.throws(() => svc().previewAgentAction('cancel_makeup', { makeup_id: mk.makeup_id }), /이미 취소/);
  });
});

describe('agent write actions: tasks and counseling', () => {
  it('creates, updates, completes and deletes a task', async () => {
    const { store, act, A, hong } = setup();
    await act('create_task', { due_date: '2026-09-20', kind: 'admin', title: '교재 주문', student_id: hong });
    const task = table(store, 'Tasks').find((t) => t.title === '교재 주문');
    await act('update_task', { task_id: task.task_id, title: '교재 주문 확인', class_id: A });
    await act('update_task_status', { task_id: task.task_id, status: '완료' });
    await act('delete_task', { task_id: task.task_id });
    assert.equal(table(store, 'Tasks').some((t) => t.task_id === task.task_id), false);
  });

  it('creates, updates and deletes counseling notes', async () => {
    const { store, svc, act, hong } = setup();
    await act('create_counseling', { student_id: hong, kind: '학생', counsel_date: '2026-09-14', content: '수학 상담', follow_up_date: '2026-09-21' });
    const [note] = svc().getCounselingNotes(hong);
    await act('update_counseling', { note_id: note.note_id, content: '수학 상담 (수정)', follow_up_date: '' });
    assert.equal(svc().getCounselingNotes(hong)[0].content, '수학 상담 (수정)');
    await act('delete_counseling', { note_id: note.note_id });
    assert.equal(svc().getCounselingNotes(hong).length, 0);
    assert.equal(table(store, 'AgentProposals').every((p) => p.verification_status === 'verified'), true);
  });
});

describe('agent write actions: plans', () => {
  it('saves, overwrites, marks done and deletes a class plan', async () => {
    const { store, svc, act, A } = setup();
    await act('save_class_plan', { class_id: A, period_type: '일간', period_key: '2026-09-16', title: '일차함수', content: '기울기' });
    const [plan] = table(store, 'ClassPlans');
    await act('save_class_plan', { class_id: A, period_type: '일간', period_key: '2026-09-16', homework: 'p.30' });
    assert.equal(LMS.findById(table(store, 'ClassPlans'), 'plan_id', plan.plan_id).title, '일차함수');
    assert.throws(() => svc().previewAgentAction('save_class_plan', { class_id: A, period_type: '일간', period_key: '2026-09-16', homework: 'p.30' }), /바뀌는 내용이 없습니다/);
    assert.throws(() => svc().previewAgentAction('save_class_plan', { plan_id: plan.plan_id }), /바뀌는 내용이 없습니다/);
    await act('set_daily_plan_done', { class_id: A, date: '2026-09-16', status: '일부' });
    await act('set_daily_plan_done', { class_id: A, date: '2026-09-16', status: '' });
    await act('delete_class_plan', { plan_id: plan.plan_id });
    assert.throws(() => svc().previewAgentAction('set_daily_plan_done', { class_id: A, date: '2026-09-16', status: '완료' }), /일간 계획이 없습니다/);
  });

  it('save_class_plan verifies the done status it was given', async () => {
    const { store, svc, act, A } = setup();
    const ctx = () => ({ table: (name) => store.readTable(name), api: svc() });
    const { preview } = await act('save_class_plan', { class_id: A, period_type: '일간', period_key: '2026-09-16', title: '일차함수', done_status: '완료' });
    const [plan] = table(store, 'ClassPlans');
    assert.equal(plan.done_status, '완료');
    const verify = LMS.agentActions.get('save_class_plan').verify;
    assert.equal(verify(ctx(), preview.args, plan).ok, true);
    svc().setDailyPlanDone(A, '2026-09-16', '일부');
    assert.equal(verify(ctx(), preview.args, plan).ok, false);
    // Without done_status the stored result is left alone and not compared.
    await act('save_class_plan', { plan_id: plan.plan_id, memo: '복습 위주' });
    assert.equal(LMS.findById(table(store, 'ClassPlans'), 'plan_id', plan.plan_id).done_status, '일부');
  });
});

describe('agent write actions: bulk caps', () => {
  it('refuses bulk inputs over the shared caps before touching any row', () => {
    const { svc, A, hong, kim } = setup();
    const ids = (n) => Array.from({ length: n }, (_, i) => 'STU-' + String(9000 + i));
    const over = LMS.AGENT_BATCH_MAX + 1;
    const capped = (tool, args, re) => assert.throws(() => svc().previewAgentAction(tool, args), re, tool);
    const cap = (unit) => new RegExp('한 번에 ' + LMS.AGENT_BATCH_MAX + unit + '까지');
    capped('save_lessons_batch', { class_id: A, lesson_date: '2026-09-21', items: ids(over).map((id) => ({ student_id: id })) }, cap('명'));
    capped('set_students_status', { student_ids: ids(over), status: '휴원' }, cap('명'));
    capped('move_students', { from_class_id: A, to_class_id: A, student_ids: ids(over), date: '2026-09-15' }, cap('명'));
    capped('create_makeup', { kind: '학생', makeup_date: '2026-09-19', student_ids: ids(over) }, cap('명'));
    capped('save_session_homework', { class_id: A, lesson_date: '2026-09-09', titles: ids(over) }, cap('개'));
    capped('save_student_homework_items', { class_id: A, student_id: hong, lesson_date: '2026-09-09', titles: ids(over) }, cap('개'));
    capped('save_school_exams_batch', { exams: ids(over).map(() => ({ school: '한빛중' })) }, cap('건'));
    svc().saveSessionHomework({ lesson_date: '2026-09-09', class_id: A, titles: ['프린트1'] });
    capped('save_homework_checks', {
      class_id: A, lesson_date: '2026-09-09',
      checks: Array.from({ length: LMS.AGENT_CHECKS_MAX + 1 }, () => ({ student_id: kim, title: '프린트1', status: 'A' }))
    }, new RegExp('한 번에 ' + LMS.AGENT_CHECKS_MAX + '건까지'));
    const period = svc().saveExamPeriod({ title: '2학기 중간', start_date: '2026-10-01', end_date: '2026-10-20' });
    capped('set_exam_period_suspended_classes', { exam_period_id: period.exam_period_id, class_ids: ids(over) }, cap('개'));
    // At the cap the size check passes and the usual checks take over.
    assert.throws(() => svc().previewAgentAction('set_students_status', { student_ids: ids(LMS.AGENT_BATCH_MAX), status: '휴원' }), /학생|찾을 수 없/);
  });
});

describe('agent write actions: exams', () => {
  it('creates, updates, suspends classes for, closes and deletes exam periods', async () => {
    const { store, act, A } = setup();
    await act('create_exam_period', { title: '2학기 중간', start_date: '2026-10-01', end_date: '2026-10-20', exam_type: '중간' });
    const ep = table(store, 'ExamPeriods').find((p) => p.title === '2학기 중간');
    await act('update_exam_period', { exam_period_id: ep.exam_period_id, end_date: '2026-10-18' });
    await act('set_exam_period_suspended_classes', { exam_period_id: ep.exam_period_id, class_ids: [A] });
    const del = await act('delete_exam_period', { exam_period_id: ep.exam_period_id });
    assert.match(del.preview.text, /휴강 반 1개 해제/);
    await act('create_exam_period', { title: '2학기 기말', start_date: '2026-11-20', end_date: '2026-12-10' });
    const ep2 = table(store, 'ExamPeriods').find((p) => p.title === '2학기 기말');
    await act('close_exam_period', { exam_period_id: ep2.exam_period_id });
  });

  it('saves, batch-saves and deletes school exams', async () => {
    const { store, act } = setup();
    await act('save_school_exam', {
      school: '한빛중', grade: '중2', school_year: '2026', semester: '2', exam_type: '중간',
      exam_date: '2026-10-12', exam_end_date: '2026-10-14', math_exam_date: '2026-10-13'
    });
    const batch = await act('save_school_exams_batch', { exams: [
      { school: '한빛중', grade: '중2', school_year: '2026', semester: '2', exam_type: '중간', exam_date: '2026-10-13' },
      { school: '푸른중', grade: '중2', school_year: '2026', semester: '2', exam_type: '기말', exam_date: '2026-12-01' }
    ] });
    assert.match(batch.preview.text, /추가 1건, 수정 1건/);
    const sx = table(store, 'SchoolExams').find((e) => e.school === '한빛중');
    await act('delete_school_exam', { school_exam_id: sx.school_exam_id });
    assert.equal(table(store, 'SchoolExams').some((e) => e.school_exam_id === sx.school_exam_id), false);
  });
});

describe('agent write actions: reports', () => {
  it('saves and overwrites a monthly report', async () => {
    const { act, hong } = setup();
    await act('save_monthly_report', { student_id: hong, year: 2026, month: 9, report_text: '9월 리포트' });
    const over = await act('save_monthly_report', { student_id: hong, year: 2026, month: 9, report_text: '9월 리포트 수정', status: '확정' });
    assert.match(over.preview.text, /덮어쓰기/);
  });

  it('refuses to touch a confirmed monthly report, at preview and at apply', async () => {
    const { store, svc, run, hong } = setup();
    const key = { student_id: hong, year: 2026, month: 9 };
    const message = /이미 확정된 월간 리포트라 AI가 고칠 수 없습니다/;
    svc().saveMonthlyReport({ ...key, report_text: '확정본', status: '확정' });
    assert.throws(() => svc().previewAgentAction('save_monthly_report', { ...key, report_text: 'AI 수정' }), message);
    assert.throws(() => svc().previewAgentAction('save_monthly_report', { ...key, report_text: '확정본', status: '임시' }), message, 'no AI un-confirm');

    svc().saveMonthlyReport({ ...key, report_text: '확정본', status: '임시' });
    const preview = svc().previewAgentAction('save_monthly_report', { ...key, report_text: 'AI 수정' });
    const saved = svc().saveAgentTurn({ message: 'test', reply: 'ok', calls: [{ tool: 'save_monthly_report', args: preview.args, preview }] });
    svc().saveMonthlyReport({ ...key, report_text: '확정본', status: '확정' });
    const proposalId = saved.message.proposal.proposal_id;
    await assert.rejects(apply(APP_SESSION, { proposal_id: proposalId }, run), message);
    assert.equal(table(store, 'AgentProposals').find((p) => p.proposal_id === proposalId).status, 'failed');
    const row = table(store, 'MonthlyReports').find((r) => r.student_id === hong);
    assert.equal(row.report_text, '확정본');
    assert.equal(row.status, '확정');
  });
});