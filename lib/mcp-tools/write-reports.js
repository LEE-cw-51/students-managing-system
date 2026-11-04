// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, STUDENT_ID } from './shared.js';

export const WRITE_REPORT_TOOLS = [
  {
    name: 'save_monthly_report',
    progress: '월간 리포트 저장 준비 중',
    description: '학생의 월간 리포트를 저장합니다. 같은 달 리포트가 이미 있으면 내용과 상태를 덮어씁니다. 확정은 학부모에게 보낼 최종본이므로 사용자가 원할 때만 씁니다.',
    parameters: {
      type: 'object',
      properties: {
        student_id: STUDENT_ID,
        year: { type: 'integer', description: '연도 (예: 2026)' },
        month: { type: 'integer', minimum: 1, maximum: 12, description: '월 (1~12)' },
        report_text: { type: 'string', description: '리포트 전체 내용' },
        status: { type: 'string', enum: LMS.REPORT_STATUS, description: '임시(기본) 또는 확정' }
      },
      required: ['student_id', 'year', 'month', 'report_text']
    }
  }
];
