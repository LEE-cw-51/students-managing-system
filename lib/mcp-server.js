import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AGENT_TOOLS, getAgentTool, toolResultText } from './agent-tools.js';
import { applyProposal } from './agent.js';

export const MCP_WRITE_MODES = ['read_only', 'proposal', 'direct'];
export const MCP_DEFAULT_MODE = 'read_only';
export const MCP_MESSAGE_PREFIX = '[Claude 커넥터]';

const APPROVAL_TAG = '[승인 필요]';

const INSTRUCTIONS = `학원 강사의 학생 관리 시스템입니다.
- 학생 이름이 나오면 search_students로 먼저 찾고, 후보가 여럿이면 추측하지 말고 되묻습니다.
- 사실은 도구 결과에서만 가져옵니다.
- 쓰기 도구는 설정에 따라 승인 대기에 올라가거나 바로 저장됩니다. 도구 결과의 status를 그대로 전합니다.`;

/** Settings value → one of MCP_WRITE_MODES (anything else: read_only). */
export function normalizeWriteMode(value) {
  const v = String(value || '').trim();
  return MCP_WRITE_MODES.includes(v) ? v : MCP_DEFAULT_MODE;
}

/** The current mcp_write_mode from Settings. run: withService-compatible. */
export async function readWriteMode(run) {
  return normalizeWriteMode(await run((api) => api.getSettings().mcp_write_mode));
}

function toolDescription(tool, mode) {
  if (tool.kind !== 'write') return tool.description;
  const plain = tool.description.startsWith(APPROVAL_TAG) ? tool.description.slice(APPROVAL_TAG.length).trim() : tool.description;
  if (mode === 'direct') return plain;
  return `${APPROVAL_TAG} ${plain} 바로 저장되지 않고, 강사가 앱의 AI 비서에서 승인해야 반영됩니다.`;
}

/** MCP tool definitions for a write mode; read_only hides the write tools. */
export function listTools(mode) {
  const m = normalizeWriteMode(mode);
  return AGENT_TOOLS
    .filter((t) => t.kind === 'read' || m !== 'read_only')
    .map((t) => ({
      name: t.name,
      description: toolDescription(t, m),
      inputSchema: t.parameters,
      annotations: t.kind === 'read'
        ? { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
        : { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    }));
}

const textResult = (text, isError = false) => (isError
  ? { content: [{ type: 'text', text }], isError: true }
  : { content: [{ type: 'text', text }] });

const errorText = (e) => (e && e.message ? e.message : String(e));

/** Write tool: save a "[Claude 커넥터]" turn with one pending proposal; direct mode applies it at once. */
async function callWriteTool(tool, args, run, mode) {
  const saved = await run((api) => {
    const preview = api.previewAgentAction(tool.name, args);
    return api.saveAgentTurn({
      message: `${MCP_MESSAGE_PREFIX} ${preview.text}`,
      reply: mode === 'direct' ? 'Claude 커넥터에서 바로 저장했습니다.' : '아래 변경 내용을 확인하고 승인해 주세요.',
      calls: [{ tool: tool.name, args: preview.args, preview }]
    });
  });
  const proposal = saved.message.proposal;
  const change = proposal.calls.map((c) => c.text).join('\n');
  if (mode !== 'direct') {
    return {
      status: '승인 대기에 추가했습니다. 아직 저장되지 않았고, 강사가 앱의 AI 비서에서 승인하면 반영됩니다.',
      proposal_id: proposal.proposal_id,
      change
    };
  }
  const applied = await applyProposal(proposal.proposal_id, run);
  const verified = applied.verification_status === 'verified';
  return {
    status: verified ? '저장했습니다.' : '저장했지만 다시 읽은 값이 요청과 다릅니다. 앱에서 확인해 주세요.',
    proposal_id: applied.proposal_id,
    change,
    after: (applied.result || []).map((r) => r.after)
  };
}

/**
 * One tools/call. Errors come back as isError content with the Korean message, not as a
 * protocol error, so Claude can read them. run: withService-compatible.
 */
export async function handleToolCall(name, args, { run, mode }) {
  const m = normalizeWriteMode(mode);
  const tool = getAgentTool(name);
  if (!tool || (tool.kind === 'write' && m === 'read_only')) {
    return textResult('없는 도구입니다: ' + name, true);
  }
  const input = args && typeof args === 'object' ? args : {};
  try {
    const result = tool.kind === 'read'
      ? await run((api) => tool.call(api, input))
      : await callWriteTool(tool, input, run, m);
    return textResult(toolResultText(result));
  } catch (e) {
    return textResult(errorText(e), true);
  }
}

/** Low-level MCP server over the agent tools. getMode is read on every request (default: Settings). */
export function createLmsMcpServer({ run, getMode = () => readWriteMode(run) }) {
  const server = new Server(
    { name: 'students-managing-system', title: '학생 관리 시스템', version: '2.0.0' },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listTools(await getMode()) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => handleToolCall(
    req.params.name, req.params.arguments, { run, mode: await getMode() }
  ));
  return server;
}

/** Stateless Streamable HTTP: a new server and transport per request, JSON responses only. */
export async function handleMcpRequest(req, { run, getMode, authInfo } = {}) {
  const server = createLmsMcpServer({ run, getMode });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req, authInfo ? { authInfo } : undefined);
  } finally {
    await server.close().catch(() => {});
  }
}
