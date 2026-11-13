'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo, emptyTables } = require('./memory-store.js');

describe('class sessions', () => {
  function seeded() {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    api.ensureSchema();
    const demo = seedDemo(api);
    return { store, api, demo };
  }

  it('legacy lesson rows populate the class session', () => {
    const { api, demo } = seeded();
    const session = api.getClassSession('2026-09-14', demo.class.class_id);
    assert.match(session.progress, /삼각형의 성질/);
    assert.equal(session.test_max_score, 20);
    assert.equal(session.test_difficulty, '중');
  });

  it('saving a session writes progress and max through to student rows (R4)', () => {
    const { api, demo } = seeded();
    const classId = demo.class.class_id;
    api.saveClassSession({ lesson_date: '2026-09-14', class_id: classId, progress: '사각형 성질 완료', test_max_score: 25, content: '복습' });
    const lessons = api.getLessons('2026-09-14', classId);
    lessons.forEach((l) => assert.equal(l.progress, '사각형 성질 완료'));
    const tested = lessons.filter((l) => l.test_status === '실시');
    tested.forEach((l) => assert.equal(l.test_max_score, 25));
    assert.equal(api.getClass(classId).current_progress, '사각형 성질 완료');
    const reports = api.generateDailyReports('2026-09-14', classId);
    assert.ok(JSON.stringify(reports).indexOf('사각형 성질 완료') !== -1);
  });

  it('student-only saves keep the session values', () => {
    const { api, demo } = seeded();
    const classId = demo.class.class_id;
    api.saveClassSession({ lesson_date: '2026-09-14', class_id: classId, progress: '세션 진도' });
    const [hong] = demo.students;
    const saved = api.saveLessonsBatch([{
      lesson_date: '2026-09-14', class_id: classId, student_id: hong.student_id,
      attendance: '출석', test_status: '실시', test_score: 19, special_note: '좋음'
    }]);
    assert.equal(saved[0].progress, '세션 진도');
    assert.equal(saved[0].test_max_score, 20, 'max filled from session');
    assert.equal(saved[0].special_note, '좋음');
  });

  it('notices are stored on the session and still readable', () => {
    const { api, store, demo } = seeded();
    const classId = demo.class.class_id;
    api.saveClassSessionNotice('2026-09-14', classId, '준비물: 컴퍼스');
    assert.equal(api.getClassSessionNotice('2026-09-14', classId), '준비물: 컴퍼스');
    assert.equal(store.readTable('ClassSessionNotices').length, 0);
    assert.equal(api.getClassSession('2026-09-14', classId).class_notice, '준비물: 컴퍼스');
  });

  it('a different per-student max score is not overwritten', () => {
    const { api, demo } = seeded();
    const classId = demo.class.class_id;
    const [hong] = demo.students;
    api.saveLessonsBatch([{
      lesson_date: '2026-09-14', class_id: classId, student_id: hong.student_id,
      attendance: '출석', test_status: '실시', test_score: 9, test_max_score: 10
    }]);
    api.saveClassSession({ lesson_date: '2026-09-14', class_id: classId, test_max_score: 30 });
    const row = api.getLessons('2026-09-14', classId).find((l) => l.student_id === hong.student_id);
    assert.equal(row.test_max_score, 10);
  });
});

describe('class record copies', () => {
  function seeded() {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    api.ensureSchema();
    const demo = seedDemo(api);
    return { api, demo, classId: demo.class.class_id };
  }
  const byStudent = (api, classId) => {
    const out = {};
    api.getLessons('2026-09-14', classId).forEach((l) => { out[l.student_id] = l; });
    return out;
  };

  it('a batch without progress or homework keeps them (no checklist that day)', () => {
    const { api, demo, classId } = seeded();
    assert.equal(api.getSessionHomework('2026-09-14', classId).from_legacy, true);
    api.saveLessonsBatch(demo.students.map((s) => ({
      lesson_date: '2026-09-14', class_id: classId, student_id: s.student_id,
      attendance: '출석', test_status: '실시', test_score: 15
    })));
    api.getLessons('2026-09-14', classId).forEach((l) => {
      assert.match(l.progress, /삼각형의 성질/);
      assert.match(l.homework, /오답 프린트/);
    });
  });

  it('difficulty and max go to tested students only', () => {
    const { api, demo, classId } = seeded();
    const [hong, kim, lee] = demo.students;
    assert.equal(byStudent(api, classId)[kim.student_id].test_difficulty, '', 'seed sent 중 for untested 김철수');
    api.saveLessonsBatch([{
      lesson_date: '2026-09-14', class_id: classId, student_id: lee.student_id,
      attendance: '결석', test_status: '미실시', test_difficulty: '중', test_max_score: 20
    }]);
    api.saveClassSession({ lesson_date: '2026-09-14', class_id: classId, test_difficulty: '상', test_max_score: 30 });
    const rows = byStudent(api, classId);
    assert.equal(rows[hong.student_id].test_difficulty, '상');
    assert.equal(rows[hong.student_id].test_max_score, 30);
    [kim, lee].forEach((s) => {
      assert.equal(rows[s.student_id].test_difficulty, '');
      assert.equal(rows[s.student_id].test_max_score, '');
    });
  });

  it('the class difficulty comes from tested rows only', () => {
    const { api, demo, classId } = seeded();
    const [hong, kim, lee] = demo.students;
    api.saveLessonsBatch([
      { student_id: hong.student_id, test_status: '실시', test_score: 10, test_max_score: 20, test_difficulty: '상' },
      { student_id: kim.student_id, test_status: '미실시', test_difficulty: '하' },
      { student_id: lee.student_id, test_status: '미실시', test_difficulty: '하' }
    ].map((r) => Object.assign({ lesson_date: '2026-09-21', class_id: classId, attendance: '출석' }, r)));
    assert.equal(api.getClassSession('2026-09-21', classId).test_difficulty, '상');
  });

  it('clearing the class max clears the rows that followed it and keeps their own', () => {
    const { api, demo, classId } = seeded();
    const [hong, , lee] = demo.students;
    api.saveLessonsBatch([{
      lesson_date: '2026-09-14', class_id: classId, student_id: hong.student_id,
      attendance: '출석', test_status: '실시', test_score: 9, test_max_score: 10
    }]);
    api.saveClassSession({ lesson_date: '2026-09-14', class_id: classId, test_max_score: '' });
    const rows = byStudent(api, classId);
    assert.equal(rows[lee.student_id].test_max_score, '', 'followed the class max');
    assert.equal(rows[hong.student_id].test_max_score, 10, 'own max kept');
    assert.equal(api.getClassSession('2026-09-14', classId).test_max_score, '');
  });
});
