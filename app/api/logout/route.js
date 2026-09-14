import { NextResponse } from 'next/server';
import { clearSession } from '../../../lib/auth.js';

export const runtime = 'nodejs';

export async function POST(req) {
  await clearSession();
  const ctype = req.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    return NextResponse.json({ ok: true });
  }
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
