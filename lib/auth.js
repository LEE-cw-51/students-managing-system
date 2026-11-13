import { cookies } from 'next/headers';
import { loadEnv } from './env.js';
import { SESSION_COOKIE } from './session-cookie.js';
import { sign, unsign } from './signing.js';
import { loadSessionUser, signOutEverywhere } from './accounts.js';
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
 * Checked against the database on every call (disabled users, version bumps, membership).
 */
export async function getSession() {
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
}

/** withService bound to the session's workspace, as a `run(fn)` for routes and helpers. */
export function serviceFor(session) {
  return serviceRunner(session.wid, { userEmail: session.email });
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
 * working). Their Claude connector tokens carry the same version, so it has to be reconnected.
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

export { SESSION_COOKIE, hasSessionCookie } from './session-cookie.js';
export { sign, unsign } from './signing.js';
