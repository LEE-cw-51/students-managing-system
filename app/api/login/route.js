import { NextResponse } from 'next/server';
import { passwordOk, setSession } from '../../../lib/auth.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const ctype = req.headers.get('content-type') || '';
  let password = '';
  if (ctype.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    password = String(body.password || '');
  } else {
    const form = await req.formData();
    password = String(form.get('password') || '');
  }
  if (!process.env.LMS_PASSWORD) {
    return NextResponse.json({ ok: false, error: '서버에 LMS_PASSWORD가 없습니다.' }, { status: 500 });
  }
  if (!passwordOk(password)) {
    if (ctype.includes('application/json')) {
      return NextResponse.json({ ok: false, error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }
    return new NextResponse(null, { status: 303, headers: { Location: '/login?error=1' } });
  }
  await setSession();
  if (ctype.includes('application/json')) {
    return NextResponse.json({ ok: true });
  }
  return new NextResponse(null, { status: 303, headers: { Location: '/' } });
}
