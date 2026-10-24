'use strict';

// Richer demo data for local screens (LMS_STORE=file). Not used in production.

const LMS = require('../src/01_Service.js');

function rng(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function seedRich(api, today) {
  const rand = rng(42);
  const classes = [
    api.createClass({
      school_year: '2026', semester: '2', grade: '중2', class_name: '중2 A반', teacher: '이찬우',
      textbook: '개념원리 중2-2',
      schedule: [{ day: '월', start: '18:00', end: '20:00' }, { day: '수', start: '18:00', end: '20:00' }]
    }),
    api.createClass({
      school_year: '2026', semester: '2', grade: '중2', class_name: '중2 B반', teacher: '이찬우',
      textbook: '쎈 중2-2',
      schedule: [
        { day: '화', start: '19:00', end: '21:00' },
        { day: '목', start: '19:00', end: '21:00' },
        { day: '토', start: '14:00', end: '16:00' }
      ]
    }),
    api.createClass({
      school_year: '2026', semester: '2', grade: '중3', class_name: '중3 심화반', teacher: '이찬우',
      textbook: '블랙라벨 중3',
      schedule: [
        { day: '월', start: '20:00', end: '22:00' },
        { day: '수', start: '20:00', end: '22:00' },
        { day: '금', start: '19:00', end: '21:30' }
      ]
    })
  ];

  const people = [
    ['김민준', '중2', '한빛중학교', 0], ['이서연', '중2', '한빛중', 0], ['박지호', '중2', '푸른중학교', 0],
    ['최하은', '중2', '푸른중학교', 0], ['정도윤', '중2', '한빛중학교', 1], ['강서윤', '중2', '푸른중학교', 1],
    ['조예준', '중2', '새솔중학교', 1], ['윤지우', '중2', '', 1],
    ['장시우', '중3', '한빛중학교', 2], ['임하린', '중3', '새솔중학교', 2], ['한주원', '중3', '새솔중학교', 2],
    ['오수아', '중3', '한빛중학교', 2]
  ];
  const students = people.map(([name, grade, school, ci], i) => api.createStudent({
    name, grade, school,
    student_phone: '010-2' + String(100 + i).padStart(3, '0') + '-' + String(1000 + i * 37).slice(-4),
    parent_phone: '010-9' + String(200 + i).padStart(3, '0') + '-' + String(2000 + i * 53).slice(-4),
    enrollment_date: '2026-03-02',
    status: '재원',
    class_id: classes[ci].class_id
  }));

  const progressSteps = [
    '1. 삼각형의 성질', '2. 이등변삼각형', '3. 직각삼각형의 합동', '4. 외심과 내심',
    '5. 평행사변형', '6. 여러 가지 사각형', '7. 닮음의 뜻', '8. 삼각형의 닮음 조건',
    '9. 평행선과 선분의 비', '10. 삼각형의 무게중심', '11. 피타고라스 정리', '12. 경우의 수'
  ];
  const start = LMS.addDays(today, -35);
  const end = LMS.addDays(today, -1);

  classes.forEach((cls, ci) => {
    const roster = students.filter((_, i) => people[i][3] === ci);
    const dates = LMS.classMeetingDatesFor(cls, start, end, []);
    dates.forEach((date, di) => {
      const testDay = di % 2 === 1;
      api.saveClassSession({
        lesson_date: date,
        class_id: cls.class_id,
        progress: progressSteps[Math.min(di, progressSteps.length - 1)],
        content: '개념 설명 후 유형 문제 풀이',
        test_title: testDay ? '단원 확인 테스트 ' + Math.ceil(di / 2) : '',
        test_max_score: testDay ? 20 : '',
        test_difficulty: testDay ? pick(rand, ['상', '중', '하']) : ''
      });
      api.saveLessonsBatch(roster.map((s, si) => {
        const absent = rand() < 0.07 || (si === 1 && ci === 0 && di >= dates.length - 2);
        return {
          lesson_date: date,
          class_id: cls.class_id,
          student_id: s.student_id,
          attendance: absent ? '결석' : '출석',
          test_status: testDay && !absent ? '실시' : '미실시',
          test_score: testDay && !absent ? Math.max(6, Math.round(20 - rand() * 9 - (si === 2 ? 5 : 0))) : '',
          assignment_completion: absent ? '' : (si === 2 && di >= dates.length - 3 ? 'C' : pick(rand, ['A', 'A', 'B', 'C'])),
          concentration: absent ? 'ABSENT' : pick(rand, ['A', 'A', 'B', 'C']),
          special_note: rand() < 0.2 ? pick(rand, ['계산 실수가 잦음', '질문을 많이 함', '오답 정리 꼼꼼함', '지각 후 집중 회복']) : ''
        };
      }));
      api.saveSessionHomework({
        lesson_date: date,
        class_id: cls.class_id,
        items: ['교재 ' + (20 + di * 4) + '~' + (23 + di * 4) + '쪽', '오답 노트 정리']
      });
      if (di > 0) {
        const prev = dates[di - 1];
        api.saveHomeworkChecks({
          lesson_date: prev,
          class_id: cls.class_id,
          check_date: date,
          checks: roster.flatMap((s) => [0, 1].map((index) => ({
            index, student_id: s.student_id, status: rand() < 0.78 ? '완료' : '미완료'
          })))
        });
      }
    });
  });

  [
    ['한빛중학교', '중2', 16, '개념원리 중2-2', '1단원 삼각형의 성질 ~ 2단원 사각형의 성질'],
    ['푸른중학교', '중2', 20, '교과서(천재)', '교과서 p.10~78, 익힘책 전체'],
    ['새솔중학교', '중2', 23, '', '삼각형의 성질 ~ 닮음의 활용'],
    ['한빛중학교', '중3', 12, '블랙라벨 중3', '이차방정식 ~ 이차함수 그래프'],
    ['새솔중학교', '중3', 34, '', '이차함수 ~ 삼각비 1절']
  ].forEach(([school, grade, offset, textbook, scope]) => api.saveSchoolExam({
    school_year: today.slice(0, 4), semester: '2', exam_type: '기말', school, grade,
    exam_date: LMS.addDays(today, offset), textbook, scope
  }));

  api.saveCounselingNote({
    student_id: students[2].student_id, kind: '학부모', counsel_date: LMS.addDays(today, -6),
    title: '숙제 이행 관련 통화', content: '최근 과제 이행률이 낮아 가정에서 확인하시기로 함.'
  });
  api.saveCounselingNote({
    student_id: students[0].student_id, kind: '학생', counsel_date: LMS.addDays(today, -12),
    title: '진로 상담', content: '과학고 진학 희망. 심화 문제 비중을 늘리기로 함.'
  });
  return { classes, students };
}

module.exports = { seedRich };
