'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Accounts live in dev-server/accounts.json under the file store: keep them in a temp folder.
const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-admin-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

// lib/auth.js imports 'next/headers', which only Next's bundler resolves without the extension.
require('node:module').registerHooks({
  resolve: (specifier, context, next) => next(specifier === 'next/headers' ? 'next/headers.js' : specifier, context)
});

const { adminRoute, adminDenied, isSameOriginJson } = require('../lib/admin-api.js');

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ORIGIN = 'https://lms.test';
const admin = { uid: '11111111-1111-4111-8111-111111111111', wid: '22222222-2222-4222-8222-222222222222', ver: 1, email: 'a@x.kr', name: '', role: 'admin' };
const teacher = { ...admin, uid: '33333333-3333-4333-8333-333333333333', email: 't@x.kr', role: 'teacher' };

function post(url, { headers = {}, body = {} } = {}) {
  return new Request(ORIGIN + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: JSON.stringify(body)
  });
}

describe('admin API authorization', () => {
  it('rejects signed-out (401) and non-admin (403) sessions before the handler runs', async () => {
    let ran = 0;
    const handler = async () => { ran += 1; return 'secret'; };
    const signedOut = await adminRoute(handler, async () => null)(post('/api/admin/invites'));
    assert.equal(signedOut.status, 401);
    const asTeacher = await adminRoute(handler, async () => teacher)(post('/api/admin/invites'));
    assert.equal(asTeacher.status, 403);
    assert.equal((await asTeacher.json()).ok, false);
    const getAsTeacher = await adminRoute(handler, async () => teacher)(new Request(ORIGIN + '/api/admin/users'));
    assert.equal(getAsTeacher.status, 403);
    assert.equal(ran, 0);
    const asAdmin = await adminRoute(handler, async () => admin)(post('/api/admin/invites'));
    assert.equal(asAdmin.status, 200);
    assert.deepEqual(await asAdmin.json(), { ok: true, data: 'secret' });
    assert.equal(ran, 1);
  });

  it('rejects cross-site or non-JSON writes even for an admin', () => {
    assert.equal(adminDenied(post('/api/admin/invites', { headers: { Origin: 'https://evil.test' } }), admin).status, 403);
    assert.equal(adminDenied(post('/api/admin/invites', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), admin).status, 403);
    const form = new Request(ORIGIN + '/api/admin/invites', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a@b.c' });
    assert.equal(isSameOriginJson(form), false);
    assert.equal(isSameOriginJson(post('/api/admin/invites', { headers: { 'Sec-Fetch-Site': 'same-origin' } })), true);
    assert.equal(isSameOriginJson(new Request(ORIGIN + '/api/admin/users')), true);
    assert.equal(isSameOriginJson(post('/api/admin/invites', { headers: { Origin: 'null' } })), false, 'opaque origin');
  });

  it('isSameOrigin checks Sec-Fetch-Site and Origin without caring about the body type', async () => {
    const { isSameOrigin } = await import('../lib/same-origin.js');
    const form = (headers) => new Request(ORIGIN + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: 'a=b' });
    assert.equal(isSameOrigin(form({ Origin: ORIGIN })), true);
    assert.equal(isSameOrigin(form({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' })), true);
    assert.equal(isSameOrigin(form({})), true, 'no browser headers (curl, tests)');
    assert.equal(isSameOrigin(form({ Origin: 'https://evil.test' })), false);
    assert.equal(isSameOrigin(form({ Origin: 'null' })), false);
    assert.equal(isSameOrigin(form({ 'Sec-Fetch-Site': 'cross-site' })), false);
    assert.equal(isSameOrigin(form({ 'Sec-Fetch-Site': 'same-site', Origin: 'https://sub.lms.test' })), false);
    assert.equal(isSameOrigin(form({ Origin: 'https://app.example', 'x-forwarded-host': 'app.example' })), true, 'behind a proxy');
  });

  it('turns account errors into 400 with their message and hides other errors', async () => {
    const expose = Object.assign(new Error('이미 등록된 이메일입니다.'), { expose: true, code: 'EMAIL_TAKEN' });
    const known = await adminRoute(async () => { throw expose; }, async () => admin)(post('/api/admin/invites'));
    assert.equal(known.status, 400);
    assert.deepEqual(await known.json(), { ok: false, error: '이미 등록된 이메일입니다.', code: 'EMAIL_TAKEN' });
    const logged = console.error;
    console.error = () => {};
    try {
      const bug = await adminRoute(async () => { throw new TypeError('x is undefined'); }, async () => admin)(post('/api/admin/invites'));
      assert.equal(bug.status, 500);
      assert.equal((await bug.json()).error, '서버 오류가 발생했습니다.');
    } finally {
      console.error = logged;
    }
  });

  it('every admin route answers 401 without a session cookie', async () => {
    const id = admin.uid;
    const ctx = { params: Promise.resolve({ id }) };
    const users = await import('../app/api/admin/users/route.js');
    const invites = await import('../app/api/admin/invites/route.js');
    const disabled = await import('../app/api/admin/users/[id]/disabled/route.js');
    const reset = await import('../app/api/admin/users/[id]/reset/route.js');
    assert.equal((await users.GET(new Request(ORIGIN + '/api/admin/users'))).status, 401);
    assert.equal((await invites.POST(post('/api/admin/invites', { body: { email: 'n@x.kr' } }))).status, 401);
    assert.equal((await disabled.POST(post(`/api/admin/users/${id}/disabled`, { body: { disabled: true } }), ctx)).status, 401);
    assert.equal((await reset.POST(post(`/api/admin/users/${id}/reset`), ctx)).status, 401);
    assert.equal(fs.existsSync(path.join(dataDir, 'dev-server', 'accounts.json')), false);
  });
});
