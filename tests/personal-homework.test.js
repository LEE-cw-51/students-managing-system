'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

const TODAY = '2026-09-15';

function setup() {
  const api = LMS.createService(createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' }));
  api.ensureSchema();
  const cls = api.createClass({
    class_name: '화목반',
    weekday: '화/목',
    schedule: [
      { day: '화', start: '19:00', end: '21:00' },
      { day: '목', start: '19:00', end: '21:00' }
    ]
  });
  const a = api.createStudent({ name: '김개인', class_id: cls.class_id, enrollment_date: '2026-09-01' });
  const b = api.createStudent({ name: '이공통', class_id: cls.class_id, enrollment_date: '2026-09-01' });
  return { api, cls, a, b };
}

describe('per-student homework items', () => {
  it('keeps personal items when class homework is rewritten', () => {
    const t = setup();
    const date = '2026-09-11'; // 목
    t.api.saveSessionHomework({
      lesson_date: date,
      class_id: t.cls.class_id,
      titles: ['공통1', '공통2']
    });
    t.api.saveStudentHomeworkItems({
      lesson_date: date,
      class_id: t.cls.class_id,
      student_id: t.a.student_id,
      items: [{ title: '개인보충' }]
    });
    t.api.saveLessonsBatch([
      { lesson_date: date, class_id: t.cls.class_id, student_id: t.a.student_id, attendance: '출석' },
      { lesson_date: date, class_id: t.cls.class_id, student_id: t.b.student_id, attendance: '출석' }
    ]);
    t.api.saveSessionHomework({
      lesson_date: date,
      class_id: t.cls.class_id,
      titles: ['공통A']
    });
    const session = t.api.getSessionHomework(date, t.cls.class_id);
    assert.deepEqual(session.class_items.map((it) => it.title), ['공통A']);
    const personal = session.items.filter((it) => it.student_id === t.a.student_id);
    assert.equal(personal.length, 1);
    assert.equal(personal[0].title, '개인보충');
    const lessonA = t.api.getLessons(date, t.cls.class_id).find((l) => l.student_id === t.a.student_id);
    const lessonB = t.api.getLessons(date, t.cls.class_id).find((l) => l.student_id === t.b.student_id);
    assert.equal(lessonA.homework, '공통A\n개인보충');
    assert.equal(lessonB.homework, '공통A');
  });

  it('grades and checks only effective items for each student', () => {
    const t = setup();
    const assigned = '2026-09-11';
    const checkDate = '2026-09-15';
    t.api.saveSessionHomework({
      lesson_date: assigned,
      class_id: t.cls.class_id,
      titles: ['공통1']
    });
    t.api.saveStudentHomeworkItems({
      lesson_date: assigned,
      class_id: t.cls.class_id,
      student_id: t.a.student_id,
      items: [{ title: '개인1' }]
    });
    t.api.saveLessonsBatch([
      { lesson_date: assigned, class_id: t.cls.class_id, student_id: t.a.student_id, attendance: '출석' },
      { lesson_date: assigned, class_id: t.cls.class_id, student_id: t.b.student_id, attendance: '출석' }
    ]);
    const session = t.api.getSessionHomework(assigned, t.cls.class_id);
    const classItem = session.class_items[0];
    const personal = session.items.find((it) => it.student_id === t.a.student_id);
    const checked = t.api.saveHomeworkChecks({
      lesson_date: assigned,
      class_id: t.cls.class_id,
      check_date: checkDate,
      checks: [
        { student_id: t.a.student_id, item_id: classItem.item_id, status: 'A' },
        { student_id: t.a.student_id, item_id: personal.item_id, status: 'F' },
        { student_id: t.b.student_id, item_id: classItem.item_id, status: 'A' }
      ]
    });
    const gradeA = checked.grades.find((g) => g.student_id === t.a.student_id);
    const gradeB = checked.grades.find((g) => g.student_id === t.b.student_id);
    assert.equal(gradeA.total, 2);
    assert.equal(gradeA.done, 1);
    assert.equal(gradeA.assignment_completion, 'C');
    assert.equal(gradeB.total, 1);
    assert.equal(gradeB.done, 1);
    assert.equal(gradeB.assignment_completion, 'A');

    assert.throws(
      () => t.api.saveHomeworkChecks({
        lesson_date: assigned,
        class_id: t.cls.class_id,
        check_date: checkDate,
        checks: [{ student_id: t.b.student_id, item_id: personal.item_id, status: 'A' }]
      }),
      /다른 학생의 개인 숙제/
    );
  });

  it('prior payload keeps personal items separate from class items (no double count)', () => {
    const t = setup();
    const assigned = '2026-09-11';
    const checkDate = '2026-09-15';
    t.api.saveTodaySession({
      lesson_date: assigned,
      class_id: t.cls.class_id,
      session: { progress: '진도', class_notice: '' },
      homework_items: [{ title: '공통1' }, { title: '공통2' }],
      students: [
        {
          student_id: t.a.student_id,
          attendance: '출석',
          personal_homework: [{ title: '개인보충' }],
          homework_replace_class: ''
        },
        {
          student_id: t.b.student_id,
          attendance: '출석',
          personal_homework: []
        }
      ]
    });
    const today = t.api.getTodayClassSession(checkDate, t.cls.class_id);
    const prior = today.prior_homework;
    assert.deepEqual(prior.items.map((it) => it.title), ['공통1', '공통2']);
    const personalA = prior.personal_items_by_student[t.a.student_id];
    assert.deepEqual(personalA.map((it) => it.title), ['개인보충']);
    assert.ok(personalA.every((it) => it.scope === 'student'));
    const checkIdsA = Object.keys(prior.checks_by_student[t.a.student_id]);
    assert.equal(checkIdsA.length, 3);
    assert.equal(new Set(checkIdsA).size, 3);
    const classIds = new Set(prior.items.map((it) => it.item_id));
    const personalIds = new Set(personalA.map((it) => it.item_id));
    checkIdsA.forEach((id) => {
      assert.ok(classIds.has(id) || personalIds.has(id));
    });
    assert.equal(Object.keys(prior.checks_by_student[t.b.student_id]).length, 2);
    assert.deepEqual(prior.personal_items_by_student[t.b.student_id], []);
  });

  it('replace mode drops class items for that student only', () => {
    const t = setup();
    const assigned = '2026-09-11';
    const checkDate = '2026-09-15';
    t.api.saveTodaySession({
      lesson_date: assigned,
      class_id: t.cls.class_id,
      session: { progress: '진도', class_notice: '' },
      homework_items: [{ title: '공통1' }, { title: '공통2' }],
      students: [
        {
          student_id: t.a.student_id,
          attendance: '출석',
          homework_replace_class: 'Y',
          personal_homework: [{ title: '대체숙제' }],
          student_notice: '개인만 다른 숙제'
        },
        {
          student_id: t.b.student_id,
          attendance: '출석',
          personal_homework: [],
          student_notice: ''
        }
      ]
    });
    const lessons = t.api.getLessons(assigned, t.cls.class_id);
    const lessonA = lessons.find((l) => l.student_id === t.a.student_id);
    const lessonB = lessons.find((l) => l.student_id === t.b.student_id);
    assert.equal(lessonA.homework_replace_class, 'Y');
    assert.equal(lessonA.homework, '대체숙제');
    assert.equal(lessonA.student_notice, '개인만 다른 숙제');
    assert.equal(lessonB.homework, '공통1\n공통2');

    const today = t.api.getTodayClassSession(checkDate, t.cls.class_id);
    const priorA = today.prior_homework.personal_items_by_student[t.a.student_id];
    assert.equal(today.prior_homework.replace_by_student[t.a.student_id], 'Y');
    assert.equal(priorA.length, 1);
    assert.equal(priorA[0].title, '대체숙제');
    assert.deepEqual(
      Object.keys(today.prior_homework.checks_by_student[t.a.student_id]),
      priorA.map((it) => it.item_id)
    );
    assert.equal(
      Object.keys(today.prior_homework.checks_by_student[t.b.student_id]).length,
      2
    );

    const report = t.api.generateDailyReport(lessonA.lesson_id).text;
    assert.match(report, /4\. 과제 안내:\n- 대체숙제/);
    assert.match(report, /개별 공지: 개인만 다른 숙제/);
    assert.doesNotMatch(report, /공통1/);
  });
});

describe('daily report individual notice', () => {
  it('lists class notice, student notice, then feedback', () => {
    const t = setup();
    const date = '2026-09-15';
    t.api.saveTodaySession({
      lesson_date: date,
      class_id: t.cls.class_id,
      session: { progress: '이차방정식', class_notice: '다음 주 휴강' },
      homework_items: [{ title: '문제집 10쪽' }],
      students: [{
        student_id: t.a.student_id,
        attendance: '출석',
        student_notice: '계산기 가져오기',
        special_note: '질문을 잘함',
        personal_homework: []
      }, {
        student_id: t.b.student_id,
        attendance: '출석',
        personal_homework: []
      }]
    });
    const lesson = t.api.getLessons(date, t.cls.class_id).find((l) => l.student_id === t.a.student_id);
    const text = t.api.generateDailyReport(lesson.lesson_id).text;
    assert.match(text, /5\. 공지사항: 다음 주 휴강/);
    assert.match(text, /6\. 개별 공지: 계산기 가져오기/);
    assert.match(text, /7\. 학생 피드백: 질문을 잘함/);
  });
});

describe('schema v5', () => {
  it('is idempotent and fills new fields', () => {
    const store = createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' });
    const api = LMS.createService(store);
    assert.equal(api.ensureSchema(), true);
    assert.equal(api.ensureSchema(), false);
    const Core = require('../src/00_Core.js');
    assert.equal(Core.SCHEMA_VERSION, 7);
  });
});
