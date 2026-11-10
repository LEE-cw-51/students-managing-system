import { NextResponse } from 'next/server';
import { clearSession } from '../../../lib/auth.js';
import { guardPost } from '../../../lib/request-guard.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const refused = guardPost(req, { json: false });
  if (refused) return refused;
  await clearSession();
  const ctype = req.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    return NextResponse.json({ ok: true });
  }
  return new NextResponse(null, { status: 303, headers: { Location: '/login' } });
}
