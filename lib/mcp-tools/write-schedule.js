// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, CLASS_ID, DATE } from './shared.js';

const MAKEUP_ID = { type: 'string', description: '보강 ID (예: MKP-0002). get_calendar 또는 get_day_agenda에서 찾습니다.' };
const TIME = (what) => ({ type: 'string', description: `${what} (HH:MM, 선택)` });

export const WRITE_SCHEDULE_TOOLS = [
  {
    name: 'create_makeup',
    progress: '보강 추가 준비 중',
    description: '보강 일정을 추가합니다. kind가 반이면 class_id, 학생이면 student_ids가 필요합니다. 학생을 여럿 넣으면 학생마다 개인 보강이 하나씩 생깁니다.',
    destructive: false,
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: LMS.MAKEUP_KIND, description: '반(반 전체 보강) 또는 학생(개인 보강)' },
        makeup_date: DATE('보강일'),
        start_time: TIME('시작 시간'),
        end_time: TIME('종료 시간'),
        class_id: { ...CLASS_ID, description: '반 ID (kind가 반이면 필수, list_classes로 찾음)' },
        student_ids: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: { type: 'string' }, description: '학생 ID 목록 (kind가 학생이면 필수, search_students로 찾음)' },
        title: { type: 'string', description: '제목 (선택, 비우면 "반 이름 보강"/"학생 이름 보강")' },
        memo: { type: 'string', description: '메모 (선택)' }
      },
      required: ['kind', 'makeup_date']
    }
  },
  {
    name: 'update_makeup',
    progress: '보강 수정 준비 중',
    description: '보강 일정의 날짜·시간·반·제목·메모·상태를 고칩니다. 넣지 않은 항목은 그대로 둡니다. 보강 대상 학생과 종류는 바꿀 수 없습니다(취소 후 새로 추가).',
    parameters: {
      type: 'object',
      properties: {
        makeup_id: MAKEUP_ID,
        makeup_date: DATE('보강일'),
        start_time: TIME('시작 시간'),
        end_time: TIME('종료 시간'),
        class_id: CLASS_ID,
        title: { type: 'string', description: '제목' },
        memo: { type: 'string', description: '메모' },
        status: { type: 'string', enum: LMS.MAKEUP_STATUS, description: '예정, 완료, 취소' }
      },
      required: ['makeup_id']
    }
  },
  {
    name: 'cancel_makeup',
    progress: '보강 취소 준비 중',
    description: '보강 일정을 취소합니다(기록은 남고 일정표에서 빠짐). 취소 전에 어떤 보강인지 사용자에게 확인합니다.',
    parameters: { type: 'object', properties: { makeup_id: MAKEUP_ID }, required: ['makeup_id'] }
  }
];
