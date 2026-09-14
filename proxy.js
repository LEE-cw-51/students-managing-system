import { NextResponse } from 'next/server';
import { hasSessionCookie } from './lib/session-cookie.js';

export function proxy(request) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/login') ||
    pathname.startsWith('/_next') ||
    pathname === '/lms-client.js' ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }
  if (!hasSessionCookie(request.headers.get('cookie') || '')) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
};
