import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { loadEnv } from './env.js';
import { SESSION_COOKIE } from './session-cookie.js';

loadEnv();

const COOKIE = SESSION_COOKIE;

function secret() {
  const s = process.env.AUTH_SECRET || '';
  if (!s) throw new Error('AUTH_SECRET이 없습니다.');
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token) {
  if (!token || token.indexOf('.') === -1) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}

export function passwordOk(input) {
  const expected = process.env.LMS_PASSWORD || '';
  if (!expected) return false;
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export async function isAuthed() {
  try {
    const store = await cookies();
    const token = store.get(COOKIE)?.value;
    const payload = unsign(token);
    return !!(payload && payload.ok === true);
  } catch (e) {
    return false;
  }
}

export async function setSession() {
  const store = await cookies();
  store.set(COOKIE, sign({ ok: true, at: Date.now() }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export { SESSION_COOKIE, hasSessionCookie } from './session-cookie.js';
