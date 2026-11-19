'use strict';

/**
 * ~40 Korean teacher utterances → expected name resolve + tools (Phase A3 / B gate).
 * CI runs resolve + tool-surface / preview checks; no live model.
 *
 * expect.resolve: unique | ambiguous | none
 * expect.student: roster key when unique
 * expect.clarify: true when the assistant must ask which student
 * expect.tools: tool names the turn should use after resolve (empty when clarify)
 * expect.args: key args for the primary write (merged with resolved ids in the test)
 * query / class_name: what the resolve helper is given (extracted name / half context)
 */
module.exports = [
  // --- 성 생략 ---
  { id: 'omit-gil', utterance: '길동 오늘 결석 처리해줘', query: '길동', expect: { resolve: 'unique', student: 'hong', tools: ['update_attendance'], args: { attendance: '결석' } } },
  { id: 'omit-chul', utterance: '철수 점수 알려줘', query: '철수', expect: { resolve: 'unique', student: 'kim', tools: ['get_scores'] } },
  { id: 'omit-young', utterance: '영희 숙제 어때?', query: '영희', expect: { resolve: 'unique', student: 'lee', tools: ['get_homework_status'] } },
  { id: 'omit-jieun', utterance: '지은이 출결 확인해', query: '지은', expect: { resolve: 'unique', student: 'jieun', tools: ['get_attendance'] } },
  { id: 'omit-haneul', utterance: '하늘 오늘 수업 기록 남겨', query: '하늘', expect: { resolve: 'unique', student: 'noLesson', tools: ['save_lesson'], args: { attendance: '출석' } } },

  // --- 풀네임 ---
  { id: 'full-hong', utterance: '홍길동 오늘 결석이야', query: '홍길동', expect: { resolve: 'unique', student: 'hong', tools: ['update_attendance'], args: { attendance: '결석' } } },
  { id: 'full-kim', utterance: '김철수 상담 기록 남겨줘', query: '김철수', expect: { resolve: 'unique', student: 'kim', tools: ['create_counseling'], args: { kind: '학생', content: '상담' } } },
  { id: 'full-lee', utterance: '이영희 프로필 보여줘', query: '이영희', expect: { resolve: 'unique', student: 'lee', tools: ['get_student_profile'] } },
  { id: 'full-jieun', utterance: '최지은 최근 수업 기록', query: '최지은', expect: { resolve: 'unique', student: 'jieun', tools: ['get_student_lessons'] } },
  { id: 'full-kang', utterance: '강하늘 찾아줘', query: '강하늘', expect: { resolve: 'unique', student: 'noLesson', tools: ['search_students'] } },

  // --- 동명이인 → 되묻기 ---
  { id: 'homo-minsu', utterance: '민수 오늘 결석', query: '민수', expect: { resolve: 'ambiguous', clarify: true, tools: [] } },
  { id: 'homo-minsu-score', utterance: '민수 테스트 85점', query: '민수', expect: { resolve: 'ambiguous', clarify: true, tools: [] } },
  { id: 'homo-minsu-ask', utterance: '민수 어디 반이야?', query: '민수', expect: { resolve: 'ambiguous', clarify: true, tools: [] } },
  { id: 'homo-minsu-note', utterance: '민수 특이사항 집중 안 함', query: '민수', expect: { resolve: 'ambiguous', clarify: true, tools: [] } },

  // --- 반 맥락으로 동명이인 해소 ---
  { id: 'class-minsu-a', utterance: 'A반 민수 오늘 결석', query: '민수', class_name: 'A반', expect: { resolve: 'unique', student: 'minsuA', tools: ['update_attendance'], args: { attendance: '결석' } } },
  { id: 'class-minsu-b', utterance: 'B반 민수 출석으로 바꿔', query: '민수', class_name: 'B반', expect: { resolve: 'unique', student: 'minsuB', tools: ['update_attendance'], args: { attendance: '출석' } } },
  { id: 'class-minsu-a-full', utterance: '중2 A반 김민수 점수 보여줘', query: '김민수', class_name: '중2 A반', expect: { resolve: 'unique', student: 'minsuA', tools: ['get_scores'] } },

  // --- 별명(alias) ---
  { id: 'alias-gildong', utterance: '길동이 오늘 결석', query: '길동이', expect: { resolve: 'unique', student: 'hong', tools: ['update_attendance'], args: { attendance: '결석' } } },
  { id: 'alias-ddung', utterance: '뚱이 숙제 상태', query: '뚱이', expect: { resolve: 'unique', student: 'kim', tools: ['get_homework_status'] } },
  { id: 'alias-haneul', utterance: '하늘이 수업 기록 추가해', query: '하늘이', expect: { resolve: 'unique', student: 'noLesson', tools: ['save_lesson'], args: { attendance: '출석' } } },

  // --- 없음 → 되묻기 ---
  { id: 'none-unknown', utterance: '서연이 오늘 결석', query: '서연', expect: { resolve: 'none', clarify: true, tools: [] } },
  { id: 'none-typo', utterance: '홍기동 찾아봐', query: '홍기동', expect: { resolve: 'none', clarify: true, tools: [] } },
  { id: 'none-empty-ish', utterance: '그 학생 결석 처리', query: '', expect: { resolve: 'none', clarify: true, tools: [] } },

  // --- A1: update_lesson (기존 기록) ---
  { id: 'a1-update-score-hong', utterance: '길동 오늘 테스트 16점', query: '길동', expect: { resolve: 'unique', student: 'hong', tools: ['update_lesson'], args: { test_status: '실시', test_score: 16 } } },
  { id: 'a1-update-note-kim', utterance: '철수 특이사항 졸음', query: '철수', expect: { resolve: 'unique', student: 'kim', tools: ['update_lesson'], args: { special_note: '졸음' } } },
  { id: 'a1-update-conc-lee', utterance: '영희 집중도 B로', query: '영희', expect: { resolve: 'unique', student: 'lee', tools: ['update_lesson'], args: { concentration: 'B' } } },
  { id: 'a1-update-assign', utterance: '김민수 과제 C', query: '김민수', class_name: 'A반', expect: { resolve: 'unique', student: 'minsuA', tools: ['update_lesson'], args: { assignment_completion: 'C' } } },

  // --- A1: save_lesson (기록 없음) ---
  { id: 'a1-save-haneul', utterance: '강하늘 오늘 출석, 테스트 미실시', query: '강하늘', expect: { resolve: 'unique', student: 'noLesson', tools: ['save_lesson'], args: { attendance: '출석', test_status: '미실시' } } },
  { id: 'a1-save-haneul-score', utterance: '하늘 오늘 테스트 12점 만점 20', query: '하늘', expect: { resolve: 'unique', student: 'noLesson', tools: ['save_lesson'], args: { test_status: '실시', test_score: 12, test_max_score: 20 } } },
  { id: 'a1-save-absent', utterance: '강하늘 오늘 결석', query: '강하늘', expect: { resolve: 'unique', student: 'noLesson', tools: ['save_lesson'], args: { attendance: '결석' } } },
  { id: 'a1-save-alias', utterance: '하늘이 오늘 출석 집중 A', query: '하늘이', expect: { resolve: 'unique', student: 'noLesson', tools: ['save_lesson'], args: { attendance: '출석', concentration: 'A' } } },

  // --- A1: save_class_session (반 진도) ---
  { id: 'a1-session-a', utterance: 'A반 오늘 진도 이차함수', class_only: true, class_name: 'A반', expect: { resolve: 'none', tools: ['save_class_session'], args: { progress: '이차함수' } } },
  { id: 'a1-session-b', utterance: '중2 B반 진도 이차함수 그래프, 공지 워크북 지참', class_only: true, class_name: '중2 B반', expect: { resolve: 'none', tools: ['save_class_session'], args: { progress: '이차함수 그래프', class_notice: '워크북 지참' } } },
  { id: 'a1-session-content', utterance: 'A반 수업 내용 이차함수 도입 설명', class_only: true, class_name: 'A반', expect: { resolve: 'none', tools: ['save_class_session'], args: { content: '이차함수 도입 설명' } } },

  // --- A1 조합: 학생 점수 + 반 진도 ---
  { id: 'a1-combo-score-progress', utterance: '길동 테스트 16점, A반 진도 이차함수 심화', query: '길동', class_name: 'A반', expect: { resolve: 'unique', student: 'hong', tools: ['update_lesson', 'save_class_session'], args: { test_status: '실시', test_score: 16 }, session_args: { progress: '이차함수 심화' } } },
  { id: 'a1-combo-new-lesson', utterance: '하늘 오늘 출석 테스트 10점 만점 20, A반 진도는 이차함수 심화', query: '하늘', class_name: 'A반', expect: { resolve: 'unique', student: 'noLesson', tools: ['save_lesson', 'save_class_session'], args: { attendance: '출석', test_status: '실시', test_score: 10, test_max_score: 20 }, session_args: { progress: '이차함수 심화' } } },

  // --- 출결 / 할 일 ---
  { id: 'att-hong', utterance: '홍길동 출석으로 바꿔', query: '홍길동', expect: { resolve: 'unique', student: 'hong', tools: ['update_attendance'], args: { attendance: '출석' } } },
  { id: 'att-jieun', utterance: '지은 결석 처리', query: '지은', expect: { resolve: 'unique', student: 'jieun', tools: ['update_attendance'], args: { attendance: '결석' } } },
  { id: 'task-done', utterance: '할 일 완료 처리해줘', query: '', expect: { resolve: 'none', tools: ['update_task_status'], args: { status: '완료' } } },

  // --- 학교·반 힌트 ---
  { id: 'school-hint-dalbit', utterance: '달빛중 민수 결석', query: '민수', school_hint: '달빛중', expect: { resolve: 'unique', student: 'minsuB', tools: ['update_attendance'], args: { attendance: '결석' } } },
  { id: 'list-class-a', utterance: 'A반 명단 보여줘', class_only: true, class_name: 'A반', expect: { resolve: 'none', tools: ['get_class_members'] } }
];
