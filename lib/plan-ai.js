import { createRequire } from 'node:module';
import { getMonthlyAiConfig, monthlyAiRequestHeaders, messageText } from './monthly-ai.js';

const require = createRequire(import.meta.url);
const LMS = require('../src/01_Service.js');

// Vercel stops the function at 60s; keep the whole AI step inside this budget.
const TOTAL_BUDGET_MS = 52000;
const MIN_RETRY_MS = 12000;

const SYSTEM_PROMPT = `당신은 학원 수학 강사의 수업 계획을 돕는 보조자입니다.
주어진 JSON만 근거로 이번 달 반 강의 계획 초안을 만듭니다. 최종 결정은 강사가 합니다.

규칙:
- days에는 plannable_dates에 있는 날짜만, 날짜마다 한 번씩 씁니다. 다른 날짜를 만들지 않습니다.
- unit_ids에는 curriculum에 있는 unit_id만 씁니다. 단원 순서를 지키고, done이 sessions보다 작은 단원부터 이어 갑니다.
- basic_split은 단원 수업 횟수만으로 나눈 기본안입니다. 진도가 밀렸거나(recent_sessions의 done_status), 숙제 이행률·출석률이 낮거나, 학교 시험(upcoming_school_exams)이 가까우면 속도를 조절하고 복습·시험 대비 수업을 넣습니다.
- 학생은 ref(S1, S2…)로만 가리킵니다. 보충이 필요한 학생에게만 students 항목을 만들고, 학생당 최대 2개입니다. kind는 "보충과제", "클리닉", "상담", "보강" 중 하나입니다.
- 근거 없는 사실을 만들지 않습니다. 한국어로 짧고 구체적으로 씁니다.
- 아래 형식의 JSON 객체 하나만 출력합니다. 설명이나 코드블록은 쓰지 않습니다.

{
  "rationale": "이렇게 짠 이유 2~4문장",
  "month": { "title": "이달 목표 한 줄", "objectives": "- 목표1\\n- 목표2" },
  "weeks": [ { "week_start": "YYYY-MM-DD", "title": "주 목표", "objectives": "" } ],
  "days": [ { "date": "YYYY-MM-DD", "unit_ids": ["..."], "title": "수업 제목", "content": "수업 흐름", "homework": "숙제", "materials": "" } ],
  "students": [ { "ref": "S1", "kind": "보충과제", "title": "할 일", "reason": "데이터 근거" } ]
}`;

export function buildPlanAiMessages(input, retry) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: '이번 달 반 데이터입니다. 규칙에 맞는 JSON만 출력하세요.\n\n' + JSON.stringify(input) }
  ];
  if (retry) {
    messages.push({ role: 'user', content: '앞 응답을 JSON으로 읽을 수 없었습니다. 설명 없이 형식에 맞는 JSON 객체 하나만 다시 출력하세요.' });
  }
  return messages;
}

function httpErrorMessage(status, body) {
  if (status === 401 || status === 403) return 'AI API 키가 올바르지 않습니다. AI_API_KEY를 확인해 주세요.';
  if (status === 429) return 'AI 사용량이 잠시 몰렸습니다. 잠시 후 다시 시도하거나 기본 분할을 쓰세요.';
  const detail = body && body.error && body.error.message ? body.error.message : String(status);
  return 'AI 호출에 실패했습니다: ' + detail;
}

/**
 * Ask the model for a plan. Returns { result, model }. Retries once when the reply is not
 * readable JSON and there is time left; errors carry a Korean message for the teacher.
 */
export async function requestPlanAi(input, options = {}) {
  const config = options.config || getMonthlyAiConfig();
  if (!config.key) throw new Error('AI API 키가 설정되지 않았습니다. 기본 분할을 쓰거나 AI_API_KEY를 넣어 주세요.');
  const fetchImpl = options.fetch || fetch;
  const deadline = Date.now() + (options.budgetMs || TOTAL_BUDGET_MS);
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (attempt > 0 && left < (options.minRetryMs ?? MIN_RETRY_MS)) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    let res;
    try {
      res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: monthlyAiRequestHeaders(config),
        signal: controller.signal,
        body: JSON.stringify({ model: config.model, temperature: 0.3, messages: buildPlanAiMessages(input, attempt > 0) })
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('AI 응답이 너무 오래 걸립니다. 잠시 후 다시 시도하거나 기본 분할을 쓰세요.');
      throw new Error('AI 서버에 연결할 수 없습니다.');
    }
    const body = await res.json().catch(() => ({}));
    clearTimeout(timer);
    if (!res.ok) throw new Error(httpErrorMessage(res.status, body));
    const text = messageText(body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : '');
    const result = LMS.extractJsonObject(text);
    if (result) return { result, model: String(body.model || config.model) };
  }
  throw new Error('AI 응답을 계획으로 읽을 수 없습니다. 다시 시도하거나 기본 분할을 쓰세요.');
}

/** Swap S1/S2… refs back to student ids; unknown refs become blank and are dropped later. */
export function mapStudentRefs(result, aliases) {
  const students = Array.isArray(result.students) ? result.students : [];
  return {
    ...result,
    students: students.map((s) => {
      const ref = String((s && (s.ref || s.student_ref || s.student)) || '').trim().toUpperCase();
      return { ...s, student_id: aliases[ref] || '' };
    })
  };
}
