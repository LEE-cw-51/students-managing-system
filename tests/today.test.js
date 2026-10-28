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
