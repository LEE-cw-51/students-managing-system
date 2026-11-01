import Anthropic from '@anthropic-ai/sdk';
import { AGENT_TOOLS } from './agent-tools.js';

export const DEFAULT_ANTHROPIC_AGENT_MODEL = 'claude-haiku-5-5';
// One reply in this chat is short; tool inputs are small JSON.
const MAX_TOKENS = 4096;

let sharedClient;

function defaultClient() {
  if (!sharedClient) sharedClient = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY || '').trim() });
  return sharedClient;
}

/**
 * Anthropic model ID for the assistant. Blank → Claude Haiku 5.5. An OpenRouter-style Claude
 * ID left over in AGENT_MODEL (`anthropic/claude-haiku-5.5`) is turned into the Anthropic form
 * (`claude-haiku-5-5`); another provider's model cannot run on the Anthropic API.
 */
export function anthropicModelId(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_ANTHROPIC_AGENT_MODEL;
  if (raw.toLowerCase().startsWith('anthropic/')) return raw.slice('anthropic/'.length).replace(/\./g, '-');
  if (raw.includes('/')) {
    throw new Error('ANTHROPIC_API_KEY를 쓰면 AGENT_MODEL에는 Claude 모델 ID(예: claude-haiku-5-5)를 넣거나 비워 두세요.');
  }
  return raw;
}

/** The shared tool list in the Messages API shape. */
export function anthropicToolDefinitions() {
  return AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

/** Korean message for an SDK error; anything unexpected keeps its own message. */
export function anthropicErrorMessage(e) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return 'Anthropic API 키가 올바르지 않습니다. ANTHROPIC_API_KEY를 확인해 주세요.';
  }
  if (e instanceof Anthropic.RateLimitError) return 'AI 사용량이 잠시 몰렸습니다. 잠시 후 다시 시도해 주세요.';
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.';
  if (e instanceof Anthropic.APIConnectionError) return 'AI 서버에 연결할 수 없습니다.';
  if (e instanceof Anthropic.APIError) return 'AI 호출에 실패했습니다: ' + (e.message || String(e.status));
  return e && e.message ? e.message : String(e);
}

const STOP_NOTICE = {
  refusal: 'AI가 이 요청은 처리하지 않았습니다. 표현을 바꿔 다시 말씀해 주세요.',
  max_tokens: '답변이 길어 중간에 끊겼습니다. 대상이나 기간을 좁혀 다시 요청해 주세요.',
  model_context_window_exceeded: '대화가 너무 길어졌습니다. 새 대화에서 다시 요청해 주세요.'
};

/**
 * Conversation state for one assistant turn on the Messages API.
 * send() returns { text, toolCalls: [{ id, name, args }], model }; addToolResults() appends
 * every result of a step in one user message. Thinking blocks come back inside `content`
 * and are sent back unchanged with the assistant turn.
 * options: { client, model, effort }
 */
export function createAnthropicProvider({ system, history, message }, options = {}) {
  const client = options.client || defaultClient();
  const model = anthropicModelId(options.model);
  const tools = anthropicToolDefinitions();
  const messages = [...history, { role: 'user', content: message }];

  return {
    async send(timeoutMs) {
      let res;
      try {
        res = await client.messages.create({
          model,
          max_tokens: MAX_TOKENS,
          system,
          tools,
          messages,
          // Each step resends the same tools, system prompt and history: cache the prefix.
          cache_control: { type: 'ephemeral' },
          output_config: { effort: options.effort || 'low' }
        }, { timeout: Math.max(1, timeoutMs), maxRetries: 0 });
      } catch (e) {
        throw new Error(anthropicErrorMessage(e));
      }
      const content = Array.isArray(res.content) ? res.content : [];
      const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      const notice = STOP_NOTICE[res.stop_reason];
      if (notice) return { text: text ? text + '\n\n' + notice : notice, toolCalls: [], model: res.model || model };
      const toolCalls = res.stop_reason === 'tool_use'
        ? content.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, args: b.input && typeof b.input === 'object' ? b.input : {} }))
        : [];
      if (toolCalls.length) messages.push({ role: 'assistant', content });
      if (!text && !toolCalls.length) throw new Error('AI가 빈 응답을 반환했습니다.');
      return { text, toolCalls, model: res.model || model };
    },
    addToolResults(results) {
      messages.push({
        role: 'user',
        content: results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: r.content,
          ...(r.isError ? { is_error: true } : {})
        }))
      });
    }
  };
}
