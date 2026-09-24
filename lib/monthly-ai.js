import { loadEnv } from './env.js';

loadEnv();

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/free';

export function getMonthlyAiConfig() {
  const key = (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const baseUrl = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = (process.env.AI_MODEL || DEFAULT_MODEL).trim();
  return { key, baseUrl, model };
}

export function monthlyAiRequestHeaders(config = getMonthlyAiConfig()) {
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

export function isMonthlyAiConfigured() {
  return Boolean(getMonthlyAiConfig().key);
}

const SYSTEM_PROMPT = `당신은 학원 강사를 돕는 교육 분석 보조자입니다.
주어진 JSON 데이터만 근거로 월간 학습 보고서의 분석 구간을 작성합니다.

규칙:
- 데이터에 없는 사실을 만들지 않습니다.
- 학부모에게 전달할 수 있는 정중하고 구체적인 한국어 문장을 사용합니다.
- 통계 숫자는 입력 stats·lessons와 모순되지 않게 인용합니다.
- 상담 기록(counseling_notes)과 학생 피드백(special_note)을 반영합니다. 반 공지는 포함하지 않습니다.
- learning_signals가 있으면 그 의미를 학부모가 이해하기 쉽게 풀어 씁니다.
- 각 섹션은 2~5문장, 불릿은 "- "로 시작합니다.
- 출력은 아래 형식만 사용합니다(다른 머리말/코드블록 없음):

【학습 분석】
(본문)

【학생 피드백·관찰】
(본문)

【다음 달 지도 제안】
(본문)`;

/**
 * @param {import('./store.js').LMS extends never ? never : object} pack from getMonthlyReportContext
 */
export async function buildMonthlyAiSections(pack) {
  const config = getMonthlyAiConfig();
  const { key, baseUrl, model } = config;
  if (!key) {
    throw new Error('AI API 키가 설정되지 않았습니다. 서버 환경 변수 AI_API_KEY에 OpenRouter 키를 넣어 주세요.');
  }

  const payload = {
    student: pack.student,
    year: pack.year,
    month: pack.month,
    period: pack.period,
    stats: pack.stats,
    lessons: pack.lessons,
    counseling_notes: pack.counseling_notes,
    learning_signals: pack.learning_signals,
    student_memo: pack.student && pack.student.memo ? pack.student.memo : ''
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: monthlyAiRequestHeaders(config),
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: '다음 학생의 월간 학습 데이터입니다. 규칙에 맞게 분석 구간만 작성하세요.\n\n' +
            JSON.stringify(payload, null, 2)
        }
      ]
    })
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body && body.error && body.error.message ? body.error.message : res.statusText;
    throw new Error('AI API 호출에 실패했습니다: ' + msg);
  }

  const content = messageText(body.choices && body.choices[0] && body.choices[0].message
    ? body.choices[0].message.content
    : '');
  if (!content) throw new Error('AI가 빈 응답을 반환했습니다.');

  return { text: content, model: String(body.model || model) };
}

function messageText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      return part && part.text ? String(part.text) : '';
    }).join('').trim();
  }
  return '';
}

export function mergeMonthlyReportText(baseText, aiSections) {
  const base = String(baseText || '').trim();
  const ai = String(aiSections || '').trim();
  if (!ai) return base;
  return base + '\n\n' + ai;
}

/** Response body for POST /api/generateMonthlyReportAi (text is always the new draft). */
export function buildGenerateMonthlyReportAiData(pack, aiSections, aiModel) {
  const merged = mergeMonthlyReportText(pack.base_text, aiSections);
  return {
    student: pack.student,
    stats: pack.stats,
    text: merged,
    generated_text: merged,
    ai_sections: aiSections,
    base_text: pack.base_text,
    existing: pack.existing_report || null,
    ai: true,
    ai_model: aiModel || null
  };
}
