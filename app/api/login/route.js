import { NextResponse } from 'next/server';
import { authenticate } from '../../../lib/accounts.js';
import { setSession } from '../../../lib/auth.js';
import { safeNext } from '../../../lib/safe-next.js';
import { clientIp, reserveLoginAttempt, clearLoginAttempts, loginLimitMessage } from '../../../lib/login-limit.js';
import { guardPost } from '../../../lib/request-guard.js';

export const runtime = 'nodejs';

const ERRORS = {
  1: { status: 401, message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
  3: { status: 500, message: '로그인 중 오류가 발생했습니다. 잠시 뒤에 다시 시도해 주세요.' }
};

export async function POST(req) {
  const refused = guardPost(req, { json: false });
  if (refused) return refused;
  const ctype = req.headers.get('content-type') || '';
  const json = ctype.includes('application/json');
  let email = '';
  let password = '';
  let next = '';
  if (json) {
    const body = await req.json().catch(() => ({}));
    email = String(body.email || '');
    password = String(body.password || '');
  } else {
    const form = await req.formData();
    email = String(form.get('email') || '');
    password = String(form.get('password') || '');
    next = safeNext(String(form.get('next') || ''));
  }

  const loginPage = (error) => {
    const query = new URLSearchParams({ error });
    if (next) query.set('next', next);
    return new NextResponse(null, { status: 303, headers: { Location: `/login?${query.toString()}` } });
  };
  const fail = (code) => {
    if (json) return NextResponse.json({ ok: false, error: ERRORS[code].message }, { status: ERRORS[code].status });
    return loginPage(String(code));
  };

  const ip = clientIp(req.headers);
  const gate = await reserveLoginAttempt(ip, email);
  if (!gate.ok) {
    if (json) {
      const retryAfter = String(Math.max(1, Math.ceil(gate.retryAfterMs / 1000)));
      return NextResponse.json({ ok: false, error: loginLimitMessage(gate.retryAfterMs) }, { status: 429, headers: { 'Retry-After': retryAfter } });
    }
    return loginPage(`locked-${Math.max(1, Math.ceil(gate.retryAfterMs / 60000))}`);
  }
  let result;
  try {
    result = await authenticate(email, password);
  } catch (e) {
    console.error('login failed', e);
    return fail(3);
  }
  if (!result) return fail(1);
  await clearLoginAttempts(ip, email);
  await setSession({ uid: result.user.id, wid: result.workspaceId, ver: result.user.session_version });
  if (json) return NextResponse.json({ ok: true });
  return new NextResponse(null, { status: 303, headers: { Location: next || '/' } });
}
