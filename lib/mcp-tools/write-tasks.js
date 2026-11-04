// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, STUDENT_ID, CLASS_ID, DATE } from './shared.js';

const TASK_ID = { type: 'string', description: '할 일 ID (예: TSK-0003). get_today_board 또는 get_student_profile에서 찾습니다.' };
const NOTE_ID = { type: 'string', description: '상담일지 ID (예: NTS-0004). get_counseling_notes 또는 get_student_profile에서 찾습니다.' };
const TASK_KIND = { type: 'string', enum: LMS.TASK_KIND, description: '종류: counsel_parent(학부모 상담), counsel_student(학생 상담), homework_check(숙제 확인), admin(행정), other(기타)' };

export const WRITE_TASK_TOOLS = [
  {
    name: 'create_task',
    progress: '할 일 추가 준비 중',
    description: '할 일을 새로 추가합니다. 학생이나 반과 묶을 수 있습니다.',
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        due_date: DATE('예정일'),
        kind: TASK_KIND,
        title: { type: 'string', description: '할 일 제목' },
        memo: { type: 'string', description: '메모 (선택)' },
        student_id: { ...STUDENT_ID, description: '관련 학생 ID (선택). search_students로 찾습니다.' },
        class_id: { ...CLASS_ID, description: '관련 반 ID (선택, list_classes로 찾음)' },
        status: { type: 'string', enum: LMS.TASK_STATUS, description: '상태 (기본 예정)' }
      },
      required: ['due_date', 'kind', 'title']
    }
  },
  {
    name: 'update_task',
    progress: '할 일 수정 준비 중',
    description: '직접 만든 할 일의 날짜·제목·메모·종류·학생·반·상태를 고칩니다. 넣지 않은 항목은 그대로 두고, 빈 문자열은 그 항목을 비웁니다. 상담일지에서 생긴 후속 할 일은 update_counseling으로 고칩니다. 상태만 바꿀 때는 update_task_status를 씁니다.',
    parameters: {
      type: 'object',
      properties: {
        task_id: TASK_ID,
        due_date: DATE('예정일'),
        kind: TASK_KIND,
        title: { type: 'string', description: '할 일 제목' },
        memo: { type: 'string', description: '메모' },
        student_id: { type: 'string', description: '관련 학생 ID (빈 문자열이면 연결 해제)' },
        class_id: { type: 'string', description: '관련 반 ID (빈 문자열이면 연결 해제)' },
        status: { type: 'string', enum: LMS.TASK_STATUS, description: '예정, 완료, 취소' }
      },
      required: ['task_id']
    }
  },
  {
    name: 'delete_task',
    progress: '할 일 삭제 준비 중',
    description: '직접 만든 할 일을 지웁니다. 상담일지의 후속 할 일은 지울 수 없고 상담일지에서 후속 날짜를 비워야 합니다. 지우기 전에 어떤 할 일인지 사용자에게 확인합니다.',
    parameters: { type: 'object', properties: { task_id: TASK_ID }, required: ['task_id'] }
  },
  {
    name: 'update_counseling',
    progress: '상담 기록 수정 준비 중',
    description: '상담 기록을 고칩니다. 넣지 않은 항목은 그대로 둡니다. 후속 날짜를 넣으면 후속 할 일이 생기거나 옮겨지고, 빈 문자열로 비우면 예정인 후속 할 일이 취소됩니다.',
    parameters: {
      type: 'object',
      properties: {
        note_id: NOTE_ID,
        kind: { type: 'string', enum: LMS.COUNSEL_KIND, description: '상담 대상: 학생 또는 학부모' },
        counsel_date: DATE('상담일'),
        title: { type: 'string', description: '짧은 제목' },
        content: { type: 'string', description: '상담 내용 (전체를 새 내용으로 바꿈)' },
        follow_up_date: DATE('후속 조치 날짜 (빈 문자열이면 후속 조치 없음)'),
        follow_up_title: { type: 'string', description: '후속 조치 내용' }
      },
      required: ['note_id']
    }
  },
  {
    name: 'delete_counseling',
    progress: '상담 기록 삭제 준비 중',
    description: '상담 기록을 지웁니다. 예정인 후속 할 일도 취소됩니다. 지우기 전에 어떤 기록인지 사용자에게 확인합니다.',
    parameters: { type: 'object', properties: { note_id: NOTE_ID }, required: ['note_id'] }
  }
];
