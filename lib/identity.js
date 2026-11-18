/**
 * Browser / request identity for 계정과 로그인.
 *
 * One “can this browser sign in?” and “who is this APP_SESSION request?” path:
 * session cookie verify, session_version / token_version, device cookie, login-limit buckets,
 * and sign-in completion. Routes stay thin adapters. Password rows stay in accounts.js;
 * HMAC stays in signing.js; OAuth connector tokens stay in oauth.js and use loadGrantUser here
 * for the same user/version checks the session path uses via loadSessionUser / getSession.
 */
import { acceptInvite, authenticate, loadGrantUser, loadSessionUser } from './accounts.js';
import {
  SESSION_MAX_AGE,
  sessionFresh,
  getSession,
  serviceFor,
  setSession,
  clearSession,
  DEVICE_COOKIE,
  deviceToken,
  deviceTokenFor,
  deviceIdFor,
  rememberDevice,
  knownDevice,
  completeSignIn,
  SESSION_COOKIE,
  hasSessionCookie
} from './auth.js';
import {
  clientIp,
  reserveLoginAttempt,
  clearLoginAttempts,
  loginLimitMessage,
  reserveInviteAttempt
} from './login-limit.js';

export {
  SESSION_MAX_AGE,
  sessionFresh,
  getSession,
  serviceFor,
  setSession,
  clearSession,
  DEVICE_COOKIE,
  deviceToken,
  deviceTokenFor,
  deviceIdFor,
  rememberDevice,
  knownDevice,
  completeSignIn,
  SESSION_COOKIE,
  hasSessionCookie,
  loadSessionUser,
  loadGrantUser,
  clientIp,
  loginLimitMessage,
  reserveLoginAttempt,
  clearLoginAttempts,
  reserveInviteAttempt
};

/**
 * Password login for this browser: known-device bucket selection, attempt reserve/clear,
 * account authenticate, then completeSignIn (session + device cookie).
 * options: { counters, now, ipMax, emailMax, deviceMax, globalMax } (tests; forwarded to login-limit).
 * Returns { ok: true } | { ok: false, reason: 'bad_credentials'|'limited'|'error', retryAfterMs? }.
 */
export async function authenticateBrowser({ email, password, headers }, options = {}) {
  const ip = clientIp(headers);
  const device = await knownDevice(email);
  const limitOpts = { device, ...options };
  let gate;
  try {
    gate = await reserveLoginAttempt(ip, email, limitOpts);
  } catch (e) {
    // Attempt could not be counted (no lms.login_attempts, database down): refuse, do not skip the limit.
    console.error('login limit failed', e);
    return { ok: false, reason: 'error' };
  }
  if (!gate.ok) return { ok: false, reason: 'limited', retryAfterMs: gate.retryAfterMs };

  let result;
  try {
    result = await authenticate(email, password);
  } catch (e) {
    console.error('login failed', e);
    return { ok: false, reason: 'error' };
  }
  if (!result) return { ok: false, reason: 'bad_credentials' };

  try {
    await clearLoginAttempts(ip, email, limitOpts);
    await completeSignIn(result.user, result.workspaceId);
  } catch (e) {
    console.error('login failed after password check', e);
    return { ok: false, reason: 'error' };
  }
  return { ok: true, user: result.user, workspaceId: result.workspaceId };
}

/**
 * Invite / password-reset link acceptance for this browser: invite attempt bucket, acceptInvite,
 * then completeSignIn. Form mismatches stay in the route.
 * options: { counters, now, ipMax, globalMax, hash } (tests).
 * Returns { ok: true, user, workspaceId } | { ok: false, reason: 'limited'|'weak'|'taken'|'invalid'|'server' }.
 */
export async function acceptInviteAndSignIn(token, { password, name } = {}, headers, options = {}) {
  const { hash, ...limitOpts } = options;
  try {
    if (!(await reserveInviteAttempt(clientIp(headers), limitOpts)).ok) {
      return { ok: false, reason: 'limited' };
    }
    const acceptOpts = hash ? { hash } : {};
    const result = await acceptInvite(token, { password, name }, acceptOpts);
    await completeSignIn(result.user, result.workspaceId);
    return { ok: true, user: result.user, workspaceId: result.workspaceId };
  } catch (e) {
    if (!e.expose) {
      console.error('invite failed', e);
      return { ok: false, reason: 'server' };
    }
    if (e.code === 'KV_NOT_READY') return { ok: false, reason: 'server' };
    if (e.code === 'WEAK_PASSWORD') return { ok: false, reason: 'weak' };
    return { ok: false, reason: e.code === 'EMAIL_TAKEN' ? 'taken' : 'invalid' };
  }
}
