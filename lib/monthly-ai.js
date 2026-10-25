import { getAiConfig, aiRequestHeaders, isAiConfigured, chatCompletion, messageText } from './ai-client.js';

// Older names kept for callers and tests; the AI settings are shared by every AI feature.
export const getMonthlyAiConfig = getAiConfig;
export const monthlyAiRequestHeaders = aiRequestHeaders;
export const isMonthlyAiConfigured = isAiConfigured;
export { messageText };

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
export async function buildMonthlyAiSections(pack, options = {}) {
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
  return chatCompletion([
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: '다음 학생의 월간 학습 데이터입니다. 규칙에 맞게 분석 구간만 작성하세요.\n\n' +
        JSON.stringify(payload, null, 2)
    }
  ], { temperature: 0.4, ...options });
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
