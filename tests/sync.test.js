'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');

// Demo class meets 월/수; seedDemo records 2026-09-14 (월) for 홍길동·김철수·이영희.
function seeded() {
  const store = createMemoryStore({ today: '2026-09-16' });
  const api = LMS.createService(store);
  api.ensureSchema();
  const demo = seedDemo(api);
  return { store, api, demo, classId: demo.class.class_id };
}

const field = (api, date, classId, key) => api.getLessons(date, classId).map((l) => l[key]);

function recordToday(api, date, classId, extra) {
  const d = api.getTodayClassSession(date, classId);
  return api.saveTodaySession(Object.assign({
    lesson_date: date,
    class_id: classId,
    session: { progress: '진도' },
    homework_items: [],
    students: d.students.map((s) => ({ student_id: s.student_id, attendance: '출석' }))
  }, typeof extra === 'function' ? extra(d) : extra || {}));
}

describe('class record → student lessons', () => {
  it('a student saved alone later gets the class homework and progress', () => {
    const { api, demo, classId } = seeded();
    const [hong, kim, lee] = demo.students;
    api.saveTodaySession({
      lesson_date: '2026-09-16', class_id: classId, session: { progress: 'P1' },
      homework_items: [{ title: '숙제 A' }],
      students: [kim, lee].map((s) => ({ student_id: s.student_id }))
    });
    api.saveLesson({ lesson_date: '2026-09-16', class_id: classId, student_id: hong.student_id, attendance: '출석' });
    assert.deepEqual(field(api, '2026-09-16', classId, 'homework'), ['숙제 A', '숙제 A', '숙제 A']);
    assert.deepEqual(field(api, '2026-09-16', classId, 'progress'), ['P1', 'P1', 'P1']);
  });

  it('lessons created by homework checks on another day take that day’s class record', () => {
    const { api, demo, classId } = seeded();
    api.saveClassSession({ lesson_date: '2026-09-21', class_id: classId, progress: 'P21', test_difficulty: '상' });
    api.saveSessionHomework({ lesson_date: '2026-09-21', class_id: classId, items: [{ title: 'HW21' }] });
    api.saveHomeworkChecks({
      lesson_date: '2026-09-14', class_id: classId, check_date: '2026-09-21',
      checks: demo.students.map((s) => ({ index: 0, student_id: s.student_id, status: '완료' }))
    });
    assert.deepEqual(field(api, '2026-09-21', classId, 'progress'), ['P21', 'P21', 'P21']);
    assert.deepEqual(field(api, '2026-09-21', classId, 'homework'), ['HW21', 'HW21', 'HW21']);
    assert.deepEqual(field(api, '2026-09-21', classId, 'test_difficulty'), ['상', '상', '상']);
  });

  it('editing class fields on one lesson edits the class record for everyone', () => {
    const { api, classId } = seeded();
    const first = api.getLessons('2026-09-14', classId)[0];
    api.updateLesson({ lesson_id: first.lesson_id, progress: '새 진도', homework: '새 숙제', test_difficulty: '하' });
    assert.deepEqual(field(api, '2026-09-14', classId, 'progress'), ['새 진도', '새 진도', '새 진도']);
    assert.deepEqual(field(api, '2026-09-14', classId, 'homework'), ['새 숙제', '새 숙제', '새 숙제']);
    assert.deepEqual(field(api, '2026-09-14', classId, 'test_difficulty'), ['하', '하', '하']);
    assert.equal(api.getClassSession('2026-09-14', classId).progress, '새 진도');
    assert.deepEqual(api.getSessionHomework('2026-09-14', classId).items.map((i) => i.title), ['새 숙제']);
  });

  it('a different homework line on the batch updates an existing checklist', () => {
    const { api, demo, classId } = seeded();
    api.saveSessionHomework({ lesson_date: '2026-09-16', class_id: classId, items: [{ title: '옛 숙제' }] });
    api.saveLessonsBatch(demo.students.map((s) => ({
      lesson_date: '2026-09-16', class_id: classId, student_id: s.student_id, attendance: '출석', homework: '새 숙제'
    })));
    assert.deepEqual(api.getSessionHomework('2026-09-16', classId).items.map((i) => i.title), ['새 숙제']);
    assert.deepEqual(field(api, '2026-09-16', classId, 'homework'), ['새 숙제', '새 숙제', '새 숙제']);
  });

  it('legacy homework is the text most rows carry, not the first row', () => {
    const { api, store, classId } = seeded();
    const lessons = store.readTable('Lessons');
    lessons.sort((a, b) => a.student_id.localeCompare(b.student_id))[0].homework = '한 명만 다른 숙제';
    store.writeTable('Lessons', lessons);
    const fresh = LMS.createService(store);
    assert.deepEqual(fresh.getSessionHomework('2026-09-14', classId).items.map((i) => i.title),
      ['사각형의 성질 오답 프린트', '심화 문항 프린트 20번까지']);
  });

  it('clearing the latest progress falls back to the latest one left', () => {
    const { api, classId } = seeded();
    api.saveClassSession({ lesson_date: '2026-09-16', class_id: classId, progress: '최신 진도' });
    assert.equal(api.getClass(classId).current_progress, '최신 진도');
    api.saveClassSession({ lesson_date: '2026-09-16', class_id: classId, progress: '' });
    assert.match(api.getClass(classId).current_progress, /삼각형의 성질/);
  });
});

describe('homework carried to the next lesson', () => {
  it('homework given on a makeup day is checked at the next lesson', () => {
    const { api, classId } = seeded();
    recordToday(api, '2026-09-15', classId, { homework_items: [{ title: '보강 숙제' }] });
    const next = api.getTodayClassSession('2026-09-16', classId);
    assert.equal(next.prior_homework.assigned_date, '2026-09-15');
    assert.deepEqual(next.prior_homework.items.map((i) => i.title), ['보강 숙제']);
  });

  it('homework given before a timetable change is still checked', () => {
    const { api, classId } = seeded();
    api.saveSessionHomework({ lesson_date: '2026-09-16', class_id: classId, items: [{ title: '수요일 숙제' }] });
    const cls = api.getClass(classId);
    api.updateClass(Object.assign({}, cls, { schedule: [{ day: '화', start: '18:00', end: '20:00' }, { day: '목', start: '18:00', end: '20:00' }] }));
    const next = api.getTodayClassSession('2026-09-17', classId);
    assert.equal(next.prior_homework.assigned_date, '2026-09-16');
  });

  it('auto grades follow when the checked homework items change; hand-picked grades stay', () => {
    const { api, demo, classId } = seeded();
    const [hong, kim] = demo.students;
    recordToday(api, '2026-09-16', classId, (d) => ({
      prior: {
        assigned_date: d.prior_homework.assigned_date,
        checks: d.students.flatMap((s) => [
          { index: 0, student_id: s.student_id, status: '완료' },
          { index: 1, student_id: s.student_id, status: '미완료' }
        ])
      },
      students: d.students.map((s) => ({
        student_id: s.student_id, attendance: '출석', assignment_completion: s.student_id === kim.student_id ? 'B' : ''
      }))
    }));
    const grade = (sid) => api.getLessons('2026-09-16', classId).find((l) => l.student_id === sid).assignment_completion;
    assert.equal(grade(hong.student_id), 'C');
    assert.equal(grade(kim.student_id), 'B');
    const first = api.getSessionHomework('2026-09-14', classId).items[0];
    api.saveSessionHomework({ lesson_date: '2026-09-14', class_id: classId, items: [{ item_id: first.item_id, title: first.title }] });
    assert.equal(grade(hong.student_id), 'A', 'only the done item is left');
    assert.equal(grade(kim.student_id), 'B', 'teacher’s own grade kept');
  });
});

describe('assignments follow student and class status', () => {
  it('withdrawing ends the assignment and keeps the student on past rosters', () => {
    const { api, demo, classId } = seeded();
    const [hong] = demo.students;
    api.saveSessionHomework({ lesson_date: '2026-09-14', class_id: classId, items: [{ title: 'a' }] });
    api.archiveStudent(hong.student_id);
    const history = api.getStudent(hong.student_id).class_history;
    assert.deepEqual(history.map((h) => [h.status, h.end_date]), [['종료', '2026-09-15']]);
    assert.ok(api.getClassRoster(classId, '2026-09-14').some((s) => s.student_id === hong.student_id));
    assert.ok(!api.getClassRoster(classId, '2026-09-16').some((s) => s.student_id === hong.student_id));
    assert.equal(api.getClassHomeworkLog(classId, { start: '2026-09-01', end: '2026-09-16' }).students.length, 3);
  });

  it('withdrawing a student in two classes ends both assignments', () => {
    const { api, demo } = seeded();
    const other = api.createClass({ school_year: '2026', semester: '2', grade: '중2', class_name: 'B반', weekday: '화', start_time: '18:00', end_time: '20:00', status: '운영' });
    const [hong] = demo.students;
    api.assignStudentToClass({ student_id: hong.student_id, class_id: other.class_id, start_date: '2026-09-01' });
    api.archiveStudent(hong.student_id);
    const history = api.getStudent(hong.student_id).class_history;
    assert.deepEqual(history.map((h) => [h.status, h.end_date]).sort(), [['종료', '2026-09-15'], ['종료', '2026-09-15']]);
  });

  it('closing a class ends its open assignments', () => {
    const { api, demo, classId } = seeded();
    api.closeClass(classId);
    const history = api.getStudent(demo.students[0].student_id).class_history;
    assert.deepEqual(history.map((h) => h.status), ['종료']);
    assert.equal(history[0].end_date, '2026-09-15');
  });

  it('moving class during an exam placement moves the placement’s source class too', () => {
    const { api, demo, classId } = seeded();
    const other = api.createClass({ school_year: '2026', semester: '2', grade: '중2', class_name: 'B반', weekday: '월/수', start_time: '18:00', end_time: '20:00', status: '운영' });
    const period = api.saveExamPeriod({ title: '중간', start_date: '2026-10-01', end_date: '2026-10-20' });
    const [hong] = demo.students;
    api.applyExamGroups(period.exam_period_id, {
      groups: [{ class_name: '대비반', schedule: [{ day: '월', start: '18:00', end: '20:00' }], students: [{ student_id: hong.student_id }] }],
      suspended_class_ids: []
    });
    api.moveStudent({ student_id: hong.student_id, class_id: other.class_id, start_date: '2026-10-07' });
    const ids = (cid, d) => api.getClassRoster(cid, d).map((s) => s.student_id);
    assert.ok(!ids(classId, '2026-10-05').includes(hong.student_id), 'away from the old class before the move');
    assert.ok(!ids(other.class_id, '2026-10-12').includes(hong.student_id), 'away from the new class after the move');
    assert.ok(ids(other.class_id, '2026-10-26').includes(hong.student_id), 'back in the new class after the period');
  });
});

describe('schema migration v4', () => {
  function driftedStore() {
    const { store, api, demo, classId } = seeded();
    api.saveSessionHomework({ lesson_date: '2026-09-14', class_id: classId, items: [{ title: '반 숙제' }] });
    const lessons = store.readTable('Lessons');
    lessons[0].progress = '어긋난 진도';
    lessons[1].homework = '어긋난 숙제';
    store.writeTable('Lessons', lessons);
    const students = store.readTable('Students');
    students[0].status = '퇴원';
    store.writeTable('Students', students);
    const meta = store.readTable('_Meta');
    meta.find((m) => m.prefix === LMS.SCHEMA_META_KEY).next_seq = 3;
    store.writeTable('_Meta', meta);
    return { store, demo, classId };
  }

  it('re-aligns drifted lessons and closes leftover assignments, once', () => {
    const { store, demo, classId } = driftedStore();
    const api = LMS.createService(store);
    assert.equal(api.ensureSchema(), true);
    assert.equal(new Set(field(api, '2026-09-14', classId, 'progress')).size, 1);
    assert.deepEqual(field(api, '2026-09-14', classId, 'homework'), ['반 숙제', '반 숙제', '반 숙제']);
    const rel = store.readTable('StudentClasses').find((r) => r.student_id === demo.students[0].student_id);
    assert.equal(rel.status, '종료');
    assert.equal(rel.end_date, '2026-09-14', 'ends on the last lesson');
    assert.equal(LMS.createService(store).ensureSchema(), false);
  });
});
