import { NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth.js';
import { withService } from '../../../../lib/store.js';
import { rejectProposals } from '../../../../lib/agent.js';
import { errorResponse } from '../../../../lib/api-error.js';
import { guardPost } from '../../../../lib/request-guard.js';

export const runtime = 'nodejs';

/** Reject several assistant proposals (`proposal_ids`) at once; returns per-item results. */
export async function POST(req) {
  const refused = guardPost(req);
  if (refused) return refused;
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.proposal_ids) || !body.proposal_ids.length) {
    return NextResponse.json({ ok: false, error: '처리할 제안을 하나 이상 선택해 주세요.' }, { status: 400 });
  }
  try {
    const data = await rejectProposals(body.proposal_ids, withService);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
