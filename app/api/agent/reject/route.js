import { NextResponse } from 'next/server';
import { getSession, serviceFor } from '../../../../lib/auth.js';
import { APP_SESSION, reject } from '../../../../lib/proposals.js';
import { errorResponse } from '../../../../lib/api-error.js';
import { guardPost } from '../../../../lib/request-guard.js';

export const runtime = 'nodejs';

/** Reject assistant proposals: `{ proposal_id }` for one, or `{ proposal_ids }` for several with per-item results. */
export async function POST(req) {
  const refused = guardPost(req);
  if (refused) return refused;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const data = await reject(APP_SESSION, body, serviceFor(session));
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
