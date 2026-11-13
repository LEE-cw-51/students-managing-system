import crypto from 'node:crypto';
import net from 'node:net';
import { useFileStore } from './store.js';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_MAX = 5;
export const LOGIN_EMAIL_MAX = 10;
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
    async prune(cutoffMs) {
      for (const [bucket, row] of rows) if (row.start <= cutoffMs) rows.delete(bucket);
    }
  };
}

let warnedMissingTable = false;

function missingTable(e) {
  if (!e || e.code !== '42P01') return false;
  if (!warnedMissingTable) {
    warnedMissingTable = true;
    console.error('lms.login_attempts가 없어 로그인 시도 제한이 꺼져 있습니다. supabase/migrations/20261110000000_login_attempts.sql을 적용하세요.');
  }
  return true;
}

/** Fixed-window counters in lms.login_attempts, so every serverless instance shares them. */
export function createPgCounters(sql) {
  return {
    async hit(bucket, nowMs, windowMs) {
      const cutoff = nowMs - windowMs;
      try {
        const [row] = await sql`
          insert into lms.login_attempts as a (bucket, attempts, window_start_ms)
          values (${bucket}, 1, ${nowMs})
          on conflict (bucket) do update
          set attempts = case when a.window_start_ms <= ${cutoff} then 1 else a.attempts + 1 end,
              window_start_ms = case when a.window_start_ms <= ${cutoff} then ${nowMs} else a.window_start_ms end
          returning attempts, window_start_ms
        `;
        return { count: Number(row.attempts), start: Number(row.window_start_ms) };
      } catch (e) {
        if (missingTable(e)) return { count: 0, start: nowMs };
        throw e;
      }
    },
    async reset(bucket) {
      try {
        await sql`delete from lms.login_attempts where bucket = ${bucket}`;
      } catch (e) {
        if (!missingTable(e)) throw e;
      }
    },
    async prune(cutoffMs) {
      try {
        await sql`delete from lms.login_attempts where window_start_ms <= ${cutoffMs}`;
      } catch (e) {
        if (!missingTable(e)) throw e;
      }
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

// Hashed so the table holds neither addresses nor whatever long string was typed.
function emailBucket(email) {
  const e = String(email || '').trim().toLowerCase();
  return e ? `email:${crypto.createHash('sha256').update(e).digest('hex').slice(0, 32)}` : '';
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
 * too. A correct password clears the IP's and the email's counts (clearLoginAttempts).
 * Returns { ok: true } or { ok: false, retryAfterMs }.
 * options: { counters, now, ipMax, emailMax, globalMax } (tests).
 */
export async function reserveLoginAttempt(ip, email, options = {}) {
  const limits = [[ipBucket(ip), options.ipMax ?? LOGIN_IP_MAX]];
  const byEmail = emailBucket(email);
  if (byEmail) limits.push([byEmail, options.emailMax ?? LOGIN_EMAIL_MAX]);
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

/** After a correct password: forget the attempts of this IP and this email. */
export async function clearLoginAttempts(ip, email, options = {}) {
  const counters = options.counters || (await defaultCounters());
  await counters.reset(ipBucket(ip));
  const byEmail = emailBucket(email);
  if (byEmail) await counters.reset(byEmail);
}

/** The Korean refusal for a blocked login. */
export function loginLimitMessage(retryAfterMs) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return `로그인 시도가 너무 많습니다. 약 ${minutes}분 뒤에 다시 시도해 주세요.`;
}
