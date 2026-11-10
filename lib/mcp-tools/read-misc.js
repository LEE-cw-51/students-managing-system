// MCP-only read tools. Entries: { name, progress, description, parameters, call(api, args) }.
import { LMS, str, pick, DATE } from './shared.js';

// Settings the connector may read. Anything else (API keys, tokens, OAuth, mcp_token_version,
// allowed_emails, passwords, keys added later) stays hidden until it is listed here.
const SAFE_SETTING_KEYS = [
  'academy_name', 'teacher_name', 'contact', 'report_greeting', 'report_closing',
  'assignment_A', 'assignment_B', 'assignment_C', 'assignment_D', 'assignment_E', 'assignment_F',
  'mcp_write_mode'
];

export const READ_MISC_TOOLS = [
  {
    name: 'get_learning_alerts',
    progress: '학습 경고 확인 중',
    description: '최근 60일 수업 기록에서 학습 경고 신호(과제 미흡 연속, 집중도 저하, 시험 성적 하락 등)가 보이는 재원생 목록.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: '최대 학생 수 (기본 8, 최대 30)' } } },
    call(api, args) {
      const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 30);
      return api.getLearningAlerts(limit).map((a) => ({
        student_id: a.student_id,
        name: a.student_name,
        grade: a.grade,
        signals: (a.signals || []).map((s) => s.label || s.message || s.code).filter(Boolean)
      }));
    }
  },
  {
    name: 'get_weekly_homework_dashboard',
    progress: '주간 숙제 현황 확인 중',
    description: '한 주(월–일) 반별 숙제 확인 현황: 수업일마다 숙제 낸 날, 숙제 항목, 완료 칸 수(done/total, A인 칸만 완료), 미완료 학생 수. 날짜를 비우면 이번 주.',
    parameters: { type: 'object', properties: { date: DATE('그 주에 속한 날짜') } },
    call(api, args) {
      const d = api.getWeeklyHomeworkDashboard(str(args.date) || undefined);
      return {
        week_start: d.week_start,
        week_end: d.week_end,
        classes: d.classes.map((c) => ({
          class_id: c.class_id,
          class_name: c.class_name,
          incomplete_slot_count: c.incomplete_slot_count,
          slots: c.slots.map((s) => ({
            check_date: s.check_date,
            assigned_date: s.assigned_date,
            items: s.items.map((it) => it.title),
            ...pick(s.completion, ['item_count', 'student_count', 'students_incomplete', 'done', 'total'])
          }))
        }))
      };
    }
  },
  {
    name: 'get_settings',
    progress: '설정 확인 중',
    description: '학원 기본 설정: 학원명, 강사명, 연락처, 리포트 인사말·맺음말, 과제 등급 기준, Claude 쓰기 모드(mcp_write_mode). 설정은 조회만 됩니다.',
    parameters: { type: 'object', properties: {} },
    call(api) {
      const all = api.getSettings() || {};
      const out = {};
      SAFE_SETTING_KEYS.forEach((k) => { if (all[k] !== undefined) out[k] = all[k]; });
      out.mcp_write_mode = LMS.normalizeMcpWriteMode(all.mcp_write_mode);
      return out;
    }
  },
  {
    name: 'list_pending_proposals',
    progress: '승인 대기 확인 중',
    description: '이 커넥터로 올린 승인 대기 제안 목록(오래된 순): 제안 ID, 만든 시각, 변경 내용. 앱의 AI 비서에서 올린 제안은 보이지 않습니다. 승인과 거절은 강사가 앱 화면에서만 할 수 있습니다.',
    parameters: { type: 'object', properties: {} },
    call(api) {
      const list = api.listPendingProposals(LMS.AGENT_SOURCE_MCP);
      return {
        count: list.length,
        proposals: list.map((p) => ({
          proposal_id: p.proposal_id,
          created_at: p.created_at,
          change: p.calls.map((c) => c.text).join('\n')
        }))
      };
    }
  }
];
