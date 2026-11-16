import { NextResponse } from 'next/server';
import { acceptInvite } from '../../../lib/accounts.js';
import { completeSignIn } from '../../../lib/auth.js';
import { clientIp, reserveInviteAttempt } from '../../../lib/login-limit.js';
import { guardPost } from '../../../lib/request-guard.js';

export const runtime = 'nodejs';

function back(token, error) {
  const path = `/invite/${encodeURIComponent(token)}?error=${error}`;
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/** Form POST from /invite/[token]: sets the password, then signs in. */
export async function POST(req) {
  const refused = guardPost(req, { json: false });
  if (refused) return refused;
  const form = await req.formData().catch(() => null);
  const token = String(form?.get('token') || '');
  const password = String(form?.get('password') || '');
  const password2 = String(form?.get('password2') || '');
  const name = String(form?.get('name') || '');
  if (!token) return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  if (password !== password2) return back(token, 'mismatch');
  let result;
  try {
    if (!(await reserveInviteAttempt(clientIp(req.headers))).ok) return back(token, 'limited');
    result = await acceptInvite(token, { password, name });
  } catch (e) {
    if (!e.expose) {
      console.error('invite failed', e);
      return back(token, 'server');
    }
    if (e.code === 'KV_NOT_READY') return back(token, 'server');
    if (e.code === 'WEAK_PASSWORD') return back(token, 'weak');
    return back(token, e.code === 'EMAIL_TAKEN' ? 'taken' : 'invalid');
  }
  await completeSignIn(result.user, result.workspaceId);
  return new NextResponse(null, { status: 303, headers: { Location: '/' } });
}
