// MCP-only approval tools, listed only in the claude_approve mode.
// Entries: { name, progress, description, parameters, readOnly, call(ctx, args) } where
// ctx is { run, applyProposals, rejectProposals } (lib/agent.js functions, passed in by the
// MCP server so this file does not import lib/agent.js).
// Only proposals the connector put up are listed or handled; the in-app assistant's stay web-only.
import { LMS } from './shared.js';

const ONLY_MCP = { source: LMS.AGENT_SOURCE_MCP };

const PROPOSAL_IDS = {
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: 100,
  description: '처리할 제안 ID 목록 (list_pending_proposals로 찾음)'
};

const resultItems = (out) => ({
  results: out.results.map((r) => ({
    proposal_id: r.proposal_id,
    status: r.status,
    verification_status: r.verification_status,
    error: r.error
  }))
});

export const APPROVAL_TOOLS = [
  {
    name: 'list_pending_proposals',
    progress: '승인 대기 확인 중',
    description: '이 커넥터로 올린 승인 대기 제안 목록(오래된 순): 제안 ID, 만든 시각, 변경 내용. 앱의 AI 비서에서 올린 제안은 보이지 않습니다. 승인이나 거절 전에 반드시 이 목록으로 대상을 사용자에게 보여 줍니다.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
    async call(ctx) {
      const list = await ctx.run((api) => api.listPendingProposals(LMS.AGENT_SOURCE_MCP));
      return {
        count: list.length,
        proposals: list.map((p) => ({
          proposal_id: p.proposal_id,
          created_at: p.created_at,
          change: p.calls.map((c) => c.text).join('\n')
        }))
      };
    }
  },
  {
    name: 'approve_proposals',
    progress: '제안 승인 중',
    description: '이 커넥터로 올린 승인 대기 제안을 승인해 실제로 반영합니다(앱의 AI 비서에서 올린 제안은 앱에서만 승인). 사용자가 list_pending_proposals로 대상을 확인하고 승인을 직접 말했을 때만 씁니다. 제안을 올린 같은 응답 안에서 스스로 승인하지 않습니다. 결과는 제안별 상태(applied), 확인 결과(verification_status), 실패 사유(error)입니다.',
    parameters: { type: 'object', properties: { proposal_ids: PROPOSAL_IDS }, required: ['proposal_ids'] },
    async call(ctx, args) {
      return resultItems(await ctx.applyProposals(args.proposal_ids, ctx.run, ONLY_MCP));
    }
  },
  {
    name: 'reject_proposals',
    progress: '제안 거절 중',
    description: '이 커넥터로 올린 승인 대기 제안을 거절합니다(반영하지 않음, 앱의 AI 비서에서 올린 제안은 앱에서만 거절). 사용자가 list_pending_proposals로 대상을 확인하고 거절을 직접 말했을 때만 씁니다.',
    parameters: { type: 'object', properties: { proposal_ids: PROPOSAL_IDS }, required: ['proposal_ids'] },
    async call(ctx, args) {
      return resultItems(await ctx.rejectProposals(args.proposal_ids, ctx.run, ONLY_MCP));
    }
  }
];
