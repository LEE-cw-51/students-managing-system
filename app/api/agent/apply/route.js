import { NextResponse } from 'next/server';
import { isAuthed } from '../../../../lib/auth.js';
import { withService } from '../../../../lib/store.js';
import { APP_SESSION, apply } from '../../../../lib/proposals.js';
import { errorResponse } from '../../../../lib/api-error.js';
import { guardPost } from '../../../../lib/request-guard.js';

export const runtime = 'nodejs';

/**
 * Approve assistant proposals: `{ proposal_id, selected? }` for one (a failure undoes every
 * change and is recorded on it), or `{ proposal_ids }` for several with per-item results.
 */
export async function POST(req) {
  const refused = guardPost(req);
  if (refused) return refused;
  if (!(await isAuthed())) {
    return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const data = await apply(APP_SESSION, body, withService);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
