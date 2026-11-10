import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { loadEnv } from './env.js';
import { SESSION_COOKIE } from './session-cookie.js';
import { sign, unsign } from './signing.js';
import { SESSION_MAX_AGE, readSessionVersion, bumpSessionVersion, sessionValid } from './session-version.js';

loadEnv();

const COOKIE = SESSION_COOKIE;

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
    const payload = unsign(token, 'session');
    if (!payload || payload.ok !== true) return false;
    return sessionValid(payload, await readSessionVersion());
  } catch (e) {
    return false;
  }
}

export async function setSession() {
  const store = await cookies();
  store.set(COOKIE, sign({ ok: true, at: Date.now(), sv: await readSessionVersion() }, 'session'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE
  });
}

/** Logout: a signed-in caller also logs out every other device (stolen cookies stop working). */
export async function clearSession() {
  try {
    if (await isAuthed()) await bumpSessionVersion();
  } catch (e) {
    console.error(e);
  }
  const store = await cookies();
  store.delete(COOKIE);
}

export { SESSION_COOKIE, hasSessionCookie } from './session-cookie.js';
export { sign, unsign } from './signing.js';
