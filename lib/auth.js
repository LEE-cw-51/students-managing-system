import crypto from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { loadEnv } from './env.js';
import { SESSION_COOKIE } from './session-cookie.js';
import { sign, unsign } from './signing.js';
import { findUserByEmail, loadSessionUser, signOutEverywhere } from './accounts.js';
import { emailHash } from './login-limit.js';
import { serviceRunner } from './store.js';

loadEnv();

const COOKIE = SESSION_COOKIE;

/** Session lifetime in seconds; the cookie's maxAge and the server-side check share it. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

// Clock skew allowed for `at` slightly in the future (another instance's clock).
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Whether a decoded session cookie payload is still fresh: a session (not an OAuth token) signed
 * at `at` less than SESSION_MAX_AGE ago. The user, workspace and version are checked against the
 * database separately (loadSessionUser).
 */
export function sessionFresh(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || payload.typ !== undefined) return false;
  const at = payload.at;
  return typeof at === 'number' && Number.isFinite(at) && at <= now + FUTURE_SKEW_MS && now - at < SESSION_MAX_AGE * 1000;
}

/**
 * The signed-in user: { uid, wid, ver, email, name, role }, or null.
 * Checked against the database (disabled users, version bumps, membership): once per page render
 * (React cache), on every call in route handlers.
 */
export const getSession = cache(async () => {
  try {
    const store = await cookies();
    const payload = unsign(store.get(COOKIE)?.value, 'session');
    if (!sessionFresh(payload)) return null;
    const user = await loadSessionUser(payload);
    if (!user) return null;
    return { uid: user.id, wid: payload.wid, ver: user.session_version, email: user.email, name: user.name, role: user.role };
  } catch (e) {
    return null;
  }
});

/** withService bound to the session's workspace, as a `run(fn)` for routes and helpers. */
export function serviceFor(session) {
  return serviceRunner(session.wid);
}

export async function setSession({ uid, wid, ver }) {
  const store = await cookies();
  store.set(COOKIE, sign({ uid, wid, ver, at: Date.now() }, 'session'), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE
  });
}

/**
 * Logout: a signed-in caller is also logged out on every other device (stolen cookies stop
 * working). Their Claude connectors stay connected (those follow users.token_version).
 */
export async function clearSession() {
  try {
    const session = await getSession();
    if (session) await signOutEverywhere(session.uid);
  } catch (e) {
    console.error(e);
  }
  const store = await cookies();
  store.delete(COOKIE);
}

export const DEVICE_COOKIE = 'lms_device';
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Device cookie value saying this browser signed in to `email` at `at`, while the account's token version
 * was `uv`. A password change, reset or disable moves that version on, so every older cookie stops counting.
 */
export function deviceToken(email, uv, at = Date.now()) {
  return sign({ typ: 'device', e: emailHash(email), uv: Number(uv), at }, 'device');
}

/** Whether a device cookie value was issued for `email` at token version `uv`, less than a year ago. */
export function deviceTokenFor(token, email, uv, now = Date.now()) {
  const payload = unsign(token, 'device');
  const hash = emailHash(email);
  if (!payload || payload.typ !== 'device' || !hash || payload.e !== hash) return false;
  if (!Number.isFinite(Number(uv)) || payload.uv !== Number(uv)) return false;
  return typeof payload.at === 'number' && payload.at <= now + FUTURE_SKEW_MS && now - payload.at < DEVICE_MAX_AGE * 1000;
}

/**
 * Id of the browser holding a device cookie value that is good for `email` at token version `uv` (a hash
 * of the value, so each browser has its own), or ''. The login limit counts a known browser's tries under this id.
 */
export function deviceIdFor(token, email, uv, now = Date.now()) {
  if (!deviceTokenFor(token, email, uv, now)) return '';
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}

/** Marks this browser as one that signed in as `user` (login, invite or reset link). Logout keeps it. */
export async function rememberDevice(user) {
  const store = await cookies();
  store.set(DEVICE_COOKIE, deviceToken(user.email, user.token_version), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEVICE_MAX_AGE
  });
}

/** After a correct password or an accepted link: starts the session and marks this browser as known. */
export async function completeSignIn(user, workspaceId) {
  await setSession({ uid: user.id, wid: workspaceId, ver: user.session_version });
  await rememberDevice(user);
}

/**
 * This browser's device id when it signed in to `email` since the account's last password change, or ''.
 * Such a login is counted per browser, not per IP and email. Unknown and disabled accounts have no device.
 */
export async function knownDevice(email) {
  try {
    const store = await cookies();
    const token = store.get(DEVICE_COOKIE)?.value;
    if (!token) return '';
    const user = await findUserByEmail(email);
    if (!user || user.disabled) return '';
    return deviceIdFor(token, email, user.token_version);
  } catch (e) {
    return '';
  }
}

export { SESSION_COOKIE, hasSessionCookie } from './session-cookie.js';
export { sign, unsign } from './signing.js';
