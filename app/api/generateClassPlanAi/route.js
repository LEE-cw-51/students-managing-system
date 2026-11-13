import { NextResponse } from 'next/server';
import { getSession, serviceFor } from '../../../lib/auth.js';
import { draftClassPlan } from '../../../lib/plan-ai.js';
import { errorResponse } from '../../../lib/api-error.js';
import { guardPost } from '../../../lib/request-guard.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** "초안 만들기" on the plan screen: AI draft, or the unit-order split when AI is unavailable. */
export async function POST(req) {
  const refused = guardPost(req);
  if (refused) return refused;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.class_id || !body.month) {
    return NextResponse.json({ ok: false, error: '반과 월을 선택해 주세요.' }, { status: 400 });
  }
  try {
    const board = await draftClassPlan(body.class_id, body.month, serviceFor(session));
    return NextResponse.json({ ok: true, data: board });
  } catch (e) {
    return errorResponse(e);
  }
}
