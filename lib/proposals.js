/**
 * Proposals: AI changes waiting for the teacher (AgentProposals). The one way to put a
 * proposal up, apply it or reject it; the pending list is the service view listPendingProposals.
 *
 * Every call names its caller: APP_SESSION (the teacher signed in to the app, session cookie)
 * or MCP_CONNECTOR (Claude connector, OAuth token). Both may propose. Only APP_SESSION may
 * apply or reject; any other caller gets PROPOSAL_APP_ONLY and nothing is touched.
 *
 * run: withService-compatible; each call is one transaction. Each proposal is applied in its
 * own transaction: a failure undoes that proposal's changes and is recorded on it
 * (status failed, result.error) in a second one. Applying an applied proposal or rejecting a
 * rejected one returns it unchanged; any other settled proposal gets '이미 처리된 제안입니다.'.
 * status, result, verification_status and executed_at are written only behind this module.
 */
import { LMS } from './lms.js';

export const APP_SESSION = Object.freeze({ kind: 'app', source: LMS.AGENT_SOURCE_ASSISTANT });
export const MCP_CONNECTOR = Object.freeze({ kind: 'mcp', source: LMS.AGENT_SOURCE_MCP });

export const PROPOSAL_BATCH_MAX = 100;
// Error codes the API passes to the browser (lib/api-error.js maps them to HTTP statuses).
export const PROPOSAL_APP_ONLY = 'PROPOSAL_APP_ONLY';
export const PROPOSAL_BAD_REQUEST = 'PROPOSAL_BAD_REQUEST';

const CONNECTOR_REPLY = '아래 변경 내용을 확인하고 승인해 주세요.';

const errorText = (e) => (e && e.message ? e.message : String(e));

function coded(message, code) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function requireCaller(caller) {
  if (caller !== APP_SESSION && caller !== MCP_CONNECTOR) throw new Error('알 수 없는 호출자입니다.');
}

function requireAppSession(caller) {
  requireCaller(caller);
  if (caller !== APP_SESSION) throw coded('승인과 거절은 앱 화면에서만 할 수 있습니다.', PROPOSAL_APP_ONLY);
}

/** Trimmed, de-duplicated proposal ids; throws on an empty or oversized list. */
function idList(ids) {
  const list = Array.isArray(ids) ? [...new Set(ids.map((id) => String(id ?? '').trim()).filter(Boolean))] : [];
  if (!list.length) throw coded('처리할 제안을 하나 이상 선택해 주세요.', PROPOSAL_BAD_REQUEST);
  if (list.length > PROPOSAL_BATCH_MAX) throw coded(`한 번에 ${PROPOSAL_BATCH_MAX}건까지 처리할 수 있습니다.`, PROPOSAL_BAD_REQUEST);
  return list;
}

function oneId(request) {
  const id = String(request.proposal_id ?? '').trim();
  if (!id) throw coded('제안을 찾을 수 없습니다.', PROPOSAL_BAD_REQUEST);
  return id;
}

/** Indexes into proposal.calls to run (undefined: all). */
function selection(selected) {
  if (selected === undefined || selected === null) return undefined;
  if (!Array.isArray(selected) || !selected.every((i) => Number.isInteger(i) && i >= 0)) {
    throw coded('반영할 항목을 다시 선택해 주세요.', PROPOSAL_BAD_REQUEST);
  }
  if (!selected.length) throw coded('반영할 항목을 하나 이상 선택해 주세요.', PROPOSAL_BAD_REQUEST);
  return selected;
}

const isBatch = (request) => request.proposal_ids !== undefined;

const item = (proposalId, status, verificationStatus, error) => ({
  proposal_id: proposalId, status: status || '', verification_status: verificationStatus || '', error: error || ''
});

/**
 * Save one turn (user message + reply) and, when it carries changes, one pending proposal.
 * turn: { message, reply, calls: [{ tool, args, preview? }], conversationId, clientTurnId }.
 * A call with its preview (checked earlier in the turn) is stored as is; others are checked now
 * and an invalid one throws with nothing saved. MCP_CONNECTOR turns get the
 * "[Claude 커넥터] <change>" message and the standard reply; message and reply are ignored.
 * Returns { conversation_id, user_message, message } (message.proposal: the slim proposal or null).
 */
export async function propose(caller, turn, run) {
  requireCaller(caller);
  const t = turn || {};
  return run((api) => {
    const calls = (Array.isArray(t.calls) ? t.calls : []).map((c) => {
      const preview = c.preview || api.previewAgentAction(c.tool, c.args);
      return { tool: c.tool, args: preview.args, preview };
    });
    const connector = caller === MCP_CONNECTOR;
    return api.saveAgentTurn({
      conversation_id: t.conversationId || '',
      client_turn_id: t.clientTurnId || '',
      message: connector ? `${LMS.MCP_MESSAGE_PREFIX} ${calls.map((c) => c.preview.text).join('\n')}` : t.message,
      reply: connector ? CONNECTOR_REPLY : t.reply,
      calls,
      source: caller.source
    });
  });
}

async function applyOne(proposalId, run, selected) {
  try {
    return await run((api) => api.applyAgentProposal(proposalId, selected));
  } catch (e) {
    const untouched = e && (e.code === 'AGENT_NOTHING_SELECTED' || e.code === LMS.AGENT_PROPOSAL_SETTLED);
    if (!untouched) await run((api) => api.markAgentProposalFailed(proposalId, errorText(e))).catch(() => {});
    throw e;
  }
}

async function applyEach(ids, run) {
  const found = await run((api) => api.getAgentProposalOrder(ids));
  const known = new Set(found.map((p) => p.proposal_id));
  const results = [];
  for (const p of found) {
    try {
      const done = await applyOne(p.proposal_id, run);
      results.push(item(p.proposal_id, done.status, done.verification_status, ''));
    } catch (e) {
      // Usually failed; the stored status when it was settled before or during the run.
      const now = await run((api) => api.getAgentProposalOrder([p.proposal_id])).catch(() => []);
      results.push(item(p.proposal_id, now.length ? now[0].status : 'failed', '', errorText(e)));
    }
  }
  ids.filter((id) => !known.has(id)).forEach((id) => results.push(item(id, '', '', '제안을 찾을 수 없습니다.')));
  return results;
}

/**
 * Apply proposals. APP_SESSION only.
 * request { proposal_id, selected? }: one proposal (selected: indexes into its calls, others
 *   recorded as skipped) → the slim proposal; throws when it cannot run.
 * request { proposal_ids }: up to PROPOSAL_BATCH_MAX whole proposals, oldest first, each on its
 *   own → { results: [{ proposal_id, status, verification_status, error }] }; missing ids last.
 */
export async function apply(caller, request, run) {
  requireAppSession(caller);
  const r = request || {};
  if (isBatch(r)) return { results: await applyEach(idList(r.proposal_ids), run) };
  return applyOne(oneId(r), run, selection(r.selected));
}

/**
 * Reject proposals in one transaction. APP_SESSION only.
 * request { proposal_id } → the slim proposal; throws for a missing or otherwise settled one.
 * request { proposal_ids } → { results: [{ proposal_id, status, verification_status, error }] }
 *   in request order; one item's error never stops the others.
 */
export async function reject(caller, request, run) {
  requireAppSession(caller);
  const r = request || {};
  const ids = isBatch(r) ? idList(r.proposal_ids) : [oneId(r)];
  const out = await run((api) => api.rejectAgentProposals(ids));
  if (!isBatch(r)) {
    if (out[0].error) throw new Error(out[0].error);
    return out[0].proposal;
  }
  return {
    results: out.map((o) => item(o.proposal_id, o.proposal && o.proposal.status, o.proposal && o.proposal.verification_status, o.error))
  };
}
