import { createRequire } from 'node:module';
import { loadEnv } from './env.js';

loadEnv();

const require = createRequire(import.meta.url);
const LMS = require('../src/01_Service.js');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';
// Vercel stops a function at 60s; every AI step must finish inside this.
const DEFAULT_BUDGET_MS = 52000;
const MIN_RETRY_MS = 12000;

/** One OpenAI-compatible chat endpoint (OpenRouter by default) shared by every AI feature. */
export function getAiConfig() {
  const key = (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const baseUrl = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = (process.env.AI_MODEL || DEFAULT_MODEL).trim();
  return { key, baseUrl, model };
}

/**
 * The AI assistant needs a model that can call tools. AGENT_MODEL picks one for the assistant
 * only, so monthly reports and plans keep AI_MODEL; when blank it falls back to AI_MODEL.
 */
export function getAgentAiConfig() {
  const config = getAiConfig();
  const agentModel = (process.env.AGENT_MODEL || '').trim();
  return agentModel ? { ...config, model: agentModel } : config;
}

export function isAiConfigured() {
  return Boolean(getAiConfig().key);
}

export function aiRequestHeaders(config = getAiConfig()) {
  const headers = {
    Authorization: `Bearer ${config.key}`,
    'Content-Type': 'application/json'
  };
  let host = '';
  try {
    host = new URL(config.baseUrl).host;
  } catch {
    host = '';
  }
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) {
    headers['HTTP-Referer'] = process.env.AI_HTTP_REFERER || 'https://math-power-lms.vercel.app';
    headers['X-Title'] = process.env.AI_APP_NAME || 'Math Power LMS';
  }
  return headers;
}

export function messageText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      return part && part.text ? String(part.text) : '';
    }).join('').trim();
  }
  return '';
}

function httpErrorMessage(status, body) {
  if (status === 401 || status === 403) return 'AI API 키가 올바르지 않습니다. AI_API_KEY를 확인해 주세요.';
  if (status === 429) return 'AI 사용량이 잠시 몰렸습니다. 잠시 후 다시 시도해 주세요.';
  const detail = body && body.error && body.error.message ? body.error.message : String(status);
  return 'AI 호출에 실패했습니다: ' + detail;
}

/**
 * One chat call with a deadline. Returns { text, model }; errors carry a Korean message.
 * options: { config, fetch, timeoutMs, temperature }
 */
export async function chatCompletion(messages, options = {}) {
  const config = options.config || getAiConfig();
  if (!config.key) throw new Error('AI API 키가 설정되지 않았습니다. 서버 환경 변수 AI_API_KEY를 넣어 주세요.');
  const fetchImpl = options.fetch || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs || DEFAULT_BUDGET_MS));
  try {
    let res;
    try {
      res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: aiRequestHeaders(config),
        signal: controller.signal,
        body: JSON.stringify({ model: config.model, temperature: options.temperature ?? 0.3, messages })
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.');
      throw new Error('AI 서버에 연결할 수 없습니다.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(httpErrorMessage(res.status, body));
    const text = messageText(body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : '');
    if (!text) throw new Error('AI가 빈 응답을 반환했습니다.');
    return { text, model: String(body.model || config.model) };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse a tool call's JSON arguments; unreadable arguments become {} with the raw text kept. */
export function parseToolArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { __unreadable: text };
  }
}

export const REQUEST_ABORTED = 'REQUEST_ABORTED';

/** The error thrown when the caller's signal stops an AI call or the assistant loop. */
export function abortedError() {
  const e = new Error('요청을 취소했습니다.');
  e.code = REQUEST_ABORTED;
  return e;
}

/**
 * Read an OpenAI-compatible SSE stream into one assistant message. Text pieces go to onText
 * as they arrive; tool_call pieces are joined by index.
 */
async function readChatStream(res, onText) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let model = '';
  const calls = [];
  const handle = (line) => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (data === '[DONE]') return true;
    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return false;
    }
    if (chunk.error) throw new Error('AI 호출에 실패했습니다: ' + (chunk.error.message || String(chunk.error.code || '')));
    if (chunk.model) model = String(chunk.model);
    const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (!delta) return false;
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    (Array.isArray(delta.tool_calls) ? delta.tool_calls : []).forEach((piece, i) => {
      const index = Number.isInteger(piece.index) ? piece.index : i;
      const call = calls[index] || (calls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (piece.id) call.id = String(piece.id);
      if (piece.type) call.type = piece.type;
      if (piece.function && piece.function.name) call.function.name += piece.function.name;
      if (piece.function && piece.function.arguments) call.function.arguments += piece.function.arguments;
    });
    return false;
  };
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = done ? '' : lines.pop();
    let finished = false;
    for (const line of lines) {
      if (handle(line.trim())) finished = true;
    }
    if (finished || done) break;
  }
  reader.cancel().catch(() => {});
  const toolCalls = calls.filter(Boolean).map((c, i) => (c.id ? c : { ...c, id: `call_${i}` }));
  return {
    model,
    message: { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }
  };
}

/**
 * One chat call that may answer with tool calls (OpenAI-compatible `tools`).
 * Returns { message, text, toolCalls: [{ id, name, args }], model }. `message` is the raw
 * assistant message, to be sent back in the next call before the `role: "tool"` results.
 * options: { config, fetch, timeoutMs, temperature (sent only when given), signal,
 *   onText (when given, the reply is streamed and each text piece is passed to it) }
 */
export async function chatWithTools(messages, tools, options = {}) {
  const config = options.config || getAiConfig();
  if (!config.key) throw new Error('AI API 키가 설정되지 않았습니다. 서버 환경 변수 AI_API_KEY를 넣어 주세요.');
  const fetchImpl = options.fetch || fetch;
  const stream = typeof options.onText === 'function';
  const outer = options.signal;
  if (outer && outer.aborted) throw abortedError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, options.timeoutMs || DEFAULT_BUDGET_MS));
  const stop = () => controller.abort();
  if (outer) outer.addEventListener('abort', stop);
  const failed = (e) => {
    if (outer && outer.aborted) return abortedError();
    if (e && e.name === 'AbortError') return new Error('AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도해 주세요.');
    return null;
  };
  try {
    let res;
    try {
      res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: aiRequestHeaders(config),
        signal: controller.signal,
        // No temperature unless asked: current Claude models (e.g. Haiku 5.5) reject non-default values.
        body: JSON.stringify({
          model: config.model,
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          messages,
          tools,
          tool_choice: 'auto',
          ...(stream ? { stream: true } : {})
        })
      });
    } catch (e) {
      throw failed(e) || new Error('AI 서버에 연결할 수 없습니다.');
    }
    let message = null;
    let model = '';
    const type = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-type') || '' : '';
    const streamed = stream && res.ok && res.body && typeof res.body.getReader === 'function' && !/application\/json/i.test(type);
    if (streamed) {
      try {
        ({ message, model } = await readChatStream(res, options.onText));
      } catch (e) {
        throw failed(e) || e;
      }
    } else {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(httpErrorMessage(res.status, body));
      message = body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message : null;
      model = body.model;
      // A provider that ignored `stream: true` still gets its text shown.
      if (stream && message) {
        const whole = messageText(message.content);
        if (whole) options.onText(whole);
      }
    }
    if (!message) throw new Error('AI가 빈 응답을 반환했습니다.');
    const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter((c) => c && c.function && c.function.name)
      .map((c, i) => ({ id: String(c.id || `call_${i}`), name: String(c.function.name), args: parseToolArguments(c.function.arguments) }));
    const text = messageText(message.content);
    if (!text && !toolCalls.length) throw new Error('AI가 빈 응답을 반환했습니다.');
    return { message, text, toolCalls, model: String(model || config.model) };
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', stop);
  }
}

/**
 * Ask for a JSON object. buildMessages(retry) gives the messages; when the reply is not readable
 * JSON it asks once more if the time budget allows. Returns { result, model }.
 * options: chatCompletion options plus { budgetMs, minRetryMs }
 */
export async function requestJson(buildMessages, options = {}) {
  const deadline = Date.now() + (options.budgetMs || DEFAULT_BUDGET_MS);
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (attempt > 0 && left < (options.minRetryMs ?? MIN_RETRY_MS)) break;
    let reply;
    try {
      reply = await chatCompletion(buildMessages(attempt > 0), { ...options, timeoutMs: left });
    } catch (e) {
      // An empty reply is as unreadable as bad JSON; anything else (key, 429, timeout) stops here.
      if (!/빈 응답/.test(e.message)) throw e;
      continue;
    }
    const result = LMS.extractJsonObject(reply.text);
    if (result) return { result, model: reply.model };
  }
  throw new Error('AI 응답을 읽을 수 없습니다.');
}
