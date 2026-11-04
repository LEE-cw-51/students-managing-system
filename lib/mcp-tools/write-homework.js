// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, STUDENT_ID, CLASS_ID, DATE } from './shared.js';

const TITLES = { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: { type: 'string' }, description: '숙제 항목 제목 목록 (순서대로)' };

export const WRITE_HOMEWORK_TOOLS = [
  {
    name: 'save_session_homework',
    progress: '반 숙제 준비 중',
    description: '반이 그날 낸 숙제 목록(체크리스트)을 통째로 바꿉니다. 빠지는 항목의 숙제 체크는 지워지고, 빈 목록이면 그날 반 숙제가 모두 지워집니다. 지금 목록은 get_homework_status로 확인하고, class_id는 list_classes로 찾습니다.',
    parameters: {
      type: 'object',
      properties: { class_id: CLASS_ID, lesson_date: DATE('숙제를 낸 수업일'), titles: TITLES },
      required: ['class_id', 'lesson_date', 'titles']
    }
  },
  {
    name: 'save_homework_checks',
    progress: '숙제 체크 준비 중',
    description: '학생별 숙제 이행 등급(A–F)을 기록합니다. lesson_date는 숙제를 낸 날이고, 항목은 그날 숙제 제목(title)으로 고릅니다(get_homework_status로 확인). status를 비우면 체크를 지웁니다. 확인한 수업일 학생 기록의 과제 등급도 다시 계산됩니다.',
    parameters: {
      type: 'object',
      properties: {
        class_id: CLASS_ID,
        lesson_date: DATE('숙제를 낸 수업일'),
        check_date: DATE('숙제를 확인한 수업일 (선택, 비우면 다음 수업일)'),
        checks: {
          type: 'array',
          maxItems: LMS.AGENT_CHECKS_MAX,
          description: '체크 목록',
          items: {
            type: 'object',
            properties: {
              student_id: STUDENT_ID,
              title: { type: 'string', description: '숙제 항목 제목' },
              status: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', ''], description: '이행 등급 (빈 값이면 체크 삭제)' }
            },
            required: ['student_id', 'title', 'status']
          }
        }
      },
      required: ['class_id', 'lesson_date', 'checks']
    }
  },
  {
    name: 'save_student_homework_items',
    progress: '개인 숙제 준비 중',
    description: '한 학생의 그날 개인 숙제 목록을 통째로 바꿉니다. replace_class가 true면 반 숙제 대신 개인 숙제만 냅니다(그날 수업 기록이 있어야 함). 학생은 search_students, 반은 get_student_profile의 classes로 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        class_id: CLASS_ID,
        student_id: STUDENT_ID,
        lesson_date: DATE('숙제를 낸 수업일'),
        titles: { ...TITLES, description: '개인 숙제 제목 목록 (빈 목록이면 개인 숙제 삭제)' },
        replace_class: { type: 'boolean', description: '반 숙제 대신 개인 숙제만 낼지' }
      },
      required: ['class_id', 'student_id', 'lesson_date']
    }
  }
];
