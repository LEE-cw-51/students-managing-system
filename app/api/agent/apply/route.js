import { NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth.js';
import { withService } from '../../../../lib/store.js';
import { applyProposal } from '../../../../lib/agent.js';
import { errorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/** Approve an assistant proposal. A failure undoes every change and is recorded on the proposal. */
export async function POST(req) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const proposalId = String(body.proposal_id || '').trim();
  if (!proposalId) {
    return NextResponse.json({ ok: false, error: '제안을 찾을 수 없습니다.' }, { status: 400 });
  }
  try {
    const data = await applyProposal(proposalId, withService);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
