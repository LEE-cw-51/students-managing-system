import { NextResponse } from 'next/server';
import { getSession, serviceFor } from '../../../../lib/auth.js';
import { rejectProposals } from '../../../../lib/agent.js';
import { errorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/** Reject several assistant proposals (`proposal_ids`) at once; returns per-item results. */
export async function POST(req) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.proposal_ids) || !body.proposal_ids.length) {
    return NextResponse.json({ ok: false, error: '처리할 제안을 하나 이상 선택해 주세요.' }, { status: 400 });
  }
  try {
    const data = await rejectProposals(body.proposal_ids, serviceFor(session));
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
