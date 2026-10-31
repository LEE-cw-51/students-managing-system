import { chatWithTools } from './ai-client.js';
import { getAgentTool, toolDefinitions, toolResultText } from './agent-tools.js';

export const AGENT_MAX_STEPS = 6;
export const AGENT_MAX_CHANGES = 30;
// Vercel stops a function at 60s; the reads and the final save need a few seconds too.
const AGENT_BUDGET_MS = 50000;
const MIN_STEP_MS = 4000;

export function buildSystemPrompt(context) {
  const classes = (context.today_classes || []).map((c) => `${c.class_name}(${c.class_id}${c.start_time ? ' ' + c.start_time : ''})`).join(', ');
  return `당신은 학원 강사의 학생 관리 비서입니다. 강사의 지시를 도구로 처리합니다.

오늘: ${context.today} (${context.weekday})
오늘 수업 반: ${classes || '없음'}

규칙:
- 사실은 도구 결과에서만 가져옵니다. 모르는 내용을 지어내지 않습니다.
- 학생 이름이 나오면 search_students로 찾습니다. 성을 빼거나 별명으로 불러도 찾아봅니다.
- 찾은 학생이 여럿이거나 없으면 추측하지 말고, 후보(이름·학교·반)를 보여 주고 누구인지 되묻습니다.
- 데이터를 바꾸는 일은 [승인 필요] 도구로만 요청합니다. 이 도구는 바로 저장하지 않고 강사 승인 대기에 올립니다. 변경을 "했다"고 말하지 말고 "승인하면 반영된다"고 말합니다.
- 여러 학생을 바꿀 때는 학생마다 도구를 한 번씩 호출합니다.
- 할 수 없는 일(문자 발송, 성적 입력, 진도 수정 등 도구가 없는 일)은 할 수 없다고 말하고 해당 화면을 안내합니다.
- "오늘", "어제", "이번 주"는 오늘 날짜를 기준으로 계산합니다.
- 한국어로 짧게 답합니다. 학생 목록이나 비교는 마크다운 표(| 열 | 열 |)로 보여 줍니다.
- 학생을 언급할 때는 이름 뒤에 [[student:학생ID]]를 붙이면 화면에서 링크가 됩니다. 예: 김민수 [[student:STU-0001]]`;
}

function errorText(e) {
  return e && e.message ? e.message : String(e);
}

/**
 * One chat turn. Read tools run at once, each in its own short transaction (`run`), so the
 * AI wait never holds the DB lock. Write tools are only checked (previewAgentAction) and
 * collected; the turn is saved with them as one pending proposal for the teacher to approve.
 * Returns { conversation_id, user_message, message, steps, model }.
 * options: chatWithTools options plus { budgetMs, maxSteps }
 */
export async function runAgentTurn({ conversationId, message }, run, options = {}) {
  const text = String(message || '').trim();
  if (!text) throw new Error('메시지를 입력해 주세요.');
  const deadline = Date.now() + (options.budgetMs || AGENT_BUDGET_MS);
  const maxSteps = options.maxSteps || AGENT_MAX_STEPS;

  const start = await run((api) => ({
    history: api.getAgentHistory(conversationId || ''),
    context: api.getAgentContext()
  }));
  const messages = [
    { role: 'system', content: buildSystemPrompt(start.context) },
    ...start.history,
    { role: 'user', content: text }
  ];
  const tools = toolDefinitions();
  const pending = [];
  const seen = new Set();
  const steps = [];
  let reply = '';
  let model = '';

  for (let step = 0; step < maxSteps; step++) {
    const left = deadline - Date.now();
    if (left < MIN_STEP_MS) break;
    const res = await chatWithTools(messages, tools, { ...options, timeoutMs: left });
    model = res.model;
    if (!res.toolCalls.length) {
      reply = res.text;
      break;
    }
    messages.push({ role: 'assistant', content: res.message.content ?? null, tool_calls: res.message.tool_calls });
    for (const call of res.toolCalls) {
      const tool = getAgentTool(call.name);
      let result;
      if (!tool) {
        result = { error: '없는 도구입니다: ' + call.name };
      } else if (call.args.__unreadable) {
        result = { error: '인자를 JSON으로 읽을 수 없습니다. 다시 호출하세요.' };
      } else if (tool.kind === 'read') {
        try {
          result = await run((api) => tool.call(api, call.args));
        } catch (e) {
          result = { error: errorText(e) };
        }
      } else {
        try {
          const preview = await run((api) => api.previewAgentAction(tool.name, call.args));
          const key = tool.name + JSON.stringify(preview.args);
          if (seen.has(key)) {
            result = { status: '이미 승인 대기에 있습니다.', change: preview.text };
          } else if (pending.length >= AGENT_MAX_CHANGES) {
            result = { error: `한 번에 ${AGENT_MAX_CHANGES}건까지만 제안할 수 있습니다.` };
          } else {
            seen.add(key);
            pending.push({ tool: tool.name, args: preview.args });
            result = { status: '승인 대기에 추가했습니다. 아직 저장되지 않았습니다.', change: preview.text };
          }
        } catch (e) {
          result = { error: errorText(e) };
        }
      }
      steps.push({ tool: call.name, kind: tool ? tool.kind : 'unknown', ok: !(result && result.error) });
      messages.push({ role: 'tool', tool_call_id: call.id, content: toolResultText(result) });
    }
  }

  if (!reply) {
    reply = pending.length
      ? '아래 변경 내용을 확인하고 승인해 주세요.'
      : '요청을 끝까지 처리하지 못했습니다. 대상(학생·날짜)을 조금 더 구체적으로 말씀해 주세요.';
  }
  const saved = await run((api) => api.saveAgentTurn({ conversation_id: conversationId || '', message: text, reply, calls: pending }));
  return { ...saved, steps, model };
}

/**
 * Approve a proposal: run it in one transaction; if anything fails the changes are undone
 * and the failure is recorded in a second transaction, then the error is thrown.
 */
export async function applyProposal(proposalId, run) {
  try {
    return await run((api) => api.applyAgentProposal(proposalId));
  } catch (e) {
    await run((api) => api.markAgentProposalFailed(proposalId, errorText(e))).catch(() => {});
    throw e;
  }
}
