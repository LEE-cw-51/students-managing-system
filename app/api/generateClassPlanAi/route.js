import { NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth.js';
import { withService } from '../../../lib/store.js';
import { isMonthlyAiConfigured } from '../../../lib/monthly-ai.js';
import { requestPlanAi, mapStudentRefs } from '../../../lib/plan-ai.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Read context → ask AI → save draft, in two short transactions so the AI wait never holds the DB lock.
export async function POST(req) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  if (!isMonthlyAiConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'AI API 키가 설정되지 않았습니다. 기본 분할을 쓰거나 AI_API_KEY에 OpenRouter 키를 넣어 주세요.'
    }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const classId = body.class_id;
  const month = body.month;
  if (!classId || !month) {
    return NextResponse.json({ ok: false, error: '반과 월을 선택해 주세요.' }, { status: 400 });
  }
  try {
    const ctx = await withService((api) => api.getClassPlanContext(classId, month));
    const ai = await requestPlanAi(ctx.input);
    const result = mapStudentRefs(ai.result, ctx.aliases);
    const board = await withService((api) => api.saveAiPlanDraft(classId, month, result, {
      base_version: ctx.base_version,
      model: ai.model
    }));
    return NextResponse.json({ ok: true, data: board });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
}
