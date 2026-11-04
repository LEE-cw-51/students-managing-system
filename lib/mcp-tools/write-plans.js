// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, CLASS_ID, DATE } from './shared.js';

const PLAN_ID = { type: 'string', description: '강의 계획 ID (예: PLN-0005). get_class_plans 또는 get_plan_board에서 찾습니다.' };

export const WRITE_PLAN_TOOLS = [
  {
    name: 'save_class_plan',
    progress: '강의 계획 저장 준비 중',
    description: '반의 일간·주간·월간 강의 계획을 작성하거나 고칩니다. 같은 반·기간 계획이 이미 있으면 그 계획을 고치며, 넣지 않은 항목은 그대로 둡니다. 자동 분배된 계획을 고치면 직접 작성한 계획으로 바뀝니다.',
    parameters: {
      type: 'object',
      properties: {
        plan_id: { ...PLAN_ID, description: '고칠 계획 ID (선택). 없으면 class_id·period_type·period_key로 찾거나 새로 만듭니다.' },
        class_id: CLASS_ID,
        period_type: { type: 'string', enum: LMS.PLAN_PERIOD, description: '일간, 주간, 월간' },
        period_key: { type: 'string', description: '일간: 날짜(YYYY-MM-DD), 주간: 그 주의 아무 날짜(YYYY-MM-DD), 월간: YYYY-MM' },
        title: { type: 'string', description: '제목' },
        objectives: { type: 'string', description: '학습 목표' },
        content: { type: 'string', description: '수업 내용' },
        materials: { type: 'string', description: '교재·자료' },
        homework: { type: 'string', description: '숙제' },
        memo: { type: 'string', description: '메모' },
        done_status: { type: 'string', enum: [...LMS.PLAN_DONE_STATUS, ''], description: '일간 계획의 진행 결과 (선택)' }
      },
      required: ['class_id', 'period_type', 'period_key']
    }
  },
  {
    name: 'delete_class_plan',
    progress: '강의 계획 삭제 준비 중',
    description: '강의 계획 하나를 지웁니다. 지우기 전에 어떤 반·기간의 계획인지 사용자에게 확인합니다.',
    parameters: { type: 'object', properties: { plan_id: PLAN_ID }, required: ['plan_id'] }
  },
  {
    name: 'set_daily_plan_done',
    progress: '진도 결과 기록 준비 중',
    description: '그날 일간 계획의 진행 결과(완료/일부/못 함)를 기록합니다. 빈 문자열이면 결과를 지웁니다. 그날 일간 계획이 있어야 합니다.',
    parameters: {
      type: 'object',
      properties: {
        class_id: CLASS_ID,
        date: DATE('수업일'),
        status: { type: 'string', enum: [...LMS.PLAN_DONE_STATUS, ''], description: '완료, 일부, 못 함 (빈 문자열이면 지움)' }
      },
      required: ['class_id', 'date', 'status']
    }
  }
];
