'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// lib/auth.js loads accounts and the store: keep the file stores in a temp folder.
// Must run before lib/store.js is loaded.
const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-security-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
require('./next-stubs.js').install();

const {
  clientIp, createMemoryCounters, reserveLoginAttempt, clearLoginAttempts, loginLimitMessage, reserveClientRegistration,
  reserveInviteAttempt, LOGIN_WINDOW_MS, LOGIN_IP_MAX, LOGIN_EMAIL_MAX, LOGIN_GLOBAL_MAX, REGISTER_IP_MAX, REGISTER_GLOBAL_MAX,
  INVITE_IP_MAX, INVITE_GLOBAL_MAX
} = require('../lib/login-limit.js');
const { SESSION_MAX_AGE, sessionFresh } = require('../lib/auth.js');
const { guardPost } = require('../lib/request-guard.js');
const { sign, unsign } = require('../lib/signing.js');

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const T0 = Date.parse('2026-11-10T00:00:00Z');

describe('login attempt limit', () => {
  it('blocks the sixth attempt from one IP within 15 minutes and lets it in after the window', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < LOGIN_IP_MAX; i += 1) {
      assert.deepEqual(await reserveLoginAttempt('1.2.3.4', `u${i}@test.kr`, { counters, now: T0 + i * 1000 }), { ok: true });
    }
    const blocked = await reserveLoginAttempt('1.2.3.4', 'new@test.kr', { counters, now: T0 + 60000 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 60000);
    assert.equal((await reserveLoginAttempt('5.6.7.8', 'new@test.kr', { counters, now: T0 + 60000 })).ok, true);
    assert.equal((await reserveLoginAttempt('1.2.3.4', 'new@test.kr', { counters, now: T0 + LOGIN_WINDOW_MS })).ok, true);
  });

  it('a correct password clears the IP and email counts', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < LOGIN_IP_MAX; i += 1) await reserveLoginAttempt('1.2.3.4', 'me@test.kr', { counters, now: T0 });
    await clearLoginAttempts('1.2.3.4', 'me@test.kr', { counters });
    assert.equal((await reserveLoginAttempt('1.2.3.4', 'me@test.kr', { counters, now: T0 + 1 })).ok, true);

    for (let i = 0; i < LOGIN_EMAIL_MAX; i += 1) await reserveLoginAttempt(`10.1.0.${i}`, 'me@test.kr', { counters, now: T0 });
    assert.equal((await reserveLoginAttempt('10.1.1.1', 'me@test.kr', { counters, now: T0 })).ok, false);
    await clearLoginAttempts('10.1.0.0', ' ME@test.kr ', { counters });
    assert.equal((await reserveLoginAttempt('10.1.1.1', 'me@test.kr', { counters, now: T0 })).ok, true);
  });

  it('caps attempts at one email from many IPs, ignoring case and spaces', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < LOGIN_EMAIL_MAX; i += 1) {
      assert.equal((await reserveLoginAttempt(`10.2.0.${i}`, i % 2 ? 'Target@Test.kr ' : 'target@test.kr', { counters, now: T0 })).ok, true);
    }
    const blocked = await reserveLoginAttempt('10.2.1.1', 'target@test.kr', { counters, now: T0 + 1000 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 1000);
    assert.equal((await reserveLoginAttempt('10.2.1.1', 'other@test.kr', { counters, now: T0 + 1000 })).ok, true);
  });

  it('keeps the typed email out of the counter table', async () => {
    const counters = createMemoryCounters();
    const buckets = [];
    const hit = counters.hit;
    counters.hit = (bucket, ...rest) => {
      buckets.push(bucket);
      return hit(bucket, ...rest);
    };
    await reserveLoginAttempt('1.2.3.4', 'secret@test.kr', { counters, now: T0 });
    assert.equal(buckets.length, 3);
    assert.equal(buckets.some((b) => b.includes('secret')), false);
    assert.match(buckets[1], /^email:[0-9a-f]{32}$/);
  });

  it('caps attempts from all IPs together', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < LOGIN_GLOBAL_MAX; i += 1) {
      assert.equal((await reserveLoginAttempt(`10.0.0.${i}`, `u${i}@test.kr`, { counters, now: T0 })).ok, true);
    }
    const blocked = await reserveLoginAttempt('10.0.1.1', 'late@test.kr', { counters, now: T0 + 1000 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 1000);
  });

  it('counts parallel guesses before any password check', async () => {
    const counters = createMemoryCounters();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveLoginAttempt('1.2.3.4', 'me@test.kr', { counters, now: T0 })));
    assert.equal(results.filter((r) => r.ok).length, LOGIN_IP_MAX);
  });

  it('explains the wait in Korean', () => {
    assert.equal(loginLimitMessage(14 * 60000 + 1), '로그인 시도가 너무 많습니다. 약 15분 뒤에 다시 시도해 주세요.');
    assert.match(loginLimitMessage(0), /약 1분/);
  });

  it('reads the client IP from x-real-ip, then the first x-forwarded-for hop', () => {
    const h = (o) => new Headers(o);
    assert.equal(clientIp(h({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' })), '203.0.113.7');
    assert.equal(clientIp(h({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' })), '198.51.100.1');
    assert.equal(clientIp(h({ 'x-forwarded-for': '2001:db8::1' })), '2001:db8::1');
    assert.equal(clientIp(h({ 'x-real-ip': 'not-an-ip', 'x-forwarded-for': 'x'.repeat(500) })), 'unknown');
    assert.equal(clientIp(h({})), 'unknown');
  });
});

describe('OAuth client registration limit', () => {
  it('caps registrations per IP and overall, in buckets apart from login attempts', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < REGISTER_IP_MAX; i += 1) {
      assert.equal((await reserveClientRegistration('1.2.3.4', { counters, now: T0 })).ok, true);
    }
    const blocked = await reserveClientRegistration('1.2.3.4', { counters, now: T0 + 1000 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 1000);
    assert.equal((await reserveLoginAttempt('1.2.3.4', 'me@test.kr', { counters, now: T0 + 1000 })).ok, true, 'login is counted apart');
    assert.equal((await reserveClientRegistration('1.2.3.4', { counters, now: T0 + LOGIN_WINDOW_MS })).ok, true);

    const all = createMemoryCounters();
    for (let i = 0; i < REGISTER_GLOBAL_MAX; i += 1) {
      assert.equal((await reserveClientRegistration(`10.0.0.${i}`, { counters: all, now: T0 })).ok, true);
    }
    assert.equal((await reserveClientRegistration('10.0.1.1', { counters: all, now: T0 })).ok, false);
    assert.equal((await reserveLoginAttempt('10.0.1.1', 'me@test.kr', { counters: all, now: T0 })).ok, true);
  });
});

describe('invite link submission limit', () => {
  it('caps submissions per IP and overall, in buckets apart from login attempts', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < INVITE_IP_MAX; i += 1) {
      assert.equal((await reserveInviteAttempt('1.2.3.4', { counters, now: T0 })).ok, true);
    }
    const blocked = await reserveInviteAttempt('1.2.3.4', { counters, now: T0 + 1000 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 1000);
    assert.equal((await reserveLoginAttempt('1.2.3.4', 'me@test.kr', { counters, now: T0 + 1000 })).ok, true, 'login is counted apart');
    assert.equal((await reserveInviteAttempt('1.2.3.4', { counters, now: T0 + LOGIN_WINDOW_MS })).ok, true);

    const all = createMemoryCounters();
    for (let i = 0; i < INVITE_GLOBAL_MAX; i += 1) {
      assert.equal((await reserveInviteAttempt(`10.0.${Math.floor(i / 200)}.${i % 200}`, { counters: all, now: T0 })).ok, true);
    }
    assert.equal((await reserveInviteAttempt('10.9.9.9', { counters: all, now: T0 })).ok, false);
  });
});

describe('session expiry', () => {
  const NOW = T0 + 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const cookie = (at) => ({ uid: 'u', wid: 'w', ver: 1, at });

  it('expires sessions after SESSION_MAX_AGE (30 days, same as the cookie)', () => {
    assert.equal(SESSION_MAX_AGE, 60 * 60 * 24 * 30);
    assert.equal(sessionFresh(cookie(NOW - DAY), NOW), true);
    assert.equal(sessionFresh(cookie(NOW - 30 * DAY + 1), NOW), true);
    assert.equal(sessionFresh(cookie(NOW - 30 * DAY), NOW), false);
    assert.equal(sessionFresh(cookie(undefined), NOW), false);
    assert.equal(sessionFresh(cookie(String(NOW)), NOW), false);
  });

  it('allows a few minutes of clock skew, not a cookie from the future', () => {
    assert.equal(sessionFresh(cookie(NOW + 60 * 1000), NOW), true);
    assert.equal(sessionFresh(cookie(NOW + DAY), NOW), false);
  });

  it('never takes an OAuth token or an unsigned payload for a session', () => {
    const access = unsign(sign({ typ: 'access', cid: 'c', ver: '0', iat: 1, at: NOW, exp: 2 }, 'token'), 'token');
    assert.equal(sessionFresh(access, NOW), false);
    assert.equal(unsign(sign(cookie(NOW), 'token'), 'session'), null, 'a token-key signature is no session');
    assert.equal(sessionFresh({ ...cookie(NOW), typ: 'access' }, NOW), false);
    assert.equal(sessionFresh(null, NOW), false);
  });
});

describe('guardPost', () => {
  const req = (headers) => new Request('http://localhost:8787/api/getStudents', { method: 'POST', headers });

  it('lets same-host and Origin-less JSON requests through', () => {
    assert.equal(guardPost(req({ host: 'lms.example.com', origin: 'https://lms.example.com', 'content-type': 'application/json' })), null);
    assert.equal(guardPost(req({ host: 'localhost:8787', origin: 'http://localhost:8787', 'content-type': 'application/json; charset=utf-8' })), null);
    assert.equal(guardPost(req({ host: 'internal', 'x-forwarded-host': 'lms.example.com', origin: 'https://lms.example.com', 'content-type': 'application/json' })), null);
    assert.equal(guardPost(req({ host: 'lms.example.com', 'content-type': 'application/json' })), null);
  });

  it('refuses another origin with 403', async () => {
    for (const origin of ['https://evil.example', 'null', 'https://lms.example.com.evil.example']) {
      const res = guardPost(req({ host: 'lms.example.com', origin, 'content-type': 'application/json' }));
      assert.equal(res.status, 403);
      assert.equal((await res.json()).ok, false);
    }
  });

  it('refuses a browser that says the request came from another site', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = guardPost(req({ host: 'lms.example.com', 'sec-fetch-site': site, 'content-type': 'application/json' }));
      assert.equal(res.status, 403, site);
    }
    const form = { host: 'lms.example.com', 'content-type': 'application/x-www-form-urlencoded' };
    assert.equal(guardPost(req({ ...form, 'sec-fetch-site': 'cross-site' }), { json: false }).status, 403, 'login CSRF from a form');
    assert.equal(guardPost(req({ ...form, 'sec-fetch-site': 'same-origin', origin: 'https://lms.example.com' }), { json: false }), null);
    assert.equal(guardPost(req({ ...form, 'sec-fetch-site': 'none' }), { json: false }), null, 'typed into the address bar');
  });

  it('requires a JSON body type unless json is false', async () => {
    const form = req({ host: 'lms.example.com', origin: 'https://lms.example.com', 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(guardPost(form).status, 415);
    assert.equal(guardPost(req({ host: 'lms.example.com', 'content-type': 'text/plain' })).status, 415);
    assert.equal(guardPost(form, { json: false }), null);
  });
});
