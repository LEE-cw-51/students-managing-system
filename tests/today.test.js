'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
const { seedRich } = require('../scripts/dev-data.js');

const TODAY = '2026-10-26'; // Monday: 중2 A반 meets, previous lesson 10-21

function seeded() {
  const store = createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' });
  const api = LMS.createService(store);
  api.ensureSchema();
  const demo = seedRich(api, TODAY);
  return { api, store, demo, classId: demo.classes[0].class_id };
}

function payload(s, overrides) {
  const ses = s.api.getTodayClassSession(TODAY, s.classId);
  const prior = ses.prior_homework;
  return Object.assign({
    lesson_date: TODAY,
    class_id: s.classId,
    session: { progress: '11. 피타고라스 정리', content: '증명', test_title: '확인 테스트', test_max_score: '10', test_difficulty: '중', class_notice: '' },
    prior: {
      assigned_date: prior.assigned_date,
      checks: ses.students.flatMap((st) => prior.items.map((it) => ({ item_id: it.item_id, student_id: st.student_id, status: '완료' })))
    },
    homework_items: [{ title: '교재 80~83쪽' }, { title: '오답 정리' }],
    students: ses.students.map((st, i) => ({
      student_id: st.student_id,
      attendance: i === 0 ? '결석' : '출석',
      test_status: '실시',
      test_score: 8,
      concentration: 'A',
      assignment_completion: i === 2 ? 'C' : '',
      special_note: i === 1 ? '질문 많음' : ''
    }))
  }, overrides || {});
}

describe('saveTodaySession', () => {
  it('saves checks, homework, session and students together', () => {
    const s = seeded();
    const p = payload(s);
    const res = s.api.saveTodaySession(p);
    assert.equal(res.saved_count, 4);
    const lessons = s.api.getLessons(TODAY, s.classId);
    const byId = Object.fromEntries(lessons.map((l) => [l.student_id, l]));
    const [absent, second, third, fourth] = p.students.map((x) => byId[x.student_id]);

    assert.equal(absent.attendance, '결석');
    assert.equal(absent.test_status, '미실시', 'absent → no test');
    assert.equal(absent.concentration, 'ABSENT');
    assert.equal(second.assignment_completion, 'A', 'grade from homework checks (T2)');
    assert.equal(third.assignment_completion, 'C', 'manual grade wins');
    assert.equal(fourth.test_max_score, 10);
    assert.equal(second.progress, '11. 피타고라스 정리', 'session progress copied (T4)');
    assert.equal(second.homework, '교재 80~83쪽\n오답 정리');

    const report = s.api.generateDailyReport(second.lesson_id).text;
    assert.match(report, /교재 80~83쪽/, 'homework reaches the daily report (T3)');
    assert.match(report, /질문 많음/);
    assert.equal(s.api.getClassSession(TODAY, s.classId).test_title, '확인 테스트');
  });

  it('students with their own progress get it in their daily report', () => {
    const s = seeded();
    const p = payload(s);
    p.students[1] = Object.assign({}, p.students[1], { progress_own: 'Y', progress: '10. 복습' });
    p.students[2] = Object.assign({}, p.students[2], { progress_own: 'Y', progress: '12. 선행' });
    s.api.saveTodaySession(p);
    const byId = Object.fromEntries(s.api.getLessons(TODAY, s.classId).map((l) => [l.student_id, l]));
    const progressLine = (i) => s.api.generateDailyReport(byId[p.students[i].student_id].lesson_id).text
      .split('\n').find((line) => line.includes('학습 진도'));
    assert.equal(progressLine(1), '3. 학습 진도: 10. 복습');
    assert.equal(progressLine(2), '3. 학습 진도: 12. 선행');
    assert.equal(progressLine(3), '3. 학습 진도: 11. 피타고라스 정리');
    assert.equal(s.api.getClassSession(TODAY, s.classId).progress, '11. 피타고라스 정리');

    const row = s.api.getClassProgressLog(s.classId, { start: TODAY, end: TODAY }).rows.find((r) => r.date === TODAY);
    assert.equal(row.progress, '11. 피타고라스 정리');
    assert.equal(row.own_progress_count, 2);
  });

  it('saves a student on another paper and keeps it through class test edits', () => {
    const s = seeded();
    const p = payload(s);
    p.students[2] = Object.assign({}, p.students[2], {
      test_own: 'Y', test_title: '심화 테스트', test_max_score: '20', test_difficulty: '상', test_score: 15
    });
    s.api.saveTodaySession(p);
    const lessonOf = (i) => s.api.getLessons(TODAY, s.classId).find((l) => l.student_id === p.students[i].student_id);
    const own = lessonOf(2);
    assert.equal(own.test_own, 'Y');
    assert.equal(own.test_title, '심화 테스트');
    assert.equal(own.test_max_score, 20);
    assert.equal(own.test_difficulty, '상');
    assert.equal(lessonOf(3).test_own, '');
    assert.equal(lessonOf(3).test_title, '');
    assert.equal(lessonOf(3).test_max_score, 10);
    assert.equal(s.api.getClassSession(TODAY, s.classId).test_max_score, 10, 'own max never becomes the class max');

    const reloaded = s.api.getTodayClassSession(TODAY, s.classId).students.find((st) => st.student_id === p.students[2].student_id).lesson;
    assert.deepEqual(
      [reloaded.test_own, reloaded.test_title, reloaded.test_max_score, reloaded.test_difficulty],
      ['Y', '심화 테스트', 20, '상']
    );
    const classRow = s.api.getTodayClassSession(TODAY, s.classId).students.find((st) => st.student_id === p.students[3].student_id).lesson;
    assert.equal(classRow.test_own, '');
    assert.equal(classRow.test_title, '');

    s.api.saveClassSession({ lesson_date: TODAY, class_id: s.classId, test_max_score: 12, test_difficulty: '하' });
    assert.equal(lessonOf(2).test_max_score, 20, 'class edit leaves the own paper');
    assert.equal(lessonOf(2).test_difficulty, '상');
    assert.equal(lessonOf(3).test_max_score, 12);
    assert.equal(lessonOf(3).test_difficulty, '하');

    s.api.saveLessonsBatch([{ lesson_date: TODAY, class_id: s.classId, student_id: p.students[2].student_id, attendance: '출석', test_status: '실시', test_score: 16 }]);
    assert.equal(lessonOf(2).test_own, 'Y', 'a save without test_own keeps the own paper');
    assert.equal(lessonOf(2).test_max_score, 20);

    const back = payload(s);
    s.api.saveTodaySession(back);
    assert.equal(lessonOf(2).test_own, '', 'saving without test_own returns to the class paper');
    assert.equal(lessonOf(2).test_title, '');
    assert.equal(lessonOf(2).test_max_score, 10);
  });

  it('refuses another paper without a max score', () => {
    const s = seeded();
    const before = JSON.stringify(s.store.readTable('Lessons'));
    const p = payload(s);
    p.students[1] = Object.assign({}, p.students[1], { test_own: 'Y', test_title: '보충', test_max_score: '' });
    const name = s.api.getTodayClassSession(TODAY, s.classId).students.find((st) => st.student_id === p.students[1].student_id).name;
    assert.throws(() => s.api.saveTodaySession(p), { message: name + ' 학생 시험지 만점을 입력해 주세요.' });
    assert.equal(JSON.stringify(s.store.readTable('Lessons')), before);
  });

  it('writes nothing when a row is invalid', () => {
    const s = seeded();
    const before = JSON.stringify([s.store.readTable('Lessons'), s.store.readTable('HomeworkChecks'), s.store.readTable('HomeworkItems'), s.store.readTable('ClassSessions')]);
    const p = payload(s);
    p.students[3].test_score = 'abc';
    assert.throws(() => s.api.saveTodaySession(p), /점수/);
    const p2 = payload(s, { session: { progress: 'x' } });
    p2.students.forEach((st) => { st.test_status = '실시'; });
    // session without max and no stored max for today → refuse
    assert.throws(() => s.api.saveTodaySession(p2), /만점/);
    assert.equal(JSON.stringify([s.store.readTable('Lessons'), s.store.readTable('HomeworkChecks'), s.store.readTable('HomeworkItems'), s.store.readTable('ClassSessions')]), before);
  });

  it('refuses a score above the max, on the class paper or another one', () => {
    const s = seeded();
    const before = JSON.stringify(s.store.readTable('Lessons'));
    const p = payload(s);
    p.students[1].test_score = 11;
    assert.throws(() => s.api.saveTodaySession(p), { message: '테스트 점수가 만점보다 클 수 없습니다.' });
    const p2 = payload(s);
    p2.students[2] = Object.assign({}, p2.students[2], { test_own: 'Y', test_max_score: '20', test_score: 25 });
    assert.throws(() => s.api.saveTodaySession(p2), { message: '테스트 점수가 만점보다 클 수 없습니다.' });
    assert.equal(JSON.stringify(s.store.readTable('Lessons')), before);
    const ok = payload(s);
    ok.students[1].test_score = 10;
    assert.equal(s.api.saveTodaySession(ok).saved_count, 4, 'a full score is fine');
  });

  it('refuses a student who is not on this class date, but keeps one already recorded off the roster', () => {
    const s = seeded();
    const roster = s.api.getTodayClassSession(TODAY, s.classId).students.map((st) => st.student_id);
    const outsider = s.store.readTable('Students').find((st) => !roster.includes(st.student_id));
    const before = JSON.stringify(s.store.readTable('Lessons'));
    const p = payload(s);
    p.students.push({ student_id: outsider.student_id, attendance: '출석', test_status: '미실시' });
    assert.throws(() => s.api.saveTodaySession(p), { message: '이 반 명단에 없는 학생입니다: ' + outsider.name });
    assert.equal(JSON.stringify(s.store.readTable('Lessons')), before);

    s.api.saveLesson({ lesson_date: TODAY, class_id: s.classId, student_id: outsider.student_id, attendance: '출석' });
    const listed = s.api.getTodayClassSession(TODAY, s.classId).students.find((st) => st.student_id === outsider.student_id);
    assert.equal(listed.off_roster, true);
    assert.equal(s.api.saveTodaySession(payload(s)).saved_count, 5, 'the off-roster row saves with the rest');
  });

  it('a batch save back on the class paper takes the class max and difficulty', () => {
    const s = seeded();
    const p = payload(s);
    p.students[2] = Object.assign({}, p.students[2], {
      test_own: 'Y', test_title: '심화 테스트', test_max_score: '20', test_difficulty: '상', test_score: 15
    });
    s.api.saveTodaySession(p);
    const sid = p.students[2].student_id;
    s.api.saveLessonsBatch([{ lesson_date: TODAY, class_id: s.classId, student_id: sid, attendance: '출석', test_status: '실시', test_score: 9, test_own: '' }]);
    const row = s.api.getLessons(TODAY, s.classId).find((l) => l.student_id === sid);
    assert.deepEqual([row.test_own, row.test_title, row.test_max_score, row.test_difficulty, row.test_score], ['', '', 10, '중', 9]);
  });

  it('a batch save back on the class paper ignores a stale own max and difficulty', () => {
    const s = seeded();
    const p = payload(s);
    p.students[2] = Object.assign({}, p.students[2], {
      test_own: 'Y', test_title: '심화 테스트', test_max_score: '20', test_difficulty: '상', test_score: 15
    });
    s.api.saveTodaySession(p);
    const sid = p.students[2].student_id;
    const back = (score) => s.api.saveLessonsBatch([{
      lesson_date: TODAY, class_id: s.classId, student_id: sid, attendance: '출석', test_status: '실시', test_score: score,
      test_own: '', test_max_score: 20, test_difficulty: '상'
    }]);
    assert.throws(() => back(15), { message: '테스트 점수가 만점보다 클 수 없습니다.' }, 'a score fitting only the stale max is refused');
    back(9);
    const row = s.api.getLessons(TODAY, s.classId).find((l) => l.student_id === sid);
    assert.deepEqual([row.test_own, row.test_title, row.test_max_score, row.test_difficulty, row.test_score], ['', '', 10, '중', 9]);
  });

  it('updateLesson back on the class paper takes the class max and difficulty', () => {
    const s = seeded();
    const p = payload(s);
    p.students[2] = Object.assign({}, p.students[2], {
      test_own: 'Y', test_title: '심화 테스트', test_max_score: '20', test_difficulty: '상', test_score: 15
    });
    s.api.saveTodaySession(p);
    const lessonOf = () => s.api.getLessons(TODAY, s.classId).find((l) => l.student_id === p.students[2].student_id);
    s.api.updateLesson({ lesson_id: lessonOf().lesson_id, test_score: 16 });
    assert.deepEqual([lessonOf().test_own, lessonOf().test_max_score, lessonOf().test_difficulty], ['Y', 20, '상'], 'an edit silent about the paper keeps it');
    s.api.updateLesson({ lesson_id: lessonOf().lesson_id, test_own: '', test_score: 7, test_max_score: 20, test_difficulty: '상' });
    const row = lessonOf();
    assert.deepEqual([row.test_own, row.test_title, row.test_max_score, row.test_difficulty, row.test_score], ['', '', 10, '중', 7]);
    assert.equal(s.api.getClassSession(TODAY, s.classId).test_difficulty, '중', 'stale own values never reach the class record');
  });

  it('refuses prior homework checks for a student outside the class', () => {
    const s = seeded();
    const roster = s.api.getTodayClassSession(TODAY, s.classId).students.map((st) => st.student_id);
    const outsider = s.store.readTable('Students').find((st) => !roster.includes(st.student_id));
    const before = JSON.stringify([s.store.readTable('Lessons'), s.store.readTable('HomeworkChecks')]);
    const p = payload(s);
    p.prior.checks.push({ item_id: p.prior.checks[0].item_id, student_id: outsider.student_id, status: '완료' });
    assert.throws(() => s.api.saveTodaySession(p), { message: '이 반 명단에 없는 학생입니다: ' + outsider.name });
    assert.equal(JSON.stringify([s.store.readTable('Lessons'), s.store.readTable('HomeworkChecks')]), before);
  });
});

describe('lesson validation', () => {
  it('refuses a test score above the max', () => {
    const base = { lesson_date: TODAY, student_id: 'S1', class_id: 'C1', test_status: '실시', test_max_score: 20 };
    assert.throws(() => LMS.validateLessonInput(Object.assign({}, base, { test_score: 25 })), { message: '테스트 점수가 만점보다 클 수 없습니다.' });
    assert.equal(LMS.validateLessonInput(Object.assign({}, base, { test_score: 20 })).test_score, 20);
  });

  it('refuses a negative test score', () => {
    const base = { lesson_date: TODAY, student_id: 'S1', class_id: 'C1', test_status: '실시', test_max_score: 20 };
    assert.throws(() => LMS.validateLessonInput(Object.assign({}, base, { test_score: -1 })), { message: '테스트 점수는 0 이상이어야 합니다.' });
    assert.equal(LMS.validateLessonInput(Object.assign({}, base, { test_score: 0 })).test_score, 0);
  });
});

describe('today views', () => {
  it('session reports meeting info and last progress', () => {
    const s = seeded();
    const ses = s.api.getTodayClassSession(TODAY, s.classId);
    assert.equal(ses.meets, true);
    assert.equal(ses.prev_meeting, '2026-10-21');
    assert.equal(ses.next_meeting, '2026-10-28');
    assert.equal(ses.last_progress.date, '2026-10-21');
    const off = s.api.getTodayClassSession('2026-10-27', s.classId);
    assert.equal(off.meets, false);
  });

  it('board lists classes by time, follow-up tasks and soon exams', () => {
    const s = seeded();
    const sid = s.demo.students[0].student_id;
    s.api.saveCounselingNote({ student_id: sid, kind: '학부모', counsel_date: '2026-10-20', content: 'x', follow_up_date: TODAY });
    s.api.saveSchoolExam({ school_year: '2026', semester: '2', exam_type: '기말', school: '한빛중학교', grade: '중2', exam_date: '2026-10-30' });
    const b = s.api.getTodayBoard(TODAY);
    assert.deepEqual(b.classes.map((c) => c.start_time), ['18:00', '20:00']);
    assert.ok(b.tasks.some((t) => t.kind === 'counsel_parent'));
    assert.ok(b.tasks.every((t) => t.kind !== 'homework_check'));
    assert.equal(b.exams_soon.length, 1);
    assert.equal(b.week.length, 7);
  });
});
