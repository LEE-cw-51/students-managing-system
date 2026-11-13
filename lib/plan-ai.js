import { isAiConfigured, requestJson } from './ai-client.js';

const SYSTEM_PROMPT = `당신은 학원 수학 강사의 수업 계획을 돕는 보조자입니다.
주어진 JSON만 근거로 이번 달 반 강의 계획 초안을 만듭니다. 최종 결정은 강사가 합니다.

규칙:
- days에는 plannable_dates에 있는 날짜만, 날짜마다 한 번씩 씁니다. 다른 날짜를 만들지 않습니다.
- unit_ids에는 curriculum에 있는 unit_id만 씁니다. 단원 순서를 지키고, done이 sessions보다 작은 단원부터 이어 갑니다.
- basic_split은 단원 수업 횟수만으로 나눈 기본안입니다. 진도가 밀렸거나(recent_sessions의 done_status), 숙제 완료율(homework_rate, A인 숙제 비율)·숙제 평균 점수(homework_average, A 100~F 50 평균)·출석률이 낮거나, 학교 시험(upcoming_school_exams)이 가까우면 속도를 조절하고 복습·시험 대비 수업을 넣습니다.
- 학생은 ref(S1, S2…)로만 나옵니다. 학생별 요약은 반 계획의 속도와 복습을 정하는 근거로만 쓰고, 학생 개인에게 줄 과제나 조치는 쓰지 않습니다.
- 근거 없는 사실을 만들지 않습니다. 한국어로 짧고 구체적으로 씁니다.
- 아래 형식의 JSON 객체 하나만 출력합니다. 설명이나 코드블록은 쓰지 않습니다.

{
  "rationale": "이렇게 짠 이유 2~4문장",
  "month": { "title": "이달 목표 한 줄", "objectives": "- 목표1\\n- 목표2" },
  "days": [ { "date": "YYYY-MM-DD", "unit_ids": ["..."], "title": "수업 제목", "content": "수업 흐름", "homework": "숙제", "materials": "" } ]
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

/** Ask the model for a plan JSON. Returns { result, model }; see requestJson for retries. */
export function requestPlanAi(input, options = {}) {
  return requestJson((retry) => buildPlanAiMessages(input, retry), options);
}

/**
 * The plan screen's one "초안 만들기" step. With an AI key: read context → ask AI → save the draft,
 * each DB step in its own short transaction (`run`) so the AI wait never holds the DB lock.
 * Without a key, or when the AI call fails, the unit-order split is drafted instead and says why.
 * Errors about the class itself (no unit list, no days left) are thrown as-is.
 */
export async function draftClassPlan(classId, month, run, options = {}) {
  const configured = options.configured ?? isAiConfigured();
  const split = (note) => run((api) => api.createSplitDraft(classId, month, note));
  if (!configured) return split('AI 키가 없어 단원 순서대로 나눴습니다.');
  const ctx = await run((api) => api.getClassPlanContext(classId, month));
  let ai;
  try {
    ai = await requestPlanAi(ctx.input, options);
  } catch (e) {
    return split('AI를 쓰지 못해 단원 순서대로 나눴습니다. (' + (e && e.message ? e.message : String(e)) + ')');
  }
  return run((api) => api.saveAiPlanDraft(classId, month, ai.result, { base_version: ctx.base_version, model: ai.model }));
}
