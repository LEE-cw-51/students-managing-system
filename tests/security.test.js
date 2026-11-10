'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Session versions live in Settings via withService: keep the file store in a temp folder.
// Must run before lib/store.js is loaded.
const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-security-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const {
  clientIp, createMemoryCounters, reserveLoginAttempt, clearLoginAttempts, loginLimitMessage, reserveClientRegistration,
  LOGIN_WINDOW_MS, LOGIN_IP_MAX, LOGIN_GLOBAL_MAX, REGISTER_IP_MAX, REGISTER_GLOBAL_MAX
} = require('../lib/login-limit.js');
const { SESSION_MAX_AGE, readSessionVersion, bumpSessionVersion, sessionValid } = require('../lib/session-version.js');
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
      assert.deepEqual(await reserveLoginAttempt('1.2.3.4', { counters, now: T0 + i * 1000 }), { ok: true });
    }
    const blocked = await reserveLoginAttempt('1.2.3.4', { counters, now: T0 + 60000 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 60000);
    assert.equal((await reserveLoginAttempt('5.6.7.8', { counters, now: T0 + 60000 })).ok, true);
    assert.equal((await reserveLoginAttempt('1.2.3.4', { counters, now: T0 + LOGIN_WINDOW_MS })).ok, true);
  });

  it('a correct password clears the IP count', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < LOGIN_IP_MAX; i += 1) await reserveLoginAttempt('1.2.3.4', { counters, now: T0 });
    await clearLoginAttempts('1.2.3.4', { counters });
    assert.equal((await reserveLoginAttempt('1.2.3.4', { counters, now: T0 + 1 })).ok, true);
  });

  it('caps attempts from all IPs together', async () => {
    const counters = createMemoryCounters();
    for (let i = 0; i < LOGIN_GLOBAL_MAX; i += 1) {
      assert.equal((await reserveLoginAttempt(`10.0.0.${i}`, { counters, now: T0 })).ok, true);
    }
    const blocked = await reserveLoginAttempt('10.0.1.1', { counters, now: T0 + 1000 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterMs, LOGIN_WINDOW_MS - 1000);
  });

  it('counts parallel guesses before any password check', async () => {
    const counters = createMemoryCounters();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveLoginAttempt('1.2.3.4', { counters, now: T0 })));
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
    assert.equal((await reserveLoginAttempt('1.2.3.4', { counters, now: T0 + 1000 })).ok, true, 'login is counted apart');
    assert.equal((await reserveClientRegistration('1.2.3.4', { counters, now: T0 + LOGIN_WINDOW_MS })).ok, true);

    const all = createMemoryCounters();
    for (let i = 0; i < REGISTER_GLOBAL_MAX; i += 1) {
      assert.equal((await reserveClientRegistration(`10.0.0.${i}`, { counters: all, now: T0 })).ok, true);
    }
    assert.equal((await reserveClientRegistration('10.0.1.1', { counters: all, now: T0 })).ok, false);
    assert.equal((await reserveLoginAttempt('10.0.1.1', { counters: all, now: T0 })).ok, true);
  });
});

describe('session expiry and version', () => {
  const NOW = T0 + 1000;
  const DAY = 24 * 60 * 60 * 1000;

  it('accepts a fresh session of the current version and old cookies without a version as 0', () => {
    assert.equal(sessionValid({ ok: true, at: NOW - DAY, sv: '0' }, '0', NOW), true);
    assert.equal(sessionValid({ ok: true, at: NOW - DAY }, '0', NOW), true);
    assert.equal(sessionValid({ ok: true, at: NOW - DAY }, '1', NOW), false);
    assert.equal(sessionValid({ ok: true, at: NOW, sv: '1' }, '2', NOW), false);
  });

  it('expires sessions after SESSION_MAX_AGE (30 days, same as the cookie)', () => {
    assert.equal(SESSION_MAX_AGE, 60 * 60 * 24 * 30);
    assert.equal(sessionValid({ ok: true, at: NOW - 30 * DAY + 1, sv: '0' }, '0', NOW), true);
    assert.equal(sessionValid({ ok: true, at: NOW - 30 * DAY, sv: '0' }, '0', NOW), false);
    assert.equal(sessionValid({ ok: true, sv: '0' }, '0', NOW), false);
    assert.equal(sessionValid({ ok: true, at: NOW + DAY, sv: '0' }, '0', NOW), false);
  });

  it('never takes an OAuth token or an unsigned payload for a session', () => {
    const access = unsign(sign({ typ: 'access', cid: 'c', ver: '0', iat: 1, exp: 2 }, 'token'), 'token');
    assert.equal(sessionValid(access, '0', NOW), false);
    assert.equal(unsign(sign({ ok: true, at: NOW }, 'token'), 'session'), null, 'a token-key signature is no session');
    assert.equal(sessionValid({ ok: true, at: NOW, typ: 'access' }, '0', NOW), false);
    assert.equal(sessionValid(null, '0', NOW), false);
  });

  it('logging out moves the stored version on, so earlier cookies stop working', async () => {
    const before = await readSessionVersion();
    assert.equal(before, '0');
    const payload = { ok: true, at: Date.now(), sv: before };
    assert.equal(sessionValid(payload, await readSessionVersion()), true);
    assert.equal(await bumpSessionVersion(), '1');
    assert.equal(await readSessionVersion(), '1');
    assert.equal(sessionValid(payload, await readSessionVersion()), false);
    assert.equal(sessionValid({ ok: true, at: Date.now() }, await readSessionVersion()), false);
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

  it('requires a JSON body type unless json is false', async () => {
    const form = req({ host: 'lms.example.com', origin: 'https://lms.example.com', 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(guardPost(form).status, 415);
    assert.equal(guardPost(req({ host: 'lms.example.com', 'content-type': 'text/plain' })).status, 415);
    assert.equal(guardPost(form, { json: false }), null);
  });
});
