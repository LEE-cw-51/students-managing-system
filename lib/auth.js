import { cookies } from 'next/headers';
import { loadEnv } from './env.js';
import { SESSION_COOKIE } from './session-cookie.js';
import { sign, unsign } from './signing.js';
import { loadSessionUser } from './accounts.js';
import { serviceRunner } from './store.js';
import { clientIp, createLimiter } from './rate-limit.js';

loadEnv();

const COOKIE = SESSION_COOKIE;
const MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The signed-in user: { uid, wid, ver, email, name, role }, or null.
 * Checked against the database on every call (disabled users, version bumps, membership).
 */
export async function getSession() {
  try {
    const store = await cookies();
    const payload = unsign(store.get(COOKIE)?.value);
    if (!payload || typeof payload.at !== 'number' || Date.now() - payload.at > MAX_AGE * 1000) return null;
    const user = await loadSessionUser(payload);
    if (!user) return null;
    return { uid: user.id, wid: payload.wid, ver: user.session_version, email: user.email, name: user.name, role: user.role };
  } catch (e) {
    return null;
  }
}

/** withService bound to the session's workspace, as a `run(fn)` for routes and helpers. */
export function serviceFor(session) {
  return serviceRunner(session.wid, { userEmail: session.email });
}

export async function setSession({ uid, wid, ver }) {
  const store = await cookies();
  store.set(COOKIE, sign({ uid, wid, ver, at: Date.now() }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

// Login attempt limits (per server instance): per email and per client IP, over a sliding window.
const loginFailures = createLimiter({ windowMs: 15 * 60 * 1000, limits: { email: 10, ip: 30 } });

export function loginKeys(req, email) {
  return [`ip:${clientIp(req)}`, `email:${String(email || '').trim().toLowerCase()}`];
}

export function loginBlocked(keys, now = Date.now()) {
  return loginFailures.blocked(keys, now);
}

export function noteLoginFailure(keys, now = Date.now()) {
  loginFailures.note(keys, now);
}

export function clearLoginFailures(keys) {
  loginFailures.clear(keys.filter((key) => key.startsWith('email:')));
}

// Invite/reset link submissions that reach the database and scrypt, per client IP.
const inviteAttempts = createLimiter({ windowMs: 15 * 60 * 1000, limits: { ip: 20 } });

export function inviteKeys(req) {
  return [`ip:${clientIp(req)}`];
}

export function inviteBlocked(keys, now = Date.now()) {
  return inviteAttempts.blocked(keys, now);
}

export function noteInviteAttempt(keys, now = Date.now()) {
  inviteAttempts.note(keys, now);
}

export { SESSION_COOKIE, hasSessionCookie } from './session-cookie.js';
export { sign, unsign } from './signing.js';
