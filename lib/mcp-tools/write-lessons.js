// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, STUDENT_ID, CLASS_ID, DATE } from './shared.js';

const LESSON_FIELDS = {
  attendance: { type: 'string', enum: LMS.ATTENDANCE, description: '출석 또는 결석 (기본 출석)' },
  test_status: { type: 'string', enum: LMS.TEST_STATUS, description: '테스트 실시 여부 (기본 미실시)' },
  test_score: { type: 'number', description: '테스트 점수 (실시일 때)' },
  test_max_score: { type: 'number', description: '테스트 만점 (비우면 그날 반 기록의 만점)' },
  test_difficulty: { type: 'string', enum: LMS.DIFFICULTY, description: '테스트 난이도' },
  assignment_completion: { type: 'string', enum: LMS.ASSIGNMENT, description: '과제 이행 등급 A–F' },
  concentration: { type: 'string', enum: LMS.CONCENTRATION, description: '수업 집중도 A–D, 결석이면 ABSENT' },
  special_note: { type: 'string', description: '특이사항' },
  student_notice: { type: 'string', description: '학생·학부모 전달사항' }
};

const SESSION_FIELDS = {
  progress: { type: 'string', description: '진도' },
  content: { type: 'string', description: '수업 내용' },
  test_title: { type: 'string', description: '테스트 제목' },
  test_max_score: { type: 'number', description: '테스트 만점' },
  test_difficulty: { type: 'string', enum: LMS.DIFFICULTY, description: '테스트 난이도' },
  test_scope: { type: 'string', description: '시험 범위' },
  class_notice: { type: 'string', description: '반 공지' },
  memo: { type: 'string', description: '메모' }
};

export const WRITE_LESSON_TOOLS = [
  {
    name: 'save_lesson',
    progress: '수업 기록 추가 준비 중',
    description: '학생 한 명의 하루 수업 기록을 새로 만듭니다. 이미 그날 기록이 있으면 update_lesson을 씁니다(get_student_lessons로 lesson_id 확인). 진도·숙제처럼 반 전체 값은 save_class_session을 씁니다.',
    parameters: {
      type: 'object',
      properties: { student_id: STUDENT_ID, class_id: CLASS_ID, lesson_date: DATE('수업일'), ...LESSON_FIELDS },
      required: ['student_id', 'class_id', 'lesson_date']
    },
    destructive: false
  },
  {
    name: 'update_lesson',
    progress: '수업 기록 수정 준비 중',
    description: '이미 있는 수업 기록을 고칩니다. 바꿀 항목만 넣습니다. lesson_id는 get_student_lessons 또는 get_attendance에서 찾습니다. progress·homework를 바꾸면 그날 반 기록이 바뀌어 같은 반 학생 모두에게 반영됩니다.',
    parameters: {
      type: 'object',
      properties: {
        lesson_id: { type: 'string', description: '수업 기록 ID (예: LES-0012)' },
        ...LESSON_FIELDS,
        progress: { type: 'string', description: '진도 (반 기록)' },
        homework: { type: 'string', description: '숙제 (반 기록)' }
      },
      required: ['lesson_id']
    }
  },
  {
    name: 'save_lessons_batch',
    progress: '수업 기록 저장 준비 중',
    description: '한 반의 하루 수업 기록을 여러 학생 한꺼번에 저장합니다. 이미 기록이 있는 학생은 덮어쓰고, 넣지 않은 항목은 비워집니다. 학생 명단은 get_class_members로 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        class_id: CLASS_ID,
        lesson_date: DATE('수업일'),
        items: {
          type: 'array',
          maxItems: LMS.AGENT_BATCH_MAX,
          description: `학생별 기록 (최대 ${LMS.AGENT_BATCH_MAX}명)`,
          items: { type: 'object', properties: { student_id: STUDENT_ID, ...LESSON_FIELDS }, required: ['student_id'] }
        },
        class_notice: { type: 'string', description: '반 공지 (선택)' }
      },
      required: ['class_id', 'lesson_date', 'items']
    }
  },
  {
    name: 'save_class_session',
    progress: '반 수업 기록 준비 중',
    description: '반의 하루 기록(진도·수업 내용·테스트 정보·시험 범위·공지·메모)을 저장합니다. 바꿀 항목만 넣습니다. 그날 학생 기록에도 진도와 테스트 정보가 함께 반영됩니다. class_id는 list_classes로 찾습니다.',
    parameters: {
      type: 'object',
      properties: { class_id: CLASS_ID, lesson_date: DATE('수업일'), ...SESSION_FIELDS },
      required: ['class_id', 'lesson_date']
    }
  },
  {
    name: 'save_class_session_notice',
    progress: '반 공지 준비 중',
    description: '반의 하루 공지를 바꿉니다. 빈 문자열이면 공지를 지웁니다. class_id는 list_classes로 찾습니다.',
    parameters: {
      type: 'object',
      properties: { class_id: CLASS_ID, lesson_date: DATE('수업일'), text: { type: 'string', description: '공지 내용 (빈 값이면 삭제)' } },
      required: ['class_id', 'lesson_date', 'text']
    }
  }
];
