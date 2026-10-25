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
