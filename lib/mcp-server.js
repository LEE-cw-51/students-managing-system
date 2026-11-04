import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { mcpTools, getAgentTool, toolResultText } from './agent-tools.js';
import { LMS } from './mcp-tools/shared.js';

export const MCP_WRITE_MODES = LMS.MCP_WRITE_MODES;
export const MCP_DEFAULT_MODE = LMS.MCP_WRITE_MODES[0];
export const MCP_MESSAGE_PREFIX = '[Claude 커넥터]';

export const MCP_RATE_LIMIT_DEFAULT = 300;

const APPROVAL_TAG = '[승인 필요]';

const INSTRUCTIONS = `학원 강사의 학생 관리 시스템입니다.
- 학생 이름이 나오면 search_students로 먼저 찾고, 후보가 여럿이면 추측하지 말고 되묻습니다.
- 사실은 도구 결과에서만 가져옵니다. ID는 추측하지 말고 조회 도구로 찾습니다.
- ID 찾는 순서:
  · 학생(student_id): search_students
  · 반(class_id): list_classes, 반 명단은 get_class_members
  · 수업 기록(lesson_id): get_student_lessons 또는 get_attendance
  · 할 일(task_id): get_today_board 또는 get_student_profile, 상담일지(note_id): get_counseling_notes
  · 보강(makeup_id): get_calendar 또는 get_day_agenda
  · 진도 계획(plan_id): get_class_plans 또는 get_plan_board
  · 시험대비 기간(exam_period_id): list_exam_periods, 학교 시험(school_exam_id): get_school_exams
- 쓰기 도구([승인 필요])는 바로 저장하지 않고 모두 승인 대기에 올립니다. 강사가 앱의 AI 비서에서 승인해야 반영되므로 변경을 "했다"고 말하지 말고 "승인하면 반영된다"고 말합니다. 도구 결과의 status를 그대로 전합니다.
- 삭제, 취소, 마감, 덮어쓰기, 여러 건을 한 번에 바꾸는 작업은 실행 전에 대상과 영향 범위(예: 함께 지워지는 기록 수)를 사용자에게 보여 주고 확인을 받습니다.`;

/** Settings value → one of MCP_WRITE_MODES (legacy 'direct': proposal, anything else: read_only). */
export function normalizeWriteMode(value) {
  const v = String(value || '').trim();
  if (v === 'direct') return 'proposal';
  return MCP_WRITE_MODES.includes(v) ? v : MCP_DEFAULT_MODE;
}

/** The current mcp_write_mode from Settings. run: withService-compatible. */
export async function readWriteMode(run) {
  return normalizeWriteMode(await run((api) => api.getSettings().mcp_write_mode));
}

/** Tool calls allowed per hour: MCP_RATE_LIMIT_PER_HOUR (blank: 300, 0: no limit). */
export function mcpRateLimit(raw = process.env.MCP_RATE_LIMIT_PER_HOUR) {
  if (raw === undefined || String(raw).trim() === '') return MCP_RATE_LIMIT_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : MCP_RATE_LIMIT_DEFAULT;
}

function toolDescription(tool) {
  if (tool.kind !== 'write') return tool.description;
  const plain = tool.description.startsWith(APPROVAL_TAG) ? tool.description.slice(APPROVAL_TAG.length).trim() : tool.description;
  return `${APPROVAL_TAG} ${plain} 바로 저장되지 않고, 강사가 앱의 AI 비서에서 승인해야 반영됩니다.`;
}

/** MCP tool definitions for a write mode; read_only hides the write tools. */
export function listTools(mode) {
  const m = normalizeWriteMode(mode);
  return mcpTools()
    .filter((t) => t.kind === 'read' || m !== 'read_only')
    .map((t) => ({
      name: t.name,
      description: toolDescription(t),
      inputSchema: t.parameters,
      annotations: t.kind === 'read'
        ? { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
        : { readOnlyHint: false, destructiveHint: t.destructive !== false, idempotentHint: false, openWorldHint: false }
    }));
}

const textResult = (text, isError = false) => (isError
  ? { content: [{ type: 'text', text }], isError: true }
  : { content: [{ type: 'text', text }] });

const errorText = (e) => (e && e.message ? e.message : String(e));

/**
 * Write tool: save a "[Claude 커넥터]" turn with one pending proposal. Nothing is written until
 * the teacher approves it in the in-app AI assistant.
 */
async function callWriteTool(tool, args, run) {
  const saved = await run((api) => {
    const preview = api.previewAgentAction(tool.name, args);
    return api.saveAgentTurn({
      message: `${MCP_MESSAGE_PREFIX} ${preview.text}`,
      reply: '아래 변경 내용을 확인하고 승인해 주세요.',
      calls: [{ tool: tool.name, args: preview.args, preview }]
    });
  });
  const proposal = saved.message.proposal;
  return {
    status: '승인 대기에 추가했습니다. 아직 저장되지 않았고, 강사가 앱의 AI 비서에서 승인하면 반영됩니다.',
    proposal_id: proposal.proposal_id,
    change: proposal.calls.map((c) => c.text).join('\n')
  };
}

/** Counts one connector call (AgentUsage, kind mcp); the Korean refusal when the hour is used up. */
async function reserveCall(run, limit, now) {
  if (!(limit > 0)) return '';
  const usage = await run((api) => api.reserveAgentTurn(now ?? Date.now(), limit, LMS.AGENT_USAGE_MCP));
  if (usage.ok) return '';
  const minutes = Math.max(1, Math.ceil(usage.retry_after_ms / 60000));
  return `Claude 커넥터는 한 시간에 도구를 ${limit}번까지 쓸 수 있습니다. 약 ${minutes}분 뒤에 다시 시도해 주세요.`;
}

/**
 * One tools/call. Errors come back as isError content with the Korean message, not as a
 * protocol error, so Claude can read them. run: withService-compatible.
 * Every call counts against rateLimit per hour (default: mcpRateLimit()); now: epoch ms (tests).
 */
export async function handleToolCall(name, args, { run, mode, rateLimit, now }) {
  const m = normalizeWriteMode(mode);
  const tool = getAgentTool(name);
  if (!tool || !tool.surfaces.includes('mcp') || (tool.kind === 'write' && m === 'read_only')) {
    return textResult('없는 도구입니다: ' + name, true);
  }
  const input = args && typeof args === 'object' ? args : {};
  try {
    const limited = await reserveCall(run, rateLimit ?? mcpRateLimit(), now);
    if (limited) return textResult(limited, true);
    const result = tool.kind === 'read'
      ? await run((api) => tool.call(api, input))
      : await callWriteTool(tool, input, run);
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
