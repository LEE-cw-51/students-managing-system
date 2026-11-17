import { NextResponse } from 'next/server';
import { acceptInviteAndSignIn } from '../../../lib/identity.js';
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
  const result = await acceptInviteAndSignIn(token, { password, name }, req.headers);
  if (!result.ok) return back(token, result.reason);
  return new NextResponse(null, { status: 303, headers: { Location: '/' } });
}
