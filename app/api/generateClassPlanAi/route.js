import { NextResponse } from 'next/server';
import { isAuthed } from '../../../lib/auth.js';
import { withService } from '../../../lib/store.js';
import { draftClassPlan } from '../../../lib/plan-ai.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** "초안 만들기" on the plan screen: AI draft, or the unit-order split when AI is unavailable. */
export async function POST(req) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!body.class_id || !body.month) {
    return NextResponse.json({ ok: false, error: '반과 월을 선택해 주세요.' }, { status: 400 });
  }
  try {
    const board = await draftClassPlan(body.class_id, body.month, withService);
    return NextResponse.json({ ok: true, data: board });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
}
