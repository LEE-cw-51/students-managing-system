import net from 'node:net';
import { useFileStore } from './store.js';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_MAX = 5;
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

/**
 * Counts one try against this IP's bucket, then against the shared bucket. Every limit here
 * uses LOGIN_WINDOW_MS: prune drops rows of every bucket older than one window.
 */
async function reserve(buckets, maxes, options) {
  const counters = options.counters || (await defaultCounters());
  const now = options.now ?? Date.now();
  const blocked = (row) => ({ ok: false, retryAfterMs: Math.max(0, row.start + LOGIN_WINDOW_MS - now) });
  const mine = await counters.hit(buckets.ip, now, LOGIN_WINDOW_MS);
  if (mine.count > maxes.ip) return blocked(mine);
  const all = await counters.hit(buckets.global, now, LOGIN_WINDOW_MS);
  if (all.count > maxes.global) return blocked(all);
  if (mine.count === 1) await counters.prune(now - LOGIN_WINDOW_MS);
  return { ok: true };
}

/**
 * Counts one login attempt for this IP and for everyone before the password is checked, so
 * parallel guesses cannot slip past the limit. A correct password clears the IP's count
 * (clearLoginAttempts). Returns { ok: true } or { ok: false, retryAfterMs }.
 * options: { counters, now, ipMax, globalMax } (tests).
 */
export async function reserveLoginAttempt(ip, options = {}) {
  return reserve(
    { ip: ipBucket(ip), global: GLOBAL_BUCKET },
    { ip: options.ipMax ?? LOGIN_IP_MAX, global: options.globalMax ?? LOGIN_GLOBAL_MAX },
    options
  );
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
  return reserve(
    { ip: `register:ip:${ip}`, global: 'register:global' },
    { ip: options.ipMax ?? REGISTER_IP_MAX, global: options.globalMax ?? REGISTER_GLOBAL_MAX },
    options
  );
}

/** After a correct password: forget this IP's attempts. */
export async function clearLoginAttempts(ip, options = {}) {
  const counters = options.counters || (await defaultCounters());
  await counters.reset(ipBucket(ip));
}

/** The Korean refusal for a blocked login. */
export function loginLimitMessage(retryAfterMs) {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
  return `로그인 시도가 너무 많습니다. 약 ${minutes}분 뒤에 다시 시도해 주세요.`;
}
