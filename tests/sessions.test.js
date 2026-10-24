'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo, emptyTables } = require('./memory-store.js');

describe('schema migration v2', () => {
  function legacyStore() {
    // Tables as written before v2: no schedule, notices in ClassSessionNotices.
    const store = createMemoryStore();
    const tables = emptyTables();
    tables.Classes = [{
      class_id: 'CLS_000001', class_name: '중2 A반', weekday: '월/수', start_time: '18:00', end_time: '20:00', status: '운영'
    }];
    tables.Students = [
      { student_id: 'STU_000001', name: '가', grade: '중2', status: '재원' },
      { student_id: 'STU_000002', name: '나', grade: '중2', status: '재원' }
    ];
    tables.StudentClasses = [
      { id: 'REL_000001', student_id: 'STU_000001', class_id: 'CLS_000001', start_date: '2026-03-01', end_date: '', status: '현재' },
      { id: 'REL_000002', student_id: 'STU_000002', class_id: 'CLS_000001', start_date: '2026-03-01', end_date: '', status: '현재' }
    ];
    tables.Lessons = [
      { lesson_id: 'LES_1', lesson_date: '2026-09-14', student_id: 'STU_000001', class_id: 'CLS_000001', attendance: '출석', test_status: '실시', test_score: 18, test_max_score: 20, test_difficulty: '중', progress: '삼각형' },
      { lesson_id: 'LES_2', lesson_date: '2026-09-14', student_id: 'STU_000002', class_id: 'CLS_000001', attendance: '출석', test_status: '미실시', test_score: '', test_max_score: '', test_difficulty: '', progress: '삼각형' }
    ];
    tables.ClassSessionNotices = [{ id: 'CSN_000001', lesson_date: '2026-09-14', class_id: 'CLS_000001', class_notice: '다음 주 휴강' }];
    Object.keys(tables).forEach((name) => store.writeTable(name, tables[name]));
    return store;
  }

  it('creates schedules and class sessions, and is idempotent', () => {
    const store = legacyStore();
    const before = JSON.stringify(store.readTable('Lessons'));
    assert.equal(LMS.createService(store).ensureSchema(), true);
    const cls = store.readTable('Classes')[0];
    assert.deepEqual(cls.schedule, [
      { day: '월', start: '18:00', end: '20:00' },
      { day: '수', start: '18:00', end: '20:00' }
    ]);
    assert.equal(cls.class_type, '정규');
    const sessions = store.readTable('ClassSessions');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].progress, '삼각형');
    assert.equal(sessions[0].test_max_score, 20);
    assert.equal(sessions[0].test_difficulty, '중');
    assert.equal(sessions[0].class_notice, '다음 주 휴강');
    assert.match(sessions[0].session_id, /^SES_/);
    assert.equal(JSON.stringify(store.readTable('Lessons')), before, 'lessons untouched');

    const snapshot = JSON.stringify(Object.keys(LMS.TABLES).map((t) => store.readTable(t)));
    assert.equal(LMS.createService(store).ensureSchema(), false);
    assert.equal(JSON.stringify(Object.keys(LMS.TABLES).map((t) => store.readTable(t))), snapshot);
  });

  it('keeps daily report text identical after migration', () => {
    const store = legacyStore();
    const api0 = LMS.createService(store);
    const before = api0.generateDailyReports('2026-09-14', 'CLS_000001');
    LMS.createService(store).ensureSchema();
    const after = LMS.createService(store).generateDailyReports('2026-09-14', 'CLS_000001');
    assert.deepEqual(after, before);
  });
});

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
