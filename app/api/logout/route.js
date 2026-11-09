import { NextResponse } from 'next/server';
import { clearSession } from '../../../lib/auth.js';
import { isSameOrigin } from '../../../lib/same-origin.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const ctype = req.headers.get('content-type') || '';
  const json = ctype.includes('application/json');
  if (!isSameOrigin(req)) {
    if (json) return NextResponse.json({ ok: false, error: '허용되지 않은 요청입니다.' }, { status: 403 });
    return new NextResponse(null, { status: 303, headers: { Location: '/login?error=4' } });
  }
  await clearSession();
  if (json) return NextResponse.json({ ok: true });
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
