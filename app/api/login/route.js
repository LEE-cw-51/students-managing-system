import { NextResponse } from 'next/server';
import { passwordOk, setSession } from '../../../lib/auth.js';
import { safeNext } from '../../../lib/safe-next.js';
import { clientIp, reserveLoginAttempt, clearLoginAttempts, loginLimitMessage } from '../../../lib/login-limit.js';
import { guardPost } from '../../../lib/request-guard.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const refused = guardPost(req, { json: false });
  if (refused) return refused;
  const ctype = req.headers.get('content-type') || '';
  const isJson = ctype.includes('application/json');
  let password = '';
  let next = '';
  if (isJson) {
    const body = await req.json().catch(() => ({}));
    password = String(body.password || '');
  } else {
    const form = await req.formData();
    password = String(form.get('password') || '');
    next = safeNext(String(form.get('next') || ''));
  }
  if (!process.env.LMS_PASSWORD) {
    return NextResponse.json({ ok: false, error: '서버에 LMS_PASSWORD가 없습니다.' }, { status: 500 });
  }
  const loginPage = (error) => {
    const params = new URLSearchParams({ error });
    if (next) params.set('next', next);
    return new NextResponse(null, { status: 303, headers: { Location: `/login?${params}` } });
  };
  const ip = clientIp(req.headers);
  const gate = await reserveLoginAttempt(ip);
  if (!gate.ok) {
    if (isJson) {
      const retryAfter = String(Math.max(1, Math.ceil(gate.retryAfterMs / 1000)));
      return NextResponse.json({ ok: false, error: loginLimitMessage(gate.retryAfterMs) }, { status: 429, headers: { 'Retry-After': retryAfter } });
    }
    return loginPage(`locked-${Math.max(1, Math.ceil(gate.retryAfterMs / 60000))}`);
  }
  if (!passwordOk(password)) {
    if (isJson) {
      return NextResponse.json({ ok: false, error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }
    return loginPage('1');
  }
  await clearLoginAttempts(ip);
  await setSession();
  if (isJson) {
    return NextResponse.json({ ok: true });
  }
  return new NextResponse(null, { status: 303, headers: { Location: next || '/' } });
}
