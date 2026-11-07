import { NextResponse } from 'next/server';
import { authenticate } from '../../../lib/accounts.js';
import { clearLoginFailures, loginBlocked, loginKeys, noteLoginFailure, setSession } from '../../../lib/auth.js';
import { safeNext } from '../../../lib/safe-next.js';

export const runtime = 'nodejs';

const ERRORS = {
  1: { status: 401, message: '이메일 또는 비밀번호가 올바르지 않습니다.' },
  2: { status: 429, message: '로그인 시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.' },
  3: { status: 500, message: '로그인 중 오류가 발생했습니다. 잠시 뒤에 다시 시도해 주세요.' }
};

export async function POST(req) {
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

  const fail = (code) => {
    if (json) return NextResponse.json({ ok: false, error: ERRORS[code].message }, { status: ERRORS[code].status });
    const query = new URLSearchParams({ error: String(code) });
    if (next) query.set('next', next);
    return new NextResponse(null, { status: 303, headers: { Location: `/login?${query.toString()}` } });
  };

  const keys = loginKeys(req, email);
  if (loginBlocked(keys)) return fail(2);
  let result;
  try {
    result = await authenticate(email, password);
  } catch (e) {
    console.error('login failed', e);
    return fail(3);
  }
  if (!result) {
    noteLoginFailure(keys);
    return fail(1);
  }
  clearLoginFailures(keys);
  await setSession({ uid: result.user.id, wid: result.workspaceId, ver: result.user.session_version });
  if (json) return NextResponse.json({ ok: true });
  return new NextResponse(null, { status: 303, headers: { Location: next || '/' } });
}
