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

const limitOf = (key) => LOGIN_LIMITS[key.startsWith('ip:') ? 'ip' : 'email'];

export function loginBlocked(keys, now = Date.now()) {
  return keys.some((key) => recentFailures(key, now).length >= limitOf(key));
}

// Over LOGIN_TRACKED_MAX keys, the oldest keys still under their limit go first; blocked keys are only
// dropped (oldest first) past LOGIN_BLOCKED_MAX, so a flood of fresh keys cannot lift a live block.
const LOGIN_TRACKED_MAX = 5000;
const LOGIN_BLOCKED_MAX = 20000;

function evictLoginFailures(now) {
  [...loginFailures.keys()].forEach((key) => recentFailures(key, now));
  if (loginFailures.size <= LOGIN_TRACKED_MAX) return;
  const last = (list) => list[list.length - 1];
  const byAge = [...loginFailures].sort((a, b) => last(a[1]) - last(b[1]));
  const target = Math.floor(LOGIN_TRACKED_MAX * 0.8);
  for (const [key, list] of byAge) {
    if (loginFailures.size <= target) break;
    if (list.length < limitOf(key)) loginFailures.delete(key);
  }
  for (const [key] of byAge) {
    if (loginFailures.size <= LOGIN_BLOCKED_MAX) break;
    loginFailures.delete(key);
  }
}

export function noteLoginFailure(keys, now = Date.now()) {
  if (loginFailures.size > LOGIN_TRACKED_MAX) evictLoginFailures(now);
  keys.forEach((key) => loginFailures.set(key, [...recentFailures(key, now), now].slice(-limitOf(key))));
}

export function clearLoginFailures(keys) {
  keys.filter((key) => key.startsWith('email:')).forEach((key) => loginFailures.delete(key));
}

export { SESSION_COOKIE, hasSessionCookie } from './session-cookie.js';
export { sign, unsign } from './signing.js';
