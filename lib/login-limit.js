import crypto from 'node:crypto';
import net from 'node:net';
import { useFileStore } from './store.js';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_MAX = 5;
export const LOGIN_EMAIL_MAX = 10;
export const LOGIN_DEVICE_MAX = 10;
export const LOGIN_GLOBAL_MAX = 50;

const GLOBAL_BUCKET = 'global';

/**
 * Client IP from x-real-ip, then the first x-forwarded-for hop (Vercel sets both and drops
 * client-sent values). Anything that is not an IP address becomes 'unknown'.
 */
export function clientIp(headers) {
  const candidates = [headers.get('x-real-ip'), String(headers.get('x-forwarded-for') || '').split(',')[0]];
  for (const raw of candidates) {
    const ip = String(raw || '').trim().slice(0, 64);
    if (net.isIP(ip)) return ip;
  }
  return 'unknown';
}

/** Fixed-window counters in memory: tests and the dev file store. */
export function createMemoryCounters() {
  const rows = new Map();
  return {
    async hit(bucket, nowMs, windowMs) {
      const row = rows.get(bucket);
      const next = !row || row.start <= nowMs - windowMs ? { count: 1, start: nowMs } : { count: row.count + 1, start: row.start };
      rows.set(bucket, next);
      return next;
    },
    async reset(bucket) {
      rows.delete(bucket);
    },
    async refund(bucket) {
      const row = rows.get(bucket);
      if (row) rows.set(bucket, { count: Math.max(0, row.count - 1), start: row.start });
    },
    async prune(cutoffMs) {
      for (const [bucket, row] of rows) if (row.start <= cutoffMs) rows.delete(bucket);
    }
  };
}

let warnedMissingTable = false;

// Without the table nothing can be counted, so the error goes on to the caller and the request is
// refused: logins are never left open without a limit. Says what to do once, in the server log.
function explainMissingTable(e) {
  if (e && e.code === '42P01' && !warnedMissingTable) {
    warnedMissingTable = true;
    console.error('lms.login_attempts가 없어 로그인을 받을 수 없습니다. supabase/migrations/20261110000000_login_attempts.sql을 적용하세요.');
  }
  return e;
}

/**
 * Fixed-window counters in lms.login_attempts, so every serverless instance shares them.
 * Every call throws when the table is missing.
 */
export function createPgCounters(sql) {
  const run = async (query) => {
    try {
      return await query();
    } catch (e) {
      throw explainMissingTable(e);
    }
  };
  return {
    async hit(bucket, nowMs, windowMs) {
      const cutoff = nowMs - windowMs;
      const [row] = await run(() => sql`
        insert into lms.login_attempts as a (bucket, attempts, window_start_ms)
        values (${bucket}, 1, ${nowMs})
        on conflict (bucket) do update
        set attempts = case when a.window_start_ms <= ${cutoff} then 1 else a.attempts + 1 end,
            window_start_ms = case when a.window_start_ms <= ${cutoff} then ${nowMs} else a.window_start_ms end
        returning attempts, window_start_ms
      `);
      return { count: Number(row.attempts), start: Number(row.window_start_ms) };
    },
    async reset(bucket) {
      await run(() => sql`delete from lms.login_attempts where bucket = ${bucket}`);
    },
    async refund(bucket) {
      await run(() => sql`update lms.login_attempts set attempts = greatest(attempts - 1, 0) where bucket = ${bucket}`);
    },
    async prune(cutoffMs) {
      await run(() => sql`delete from lms.login_attempts where window_start_ms <= ${cutoffMs}`);
    }
  };
}

let memoryCounters;

async function defaultCounters() {
  if (useFileStore()) {
    if (!memoryCounters) memoryCounters = createMemoryCounters();
    return memoryCounters;
  }
  const { getSql } = await import('./db.js');
  return createPgCounters(getSql());
}

const ipBucket = (ip) => `ip:${ip}`;
const deviceBucket = (device) => `device:${device}`;

/** Short hash of a trimmed, lower-cased email ('' for none): what the email bucket and the device cookie store. */
export function emailHash(email) {
  const e = String(email || '').trim().toLowerCase();
  return e ? crypto.createHash('sha256').update(e).digest('hex').slice(0, 32) : '';
}

// Hashed so the table holds neither addresses nor whatever long string was typed.
function emailBucket(email) {
  const hash = emailHash(email);
  return hash ? `email:${hash}` : '';
}

/**
 * Counts one try against each [bucket, max] in order (this IP's first, the shared one last) and
 * stops at the first that is over its max. Every limit here uses LOGIN_WINDOW_MS: prune drops
 * rows of every bucket older than one window.
 */
async function reserve(limits, options) {
  const counters = options.counters || (await defaultCounters());
  const now = options.now ?? Date.now();
  let first;
  for (const [bucket, max] of limits) {
    const row = await counters.hit(bucket, now, LOGIN_WINDOW_MS);
    if (!first) first = row;
    if (row.count > max) return { ok: false, retryAfterMs: Math.max(0, row.start + LOGIN_WINDOW_MS - now) };
  }
  if (first.count === 1) await counters.prune(now - LOGIN_WINDOW_MS);
  return { ok: true };
}

/**
 * Counts one login attempt for this IP, this email and everyone before the password is checked,
 * so parallel guesses cannot slip past the limit and guesses at one account from many IPs stop
 * too. options.device: the id of a browser that signed in to the email before (device cookie,
 * knownDevice in lib/auth.js). Its tries are counted under that id instead of the IP and the
 * email, so neither someone else's wrong guesses at the account nor a colleague's on the same
 * network lock the owner out. A correct password clears what it counted (clearLoginAttempts).
 * Returns { ok: true } or { ok: false, retryAfterMs }.
 * options: { device } and { counters, now, ipMax, emailMax, deviceMax, globalMax } (tests).
 */
export async function reserveLoginAttempt(ip, email, options = {}) {
  const limits = [];
  if (options.device) {
    limits.push([deviceBucket(options.device), options.deviceMax ?? LOGIN_DEVICE_MAX]);
  } else {
    limits.push([ipBucket(ip), options.ipMax ?? LOGIN_IP_MAX]);
    const byEmail = emailBucket(email);
    if (byEmail) limits.push([byEmail, options.emailMax ?? LOGIN_EMAIL_MAX]);
  }
  limits.push([GLOBAL_BUCKET, options.globalMax ?? LOGIN_GLOBAL_MAX]);
  return reserve(limits, options);
}

// Claude registers one OAuth client per connector setup; its servers share a few IPs.
export const REGISTER_IP_MAX = 10;
export const REGISTER_GLOBAL_MAX = 30;

/**
 * Counts one OAuth client registration (/api/oauth/register) per LOGIN_WINDOW_MS, in buckets
 * apart from the login ones. Returns { ok: true } or { ok: false, retryAfterMs }.
 * options: { counters, now, ipMax, globalMax } (tests).
 */
export async function reserveClientRegistration(ip, options = {}) {
  return reserve([
    [`register:ip:${ip}`, options.ipMax ?? REGISTER_IP_MAX],
    ['register:global', options.globalMax ?? REGISTER_GLOBAL_MAX]
  ], options);
}

// Invite and password reset links: each submission reaches the database and scrypt.
export const INVITE_IP_MAX = 20;
export const INVITE_GLOBAL_MAX = 100;

/**
 * Counts one invite/reset link submission (/api/invite) per LOGIN_WINDOW_MS, in buckets apart
 * from the login ones. Returns { ok: true } or { ok: false, retryAfterMs }.
 * options: { counters, now, ipMax, globalMax } (tests).
 */
export async function reserveInviteAttempt(ip, options = {}) {
  return reserve([
    [`invite:ip:${ip}`, options.ipMax ?? INVITE_IP_MAX],
    ['invite:global', options.globalMax ?? INVITE_GLOBAL_MAX]
  ], options);
}

/**
 * After a correct password: this try no longer counts against the IP, and the email's count is
 * forgotten. Earlier wrong tries from the IP stay, so signing in to one's own account does not
 * buy more guesses at someone else's. options.device (as given to reserveLoginAttempt): the try
 * was counted under the browser, so that count is forgotten and the IP's is left as it is.
 */
export async function clearLoginAttempts(ip, email, options = {}) {
  const counters = options.counters || (await defaultCounters());
  if (options.device) await counters.reset(deviceBucket(options.device));
  else await counters.refund(ipBucket(ip));
  const byEmail = emailBucket(email);
  if (byEmail) await counters.reset(byEmail);
}

/** The Korean refusal for a blocked login. */
export function loginLimitMessage(retryAfterMs) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return `로그인 시도가 너무 많습니다. 약 ${minutes}분 뒤에 다시 시도해 주세요.`;
}
