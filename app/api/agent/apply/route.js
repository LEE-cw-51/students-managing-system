import { NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth.js';
import { withService } from '../../../../lib/store.js';
import { applyProposal, applyProposals } from '../../../../lib/agent.js';
import { errorResponse } from '../../../../lib/api-error.js';

export const runtime = 'nodejs';

/**
 * Approve an assistant proposal. A failure undoes every change and is recorded on the proposal.
 * With `proposal_ids` (array) instead, approves each whole and returns per-item results.
 */
export async function POST(req) {
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (Array.isArray(body.proposal_ids)) {
    try {
      const data = await applyProposals(body.proposal_ids, withService);
      return NextResponse.json({ ok: true, data });
    } catch (e) {
      return errorResponse(e);
    }
  }
  const proposalId = String(body.proposal_id || '').trim();
  if (!proposalId) {
    return NextResponse.json({ ok: false, error: '제안을 찾을 수 없습니다.' }, { status: 400 });
  }
  const selected = body.selected === undefined || body.selected === null ? undefined : body.selected;
  if (Array.isArray(selected) && !selected.length) {
    return NextResponse.json({ ok: false, error: '반영할 항목을 하나 이상 선택해 주세요.' }, { status: 400 });
  }
  try {
    const data = await applyProposal(proposalId, withService, selected);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
