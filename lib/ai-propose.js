/**
 * AI 제안 turn: teacher-gated writes for the in-app assistant and the Claude connector.
 * Callers stage write-tool results into a pending proposal, then propose; apply and reject
 * stay APP_SESSION-only (ADR-0002). Persistence and the caller gate live in proposals.js;
 * tool offer text lives in write-policy.js. This module is the deep call path so assistant
 * and MCP do not bounce across those for one write turn.
 */
import {
  APP_SESSION,
  MCP_CONNECTOR,
  PROPOSAL_APP_ONLY,
  PROPOSAL_BAD_REQUEST,
  PROPOSAL_BATCH_MAX,
  apply,
  propose,
  reject
} from './proposals.js';
import { APPROVAL_TAG, readWriteMode, writePolicy } from './write-policy.js';

export {
  APP_SESSION,
  MCP_CONNECTOR,
  PROPOSAL_APP_ONLY,
  PROPOSAL_BAD_REQUEST,
  PROPOSAL_BATCH_MAX,
  APPROVAL_TAG,
  apply,
  propose,
  reject,
  readWriteMode,
  writePolicy
};

/** Default cap on write calls collected in one assistant turn. */
export const PROPOSE_MAX_CHANGES = 30;

const callKey = (toolName, args) => toolName + JSON.stringify(args);

/**
 * One previewAgentAction for one logical write. stageWrite / proposeConnectorWrite own this;
 * propose and saveAgentTurn reuse the attached preview instead of re-checking.
 */
export async function previewWrite(run, toolName, args) {
  return run((api) => api.previewAgentAction(toolName, args));
}

/**
 * Preview one write and add it to a turn bucket (assistant multi-step loop).
 * bucket: { pending: [], seen: Set }. options: { maxChanges, queued } (queued: policy.queued).
 * Returns the tool-facing result: { status, change } or { error }. Does not persist.
 */
export async function stageWrite(run, toolName, args, bucket, options = {}) {
  const maxChanges = options.maxChanges ?? PROPOSE_MAX_CHANGES;
  const queued = options.queued;
  if (!queued) throw new Error('stageWrite requires options.queued (writePolicy(...).queued)');
  const preview = await previewWrite(run, toolName, args);
  const key = callKey(toolName, preview.args);
  if (bucket.seen.has(key)) {
    return { status: '이미 승인 대기에 있습니다.', change: preview.text };
  }
  if (bucket.pending.length >= maxChanges) {
    return { error: `한 번에 ${maxChanges}건까지만 제안할 수 있습니다.` };
  }
  bucket.seen.add(key);
  bucket.pending.push({ tool: toolName, args: preview.args, preview });
  return { status: queued, change: preview.text };
}

/**
 * Claude connector write: propose one tool call as MCP_CONNECTOR and return the tool body.
 * Previews once here, then propose/saveAgentTurn reuse that preview (ADR-0002).
 * policy: writePolicy('mcp', mode) — uses policy.queued for the status string.
 */
export async function proposeConnectorWrite(tool, args, run, policy) {
  if (!policy || !policy.queued) throw new Error('proposeConnectorWrite requires a writePolicy result');
  const preview = await previewWrite(run, tool.name, args);
  const saved = await propose(
    MCP_CONNECTOR,
    { calls: [{ tool: tool.name, args: preview.args, preview }] },
    run
  );
  const proposal = saved.message.proposal;
  return {
    status: policy.queued,
    proposal_id: proposal.proposal_id,
    change: proposal.calls.map((c) => c.text).join('\n')
  };
}

/**
 * Persist an assistant chat turn with any staged writes as one pending proposal.
 * Same as propose(APP_SESSION, …); kept here so the assistant turn stays on this module.
 */
export function proposeAssistantTurn(turn, run) {
  return propose(APP_SESSION, turn, run);
}
