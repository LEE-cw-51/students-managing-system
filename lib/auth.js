import { cookies } from 'next/headers';
import { loadEnv } from './env.js';
import { SESSION_COOKIE } from './session-cookie.js';
import { sign, unsign } from './signing.js';
import { loadSessionUser } from './accounts.js';
import { serviceRunner } from './store.js';

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
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMITS = { email: 10, ip: 30 };
const loginFailures = new Map();

export function loginKeys(req, email) {
  const ip = String(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim() || 'unknown';
  return [`ip:${ip}`, `email:${String(email || '').trim().toLowerCase()}`];
}

function recentFailures(key, now) {
  const list = (loginFailures.get(key) || []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (list.length) loginFailures.set(key, list);
  else loginFailures.delete(key);
  return list;
}

export function loginBlocked(keys, now = Date.now()) {
  return keys.some((key) => recentFailures(key, now).length >= LOGIN_LIMITS[key.startsWith('ip:') ? 'ip' : 'email']);
}

export function noteLoginFailure(keys, now = Date.now()) {
  if (loginFailures.size > 5000) loginFailures.clear();
  keys.forEach((key) => loginFailures.set(key, [...recentFailures(key, now), now]));
}

export function clearLoginFailures(keys) {
  keys.filter((key) => key.startsWith('email:')).forEach((key) => loginFailures.delete(key));
}

export { SESSION_COOKIE, hasSessionCookie } from './session-cookie.js';
export { sign, unsign } from './signing.js';
