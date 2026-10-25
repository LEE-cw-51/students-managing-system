import { NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth.js';
import { withService } from '../../../lib/store.js';
import { isMonthlyAiConfigured } from '../../../lib/monthly-ai.js';
import { requestPlanAi, mapStudentRefs } from '../../../lib/plan-ai.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The plan screen's one "초안 만들기" button. With an AI key: read context → ask AI → save the
 * draft, in two short transactions so the AI wait never holds the DB lock. Without a key, or when
 * the AI call fails, the unit-order split is drafted instead and the draft says why.
 */
export async function POST(req) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const classId = body.class_id;
  const month = body.month;
  if (!classId || !month) {
    return NextResponse.json({ ok: false, error: '반과 월을 선택해 주세요.' }, { status: 400 });
  }
  const split = (note) => withService((api) => api.createSplitDraft(classId, month, note));
  try {
    if (!isMonthlyAiConfigured()) {
      return NextResponse.json({ ok: true, data: await split('AI 키가 없어 단원 순서대로 나눴습니다.') });
    }
    // Context errors (no unit list, no days left) would fail the split the same way: report them.
    const ctx = await withService((api) => api.getClassPlanContext(classId, month));
    let ai;
    try {
      ai = await requestPlanAi(ctx.input);
    } catch (e) {
      const why = e && e.message ? e.message : String(e);
      return NextResponse.json({ ok: true, data: await split('AI를 쓰지 못해 단원 순서대로 나눴습니다. (' + why + ')') });
    }
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
