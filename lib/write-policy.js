/**
 * Write policy: what an AI surface may do with write tools and how it is told so. Pure; the
 * one place that answers "which tools, described how, and what does a queued write say".
 *
 * Surfaces: 'assistant' (the in-app AI 비서; always proposal, it has no mode) and 'mcp' (the
 * Claude connector; Settings mcp_write_mode). No mode saves a write directly and no surface
 * approves: every write becomes a pending proposal the teacher approves in the app (ADR-0002).
 * Stored values are read with LMS.normalizeMcpWriteMode (legacy 'direct', 'claude_approve':
 * proposal; anything else: read_only).
 */
import { LMS } from './lms.js';

export const APPROVAL_TAG = '[승인 필요]';

const SURFACES = {
  assistant: {
    describeWrite: (description) => `${APPROVAL_TAG} ${description}`,
    queued: '승인 대기에 추가했습니다. 아직 저장되지 않았습니다.',
    rules: `- 데이터를 바꾸는 일은 ${APPROVAL_TAG} 도구로만 요청합니다. 이 도구는 바로 저장하지 않고 강사 승인 대기에 올립니다. 변경을 "했다"고 말하지 말고 "승인하면 반영된다"고 말합니다.`
  },
  mcp: {
    describeWrite: (description) => `${APPROVAL_TAG} ${description} 바로 저장되지 않고, 강사가 앱의 AI 비서에서 승인해야 반영됩니다.`,
    queued: '승인 대기에 추가했습니다. 아직 저장되지 않았고, 강사가 앱의 AI 비서에서 승인하면 반영됩니다.',
    rules: [
      `- 쓰기 도구(${APPROVAL_TAG})는 바로 저장하지 않고 모두 승인 대기에 올립니다. 강사가 앱의 AI 비서에서 승인해야 반영되므로 변경을 "했다"고 말하지 말고 "승인하면 반영된다"고 말합니다. 도구 결과의 status를 그대로 전합니다.`,
      '- 승인과 거절은 강사가 앱 화면에서만 합니다. Claude는 제안을 승인하거나 거절할 수 없습니다. 이 커넥터로 올린 대기 제안은 list_pending_proposals로 보여 줄 수만 있습니다.'
    ].join('\n')
  }
};

/**
 * The policy for one surface in one write mode (mcp: any stored value; assistant: ignored).
 * Returns { surface, mode, offers(tool), describe(tool), queued, rules }:
 *   offers: the tool is on this surface and its kind is allowed in this mode (read: always,
 *     write: unless read_only; null or any other kind: never).
 *   describe: the description the model sees; write tools get APPROVAL_TAG and, on mcp, where
 *     approval happens. Action descriptions carry no tag of their own.
 *   queued: the status a write tool returns once its proposal is queued.
 *   rules: prompt lines about writing (system prompt or MCP instructions), the same in every mode.
 */
export function writePolicy(surface, mode) {
  const s = Object.prototype.hasOwnProperty.call(SURFACES, surface) ? SURFACES[surface] : null;
  if (!s) throw new Error('Unknown AI surface: ' + surface);
  const m = surface === 'assistant' ? 'proposal' : LMS.normalizeMcpWriteMode(mode);
  const writes = m !== 'read_only';
  return Object.freeze({
    surface,
    mode: m,
    offers: (tool) => Boolean(tool && tool.surfaces && tool.surfaces.includes(surface))
      && (tool.kind === 'read' || (tool.kind === 'write' && writes)),
    describe: (tool) => (tool.kind === 'write' ? s.describeWrite(tool.description) : tool.description),
    queued: s.queued,
    rules: s.rules
  });
}

/** The connector's write mode from Settings. run: withService-compatible. */
export async function readWriteMode(run) {
  return LMS.normalizeMcpWriteMode(await run((api) => api.getSettings().mcp_write_mode));
}
