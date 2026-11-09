import { NextResponse } from 'next/server';
import { acceptInvite, passwordProblem } from '../../../lib/accounts.js';
import { inviteBlocked, inviteKeys, noteInviteAttempt, setSession } from '../../../lib/auth.js';
import { isSameOrigin } from '../../../lib/same-origin.js';

export const runtime = 'nodejs';

function back(token, error) {
  const path = `/invite/${encodeURIComponent(token)}?error=${error}`;
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/** Form POST from /invite/[token]: sets the password, then signs in. */
export async function POST(req) {
  if (!isSameOrigin(req)) return new NextResponse(null, { status: 303, headers: { Location: '/login?error=4' } });
  const form = await req.formData().catch(() => null);
  const token = String(form?.get('token') || '');
  const password = String(form?.get('password') || '');
  const password2 = String(form?.get('password2') || '');
  const name = String(form?.get('name') || '');
  if (!token) return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  if (password !== password2) return back(token, 'mismatch');
  if (passwordProblem(password)) return back(token, 'weak');
  const keys = inviteKeys(req);
  if (inviteBlocked(keys)) return back(token, 'limited');
  noteInviteAttempt(keys);
  let result;
  try {
    result = await acceptInvite(token, { password, name });
  } catch (e) {
    if (!e.expose) {
      console.error('invite failed', e);
      return back(token, 'server');
    }
    return back(token, e.code === 'EMAIL_TAKEN' ? 'taken' : 'invalid');
  }
  await setSession({ uid: result.user.id, wid: result.workspaceId, ver: result.user.session_version });
  return new NextResponse(null, { status: 303, headers: { Location: '/' } });
}
