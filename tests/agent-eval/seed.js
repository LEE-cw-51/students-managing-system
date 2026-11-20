'use strict';

/**
 * Fixture roster for agent-eval: two classes, homonyms, and aliases the resolve helper knows.
 * Demo seed (홍/김/이) is too thin for 성 생략·동명이인·반 맥락 케이스를 고정하기에 여기서 따로 만든다.
 */
const { createMemoryStore } = require('../memory-store.js');
const LMS = require('../../src/01_Service.js');

function seedEval() {
  const store = createMemoryStore({ today: '2026-09-14', now: '2026-09-14T18:30:00' });
  const api = LMS.createService(store);

  const classA = api.createClass({
    school_year: '2026', semester: '2', grade: '중2', class_name: '중2 A반',
    teacher: '이찬우', weekday: '월/수', start_time: '18:00', end_time: '20:00', status: '운영'
  });
  const classB = api.createClass({
    school_year: '2026', semester: '2', grade: '중2', class_name: '중2 B반',
    teacher: '박선생', weekday: '화/목', start_time: '19:00', end_time: '21:00', status: '운영'
  });

  const add = (row, classId) => api.createStudent({
    grade: '중2',
    enrollment_date: '2026-03-01',
    status: '재원',
    class_id: classId,
    ...row
  });

  const hong = add({ name: '홍길동', school: '한빛중', parent_phone: '010-1111-2222' }, classA.class_id);
  const kim = add({ name: '김철수', school: '한빛중', parent_phone: '010-3333-4444' }, classA.class_id);
  const lee = add({ name: '이영희', school: '달빛중', parent_phone: '010-5555-6666' }, classA.class_id);
  const minsuA = add({ name: '김민수', school: '한빛중', parent_phone: '010-7000-0001' }, classA.class_id);
  const minsuB = add({ name: '박민수', school: '달빛중', parent_phone: '010-7000-0002' }, classB.class_id);
  const jieun = add({ name: '최지은', school: '한빛중', parent_phone: '010-8000-0001' }, classB.class_id);
  // No lesson yet on eval today — save_lesson cases.
  const noLesson = add({ name: '강하늘', school: '별빛중', parent_phone: '010-9000-0001' }, classA.class_id);

  const common = {
    lesson_date: '2026-09-14',
    attendance: '출석',
    test_difficulty: '중',
    assignment_completion: 'A',
    concentration: 'A',
    progress: '이차함수 도입',
    homework: '워크북 12쪽'
  };
  api.saveLessonsBatch([
    Object.assign({}, common, {
      class_id: classA.class_id, student_id: hong.student_id,
      test_status: '실시', test_score: 18, test_max_score: 20, special_note: '계산 실수'
    }),
    Object.assign({}, common, {
      class_id: classA.class_id, student_id: kim.student_id, test_status: '미실시', assignment_completion: 'B'
    }),
    Object.assign({}, common, {
      class_id: classA.class_id, student_id: lee.student_id,
      test_status: '실시', test_score: 20, test_max_score: 20
    }),
    Object.assign({}, common, {
      class_id: classA.class_id, student_id: minsuA.student_id, test_status: '미실시'
    }),
    Object.assign({}, common, {
      class_id: classB.class_id, student_id: minsuB.student_id, test_status: '미실시', progress: '이차함수 그래프'
    }),
    Object.assign({}, common, {
      class_id: classB.class_id, student_id: jieun.student_id, test_status: '미실시'
    })
  ]);

  const students = {
    hong, kim, lee, minsuA, minsuB, jieun, noLesson
  };
  /** Spoken nicknames → roster key (search_students alone cannot see these). */
  const aliases = {
    길동이: 'hong',
    뚱이: 'kim',
    영희언니: 'lee',
    하늘이: 'noLesson'
  };

  return {
    store,
    api,
    today: '2026-09-14',
    classes: { A: classA, B: classB },
    students,
    aliases,
    lessonOf(studentKey) {
      const s = students[studentKey];
      return api.getStudentLessons(s.student_id, '2026-09-14', '2026-09-14')[0] || null;
    }
  };
}

module.exports = { seedEval };
