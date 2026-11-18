'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-identity-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'owner@test.local';
process.env.LMS_PASSWORD = 'legacy-shared-pw';

const stubs = require('./next-stubs.js');
stubs.install();

const accounts = require('../lib/accounts.js');
const identity = require('../lib/identity.js');
const { createMemoryCounters, LOGIN_IP_MAX } = require('../lib/login-limit.js');

const { bootstrapAdmin, createInvite, findUserByEmail } = accounts;

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function headers(ip = '203.0.113.10') {
  return new Headers({ 'x-real-ip': ip });
}

describe('identity.authenticateBrowser', () => {
  let owner;

  before(async () => {
    owner = await bootstrapAdmin({ email: 'owner@test.local', password: 'owner-pass-1', name: 'Owner' });
    const { token } = await createInvite({ email: 'id-login@test.local', createdBy: owner.user.id });
    await accounts.acceptInvite(token, { password: 'id-login-pass' });
  });

  it('signs in, sets session and device cookie, and clears the attempt bucket', async () => {
    const counters = createMemoryCounters();
    stubs.jar.clear();
    const ip = '203.0.113.1';
    for (let i = 0; i < LOGIN_IP_MAX - 1; i += 1) {
      assert.equal((await identity.authenticateBrowser(
        { email: 'ghost@test.local', password: 'wrong-pass-1', headers: headers(ip) },
        { counters }
      )).reason, 'bad_credentials');
    }
    const ok = await identity.authenticateBrowser(
      { email: 'id-login@test.local', password: 'id-login-pass', headers: headers(ip) },
      { counters }
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.user.email, 'id-login@test.local');
    const session = await identity.getSession();
    assert.equal(session.email, 'id-login@test.local');
    assert.equal(session.wid, ok.workspaceId);
    const user = await findUserByEmail('id-login@test.local');
    assert.equal(identity.deviceTokenFor(stubs.jar.get(identity.DEVICE_COOKIE), 'id-login@test.local', user.token_version), true);
    // Success refunds one IP hit; earlier wrong guesses remain, so one more wrong guess is still allowed.
    const after = await identity.authenticateBrowser(
      { email: 'ghost2@test.local', password: 'wrong-pass-1', headers: headers(ip) },
      { counters }
    );
    assert.equal(after.reason, 'bad_credentials');
  });

  it('returns limited when the IP bucket is full, without setting cookies', async () => {
    const counters = createMemoryCounters();
    stubs.jar.clear();
    const ip = '203.0.113.2';
    for (let i = 0; i < LOGIN_IP_MAX; i += 1) {
      assert.equal((await identity.authenticateBrowser(
        { email: `g${i}@test.local`, password: 'wrong-pass-1', headers: headers(ip) },
        { counters }
      )).reason, 'bad_credentials');
    }
    const blocked = await identity.authenticateBrowser(
      { email: 'id-login@test.local', password: 'id-login-pass', headers: headers(ip) },
      { counters }
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'limited');
    assert.ok(blocked.retryAfterMs > 0);
    assert.equal(stubs.jar.size, 0);
    assert.equal(await identity.getSession(), null);
  });

  it('counts a known device under the device bucket, not IP', async () => {
    const counters = createMemoryCounters();
    stubs.jar.clear();
    const ip = '203.0.113.3';
    assert.equal((await identity.authenticateBrowser(
      { email: 'id-login@test.local', password: 'id-login-pass', headers: headers(ip) },
      { counters }
    )).ok, true);
    const deviceCookie = stubs.jar.get(identity.DEVICE_COOKIE);
    stubs.jar.clear();
    for (let i = 0; i < LOGIN_IP_MAX; i += 1) {
      assert.equal((await identity.authenticateBrowser(
        { email: 'colleague@test.local', password: 'wrong-pass-1', headers: headers(ip) },
        { counters }
      )).reason, 'bad_credentials');
    }
    assert.equal((await identity.authenticateBrowser(
      { email: 'id-login@test.local', password: 'id-login-pass', headers: headers(ip) },
      { counters }
    )).reason, 'limited');
    stubs.jar.set(identity.DEVICE_COOKIE, deviceCookie);
    assert.equal((await identity.authenticateBrowser(
      { email: 'id-login@test.local', password: 'id-login-pass', headers: headers(ip) },
      { counters }
    )).ok, true);
  });

  it('rejects a wrong password without issuing a session', async () => {
    stubs.jar.clear();
    const counters = createMemoryCounters();
    const bad = await identity.authenticateBrowser(
      { email: 'id-login@test.local', password: 'nope-nope-1', headers: headers('203.0.113.4') },
      { counters }
    );
    assert.deepEqual(bad, { ok: false, reason: 'bad_credentials' });
    assert.equal(stubs.jar.size, 0);
  });
});

describe('identity.acceptInviteAndSignIn', () => {
  let ownerId;

  before(async () => {
    ownerId = (await findUserByEmail('owner@test.local')).id;
  });

  it('accepts a link, signs in, and remembers the device', async () => {
    const { token } = await createInvite({ email: 'id-invite@test.local', createdBy: ownerId });
    stubs.jar.clear();
    const counters = createMemoryCounters();
    const result = await identity.acceptInviteAndSignIn(
      token,
      { password: 'invite-pass-1', name: 'Invited' },
      headers('203.0.113.20'),
      { counters }
    );
    assert.equal(result.ok, true);
    assert.equal(result.user.email, 'id-invite@test.local');
    assert.equal((await identity.getSession()).email, 'id-invite@test.local');
    const user = await findUserByEmail('id-invite@test.local');
    assert.equal(identity.deviceTokenFor(stubs.jar.get(identity.DEVICE_COOKIE), 'id-invite@test.local', user.token_version), true);
  });

  it('maps a weak password and leaves no session cookie', async () => {
    const { token } = await createInvite({ email: 'id-weak@test.local', createdBy: ownerId });
    stubs.jar.clear();
    const counters = createMemoryCounters();
    const result = await identity.acceptInviteAndSignIn(
      token,
      { password: 'short' },
      headers('203.0.113.21'),
      { counters }
    );
    assert.deepEqual(result, { ok: false, reason: 'weak' });
    assert.equal(stubs.jar.size, 0);
  });

  it('returns limited when the invite IP bucket is full', async () => {
    const counters = createMemoryCounters();
    const ip = '203.0.113.22';
    for (let i = 0; i < 20; i += 1) {
      const r = await identity.acceptInviteAndSignIn(
        'x'.repeat(43),
        { password: 'whatever-1' },
        headers(ip),
        { counters }
      );
      assert.equal(r.reason, 'invalid');
    }
    const { token } = await createInvite({ email: 'id-limit@test.local', createdBy: ownerId });
    stubs.jar.clear();
    const blocked = await identity.acceptInviteAndSignIn(
      token,
      { password: 'invite-pass-1' },
      headers(ip),
      { counters }
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'limited');
    assert.equal(stubs.jar.size, 0);
  });
});

describe('identity session helpers', () => {
  it('exposes loadSessionUser / loadGrantUser for the same version checks', async () => {
    const user = await findUserByEmail('id-login@test.local');
    const spaces = await accounts.workspacesOf(user.id);
    const wid = spaces[0].id;
    assert.ok(await identity.loadSessionUser({ uid: user.id, wid, ver: user.session_version }));
    assert.equal(await identity.loadSessionUser({ uid: user.id, wid, ver: user.session_version + 1 }), null);
    assert.ok(await identity.loadGrantUser({ uid: user.id, wid, uv: user.token_version }));
    assert.equal(await identity.loadGrantUser({ uid: user.id, wid, uv: user.token_version + 1 }), null);
  });
});
