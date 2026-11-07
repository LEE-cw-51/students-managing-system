'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Accounts and workspace data live under dev-server/ with the file store: keep them in a temp folder.
// Must run before lib/store.js is loaded.
const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-accounts-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAIL = 'owner@test.local';
process.env.LMS_PASSWORD = 'legacy-shared-pw';

const stubs = require('./next-stubs.js');
stubs.install();

const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');

// Data from before accounts: the file store keeps the default workspace in dev-server/data.json.
fs.mkdirSync(path.join(dataDir, 'dev-server'), { recursive: true });
seedDemo(LMS.createService(createMemoryStore({ fs, file: path.join(dataDir, 'dev-server', 'data.json') })));

const accounts = require('../lib/accounts.js');
const { hashPassword, verifyPassword, passwordProblem } = require('../lib/password.js');
const auth = require('../lib/auth.js');
const { withService, DEFAULT_WORKSPACE_ID } = require('../lib/store.js');
const { sign } = require('../lib/signing.js');

const {
  authenticate, bootstrapAdmin, createInvite, acceptInvite, peekInvite, createPasswordReset,
  setUserDisabled, workspacesOf, listUsers, findUserByEmail, hashToken, INVITE_TTL_HOURS, RESET_TTL_HOURS
} = accounts;

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const sessionOf = ({ user, workspaceId }) => ({ uid: user.id, wid: workspaceId, ver: user.session_version, email: user.email });
const accountsFile = () => fs.readFileSync(path.join(dataDir, 'dev-server', 'accounts.json'), 'utf8');

/** Runs fn with Date.now moved by ms. */
async function later(t, ms, fn) {
  const real = Date.now();
  t.mock.method(Date, 'now', () => real + ms);
  try {
    return await fn();
  } finally {
    Date.now.mock.restore();
  }
}

async function newTeacher(email, password = 'teacher-pass-1', opts = {}) {
  const { token } = await createInvite({ email, ...opts });
  return sessionOf(await acceptInvite(token, { password }));
}

function setCookie(payload) {
  stubs.jar.set(auth.SESSION_COOKIE, sign(payload));
}

function cookieFor(session, extra = {}) {
  setCookie({ uid: session.uid, wid: session.wid, ver: session.ver, at: Date.now(), ...extra });
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.equal(e.expose, true);
    assert.equal(e.code, code);
    return true;
  });
}

let owner;

describe('first admin (bootstrap)', () => {
  it('only ADMIN_EMAIL + LMS_PASSWORD creates the first admin, who owns the default workspace with the old data', async () => {
    assert.equal((await listUsers()).length, 0);
    assert.equal(await authenticate('owner@test.local', 'wrong-password'), null);
    assert.equal(await authenticate('someone@test.local', 'legacy-shared-pw'), null);
    assert.equal(await authenticate('', 'legacy-shared-pw'), null);
    assert.equal((await listUsers()).length, 0, 'failed attempts create nothing');

    const first = await authenticate(' Owner@Test.local ', 'legacy-shared-pw');
    assert.equal(first.workspaceId, DEFAULT_WORKSPACE_ID);
    assert.equal(first.user.role, 'admin');
    assert.equal(first.user.email, 'owner@test.local');
    owner = sessionOf(first);
    assert.deepEqual((await workspacesOf(owner.uid)).map((w) => [w.id, w.role]), [[DEFAULT_WORKSPACE_ID, 'owner']]);

    const names = await withService(owner.wid, (api) => api.getStudentList({}).map((s) => s.name));
    assert.deepEqual([...names].sort(), ['김철수', '이영희', '홍길동'].sort(), 'pre-account data shows up in the admin workspace');
  });

  it('checks the stored hash afterwards, so LMS_PASSWORD no longer matters', async () => {
    process.env.LMS_PASSWORD = 'changed-later';
    try {
      const again = await authenticate('owner@test.local', 'legacy-shared-pw');
      assert.equal(again.user.id, owner.uid);
      assert.equal(await authenticate('owner@test.local', 'changed-later'), null);
    } finally {
      process.env.LMS_PASSWORD = 'legacy-shared-pw';
    }
  });

  it('refuses once any account exists, through login or the script', async () => {
    await assert.rejects(bootstrapAdmin({ email: 'second@test.local', password: 'second-pass-1' }), /이미 계정이 있습니다/);
    const saved = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = 'second@test.local';
    try {
      assert.equal(await authenticate('second@test.local', 'legacy-shared-pw'), null);
    } finally {
      process.env.ADMIN_EMAIL = saved;
    }
    assert.equal(await findUserByEmail('second@test.local'), null);
    assert.equal((await listUsers()).length, 1);
  });

  it('checks the email and password strength', async () => {
    await assert.rejects(bootstrapAdmin({ email: 'not-an-email', password: 'long-enough-1' }), /이메일/);
    await assert.rejects(bootstrapAdmin({ email: 'x@test.local', password: 'short' }), /8자/);
  });

  it('never lists password hashes', async () => {
    const [user] = await listUsers();
    assert.equal('password_hash' in user, false);
    assert.equal('password_hash' in (await findUserByEmail('owner@test.local')), false);
  });
});

describe('passwords (scrypt)', () => {
  it('hashes with a fresh salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    assert.match(a, /^scrypt\$16384\$8\$1\$[\w-]{22}\$[\w-]{86}$/);
    assert.notEqual(a, b, 'salted');
    assert.equal(await verifyPassword('correct horse', a), true);
    assert.equal(await verifyPassword('correct horse', b), true);
    for (const wrong of ['correct horsE', 'correct horse ', '', 'x']) {
      assert.equal(await verifyPassword(wrong, a), false, JSON.stringify(wrong));
    }
  });

  it('treats malformed or foreign hashes as a mismatch without throwing', async () => {
    const good = await hashPassword('pw-12345678');
    const parts = good.split('$');
    for (const stored of ['', 'plain-text', '$2b$10$abcdefghijklmnopqrstuv', 'scrypt$16384$8$1$salt$', parts.slice(0, 5).join('$'), `md5$${parts.slice(1).join('$')}`]) {
      assert.equal(await verifyPassword('pw-12345678', stored), false, stored);
    }
  });

  it('runs scrypt and a timing-safe compare even when there is no user', async (t) => {
    const scrypt = t.mock.method(crypto, 'scrypt');
    const compare = t.mock.method(crypto, 'timingSafeEqual');
    assert.equal(await verifyPassword('anything', null), false);
    assert.equal(scrypt.mock.callCount(), 1);
    assert.equal(compare.mock.callCount(), 1);
    assert.equal(await verifyPassword('anything', await hashPassword('other-pass')), false);
    assert.equal(compare.mock.callCount(), 2, 'a wrong password goes through the same compare');
  });

  it('unknown emails cost a scrypt run too', async (t) => {
    const scrypt = t.mock.method(crypto, 'scrypt');
    assert.equal(await authenticate('nobody@test.local', 'some-password'), null);
    assert.ok(scrypt.mock.callCount() >= 1);
  });

  it('needs 8 to 200 characters', () => {
    assert.match(passwordProblem('1234567'), /8자/);
    assert.equal(passwordProblem('12345678'), '');
    assert.match(passwordProblem('x'.repeat(201)), /너무 깁니다/);
    assert.match(passwordProblem(undefined), /8자/);
  });
});

describe('invite links', () => {
  it('give the invitee a workspace of their own by default, or join the given one', async () => {
    const own = await newTeacher('own@test.local');
    assert.notEqual(own.wid, DEFAULT_WORKSPACE_ID);
    assert.deepEqual((await workspacesOf(own.uid)).map((w) => [w.id, w.role]), [[own.wid, 'owner']]);
    const joined = await newTeacher('joined@test.local', 'teacher-pass-1', { workspaceId: DEFAULT_WORKSPACE_ID });
    assert.equal(joined.wid, DEFAULT_WORKSPACE_ID);
    assert.deepEqual((await workspacesOf(joined.uid)).map((w) => [w.id, w.role]), [[DEFAULT_WORKSPACE_ID, 'member']]);
  });

  it('expire after INVITE_TTL_HOURS, and a refused attempt does not use them up', async (t) => {
    const { token, expiresAt } = await createInvite({ email: 'late@test.local' });
    assert.ok(Math.abs(Date.parse(expiresAt) - (Date.now() + INVITE_TTL_HOURS * HOUR)) < 5000);
    assert.ok(await later(t, INVITE_TTL_HOURS * HOUR - 60 * 1000, () => peekInvite(token)), 'still open just before');
    assert.equal(await later(t, INVITE_TTL_HOURS * HOUR + 1000, () => peekInvite(token)), null);
    await later(t, INVITE_TTL_HOURS * HOUR + 1000, () => rejectsWith(acceptInvite(token, { password: 'late-pass-1' }), 'INVITE_INVALID'));
    assert.equal(await findUserByEmail('late@test.local'), null);
    await assert.rejects(acceptInvite(token, { password: 'short' }), /8자/);
    assert.equal((await peekInvite(token)).email, 'late@test.local', 'weak password leaves the link open');
    assert.ok(await acceptInvite(token, { password: 'late-pass-1' }));
  });

  it('work once', async () => {
    const { token } = await createInvite({ email: 'once@test.local', name: '한번' });
    assert.deepEqual(await peekInvite(token), { purpose: 'invite', email: 'once@test.local', name: '한번', role: 'teacher', expires_at: (await peekInvite(token)).expires_at });
    const first = await acceptInvite(token, { password: 'once-pass-1' });
    assert.equal(first.user.name, '한번');
    assert.equal(await peekInvite(token), null);
    await rejectsWith(acceptInvite(token, { password: 'again-pass-1' }), 'INVITE_INVALID');
    assert.equal((await authenticate('once@test.local', 'once-pass-1')).user.id, first.user.id);
    assert.equal(await authenticate('once@test.local', 'again-pass-1'), null);
  });

  it('a newer invite for the same email closes the older one', async () => {
    const older = await createInvite({ email: 'twice@test.local' });
    const newer = await createInvite({ email: 'Twice@Test.local' });
    assert.equal(await peekInvite(older.token), null);
    await rejectsWith(acceptInvite(older.token, { password: 'twice-pass-1' }), 'INVITE_INVALID');
    assert.ok(await acceptInvite(newer.token, { password: 'twice-pass-1' }));
  });

  it('refuses registered emails, bad roles and bad emails', async () => {
    await rejectsWith(createInvite({ email: 'OWNER@test.local' }), 'EMAIL_TAKEN');
    await assert.rejects(createInvite({ email: 'role@test.local', role: 'owner' }), /역할/);
    await assert.rejects(createInvite({ email: 'nope' }), /이메일/);
    await assert.rejects(createInvite({ email: 'ws@test.local', workspaceId: '../etc' }), /작업공간/);
  });

  it('stores only the token hash', async () => {
    const { token } = await createInvite({ email: 'hash@test.local' });
    const file = accountsFile();
    assert.equal(file.includes(token), false);
    assert.ok(file.includes(hashToken(token)));
  });

  it('unknown or empty tokens are refused', async () => {
    assert.equal(await peekInvite(''), null);
    assert.equal(await peekInvite('made-up-token'), null);
    await rejectsWith(acceptInvite('made-up-token', { password: 'whatever-1' }), 'INVITE_INVALID');
  });
});

describe('password reset links', () => {
  it('set a new password once and sign the user out everywhere', async () => {
    const teacher = await newTeacher('reset@test.local', 'old-pass-123');
    cookieFor(teacher);
    assert.equal((await auth.getSession()).uid, teacher.uid);

    const stale = await createPasswordReset({ userId: teacher.uid, createdBy: owner.uid });
    const link = await createPasswordReset({ userId: teacher.uid, createdBy: owner.uid });
    assert.equal(await peekInvite(stale.token), null, 'a newer reset link closes the older one');
    assert.equal((await peekInvite(link.token)).purpose, 'reset');

    const done = await acceptInvite(link.token, { password: 'new-pass-123' });
    assert.equal(done.user.id, teacher.uid);
    assert.equal(done.workspaceId, teacher.wid);
    assert.equal(done.user.session_version, teacher.ver + 1);
    assert.equal(await auth.getSession(), null, 'the old session cookie stops working');
    assert.equal(await authenticate('reset@test.local', 'old-pass-123'), null);
    assert.equal((await authenticate('reset@test.local', 'new-pass-123')).user.id, teacher.uid);
    await rejectsWith(acceptInvite(link.token, { password: 'third-pass-123' }), 'INVITE_INVALID');
  });

  it('expire after RESET_TTL_HOURS', async (t) => {
    const teacher = await newTeacher('reset-late@test.local');
    const { token } = await createPasswordReset({ userId: teacher.uid });
    assert.equal(await later(t, RESET_TTL_HOURS * HOUR + 1000, () => peekInvite(token)), null);
  });

  it('cannot be used by a disabled account', async () => {
    const teacher = await newTeacher('reset-off@test.local', 'old-pass-123');
    const { token } = await createPasswordReset({ userId: teacher.uid });
    await setUserDisabled(teacher.uid, true);
    await assert.rejects(acceptInvite(token, { password: 'new-pass-123' }), /사용할 수 없는 계정/);
    await setUserDisabled(teacher.uid, false);
    assert.ok(await authenticate('reset-off@test.local', 'old-pass-123'), 'password unchanged');
  });

  it('an invite for a new email does not close reset links', async () => {
    const teacher = await newTeacher('mixed@test.local');
    const { token } = await createPasswordReset({ userId: teacher.uid });
    await createInvite({ email: 'mixed-other@test.local' });
    assert.ok(await peekInvite(token));
  });
});

describe('getSession', () => {
  let teacher;
  before(async () => {
    teacher = await newTeacher('session@test.local');
  });

  it('returns the signed-in user and workspace', async () => {
    cookieFor(teacher);
    const s = await auth.getSession();
    assert.deepEqual(
      { uid: s.uid, wid: s.wid, ver: s.ver, email: s.email, role: s.role },
      { uid: teacher.uid, wid: teacher.wid, ver: teacher.ver, email: 'session@test.local', role: 'teacher' }
    );
  });

  it('rejects missing, garbled, forged and pre-account cookies', async () => {
    stubs.jar.clear();
    assert.equal(await auth.getSession(), null);
    stubs.jar.set(auth.SESSION_COOKIE, 'garbage');
    assert.equal(await auth.getSession(), null);
    const body = Buffer.from(JSON.stringify({ uid: teacher.uid, wid: teacher.wid, ver: teacher.ver, at: Date.now() })).toString('base64url');
    const mac = crypto.createHmac('sha256', 'other-secret').update(body).digest('base64url');
    stubs.jar.set(auth.SESSION_COOKIE, `${body}.${mac}`);
    assert.equal(await auth.getSession(), null, 'forged');
    setCookie({ ok: true, at: Date.now() });
    assert.equal(await auth.getSession(), null, 'shared-password era cookie');
    setCookie({ uid: teacher.uid, wid: teacher.wid, ver: teacher.ver });
    assert.equal(await auth.getSession(), null, 'no timestamp');
  });

  it('rejects an expired cookie', async () => {
    cookieFor(teacher, { at: Date.now() - 29 * DAY });
    assert.ok(await auth.getSession());
    cookieFor(teacher, { at: Date.now() - 31 * DAY });
    assert.equal(await auth.getSession(), null);
  });

  it('rejects a stale session version', async () => {
    cookieFor(teacher, { ver: teacher.ver + 1 });
    assert.equal(await auth.getSession(), null);
    cookieFor(teacher, { ver: teacher.ver - 1 });
    assert.equal(await auth.getSession(), null);
    cookieFor(teacher, { ver: String(teacher.ver) });
    assert.ok(await auth.getSession(), 'a numeric string is the same version');
  });

  it('rejects a workspace the user is not a member of', async () => {
    cookieFor(teacher, { wid: DEFAULT_WORKSPACE_ID });
    assert.equal(await auth.getSession(), null);
    cookieFor(teacher, { wid: crypto.randomUUID() });
    assert.equal(await auth.getSession(), null);
    cookieFor(teacher, { wid: 'not-a-uuid' });
    assert.equal(await auth.getSession(), null);
    cookieFor(teacher, { uid: crypto.randomUUID() });
    assert.equal(await auth.getSession(), null, 'unknown user');
  });

  it('rejects a disabled user, and the old cookie stays dead after re-enabling', async () => {
    const gone = await newTeacher('session-off@test.local');
    cookieFor(gone);
    assert.ok(await auth.getSession());
    await setUserDisabled(gone.uid, true);
    assert.equal(await auth.getSession(), null);
    await setUserDisabled(gone.uid, false);
    assert.equal(await auth.getSession(), null);
  });
});

describe('login', () => {
  const routeP = import('../app/api/login/route.js');
  let n = 0;
  const freshIp = () => `10.0.0.${++n}`;

  function login(email, password, ip) {
    return new Request('https://lms.test/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${ip}, 172.16.0.1` },
      body: JSON.stringify({ email, password })
    });
  }

  before(async () => {
    await newTeacher('login@test.local', 'login-pass-1');
    await newTeacher('login2@test.local', 'login-pass-1');
  });

  // Runs first, on an empty failure list: 5000 expired entries fill it exactly.
  it('a flood of expired entries does not wipe a live block', () => {
    const now = 2_000_000_000_000;
    for (let i = 0; i < 2500; i += 1) auth.noteLoginFailure([`ip:old-${i}`, `email:old-${i}@test.local`], now - 16 * 60 * 1000);
    const target = ['ip:3.3.3.3', 'email:target@test.local'];
    for (let i = 0; i < 10; i += 1) auth.noteLoginFailure(target, now);
    assert.equal(auth.loginBlocked(target, now), true);
  });

  it('counts failures per email and per IP over 15 minutes, and a success clears the email count', () => {
    const now = 1_000_000_000_000;
    const email = ['ip:1.1.1.1', 'email:limit@test.local'];
    for (let i = 0; i < 9; i += 1) auth.noteLoginFailure(email, now);
    assert.equal(auth.loginBlocked(email, now), false);
    auth.noteLoginFailure(email, now);
    assert.equal(auth.loginBlocked(email, now), true, '10 failures for one email');
    assert.equal(auth.loginBlocked(['ip:1.1.1.1', 'email:other@test.local'], now), false, 'the IP is under its own limit');
    assert.equal(auth.loginBlocked(email, now + 15 * 60 * 1000 + 1), false, 'the window slides');
    auth.clearLoginFailures(email);
    assert.equal(auth.loginBlocked(email, now), false);

    for (let i = 0; i < 30; i += 1) auth.noteLoginFailure(['ip:2.2.2.2', `email:spray${i}@test.local`], now);
    assert.equal(auth.loginBlocked(['ip:2.2.2.2', 'email:new@test.local'], now), true, '30 failures from one IP');
    auth.clearLoginFailures(['ip:2.2.2.2', 'email:spray0@test.local']);
    assert.equal(auth.loginBlocked(['ip:2.2.2.2', 'email:new@test.local'], now), true, 'a success does not clear the IP count');
  });

  it('keys on the first forwarded address and the normalised email', () => {
    const req = new Request('https://lms.test/api/login', { headers: { 'x-forwarded-for': ' 9.9.9.9 , 10.0.0.1' } });
    assert.deepEqual(auth.loginKeys(req, ' Mixed@Case.KR '), ['ip:9.9.9.9', 'email:mixed@case.kr']);
    assert.deepEqual(auth.loginKeys(new Request('https://lms.test/'), ''), ['ip:unknown', 'email:']);
  });

  it('signs in with the right password and sets a session for the user workspace', async () => {
    const { POST } = await routeP;
    stubs.jar.clear();
    const res = await POST(login('LOGIN@test.local', 'login-pass-1', freshIp()));
    assert.equal(res.status, 200);
    const s = await auth.getSession();
    assert.equal(s.email, 'login@test.local');
    assert.notEqual(s.wid, DEFAULT_WORKSPACE_ID);
  });

  it('answers 401 for a wrong password, an unknown email or a disabled account', async () => {
    const { POST } = await routeP;
    stubs.jar.clear();
    assert.equal((await POST(login('login@test.local', 'wrong-pass-1', freshIp()))).status, 401);
    assert.equal((await POST(login('ghost@test.local', 'login-pass-1', freshIp()))).status, 401);
    const off = await newTeacher('login-off@test.local', 'login-pass-1');
    await setUserDisabled(off.uid, true);
    assert.equal((await POST(login('login-off@test.local', 'login-pass-1', freshIp()))).status, 401);
    assert.equal(stubs.jar.size, 0, 'no cookie on failure');
  });

  it('blocks an email after 10 failures, even with the right password, until the window passes', async (t) => {
    const { POST } = await routeP;
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await POST(login('login2@test.local', `wrong-${i}-pass`, freshIp()))).status, 401);
    }
    stubs.jar.clear();
    const blocked = await POST(login('login2@test.local', 'login-pass-1', freshIp()));
    assert.equal(blocked.status, 429);
    assert.equal(stubs.jar.size, 0);
    const later15 = await later(t, 15 * 60 * 1000 + 1000, () => POST(login('login2@test.local', 'login-pass-1', freshIp())));
    assert.equal(later15.status, 200);
  });

  it('a form post redirects back to /login with an error code and keeps a safe next', async () => {
    const { POST } = await routeP;
    const form = (fields) => new Request('https://lms.test/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-forwarded-for': freshIp() },
      body: new URLSearchParams(fields).toString()
    });
    const bad = await POST(form({ email: 'login@test.local', password: 'nope-nope', next: '//evil.example' }));
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get('Location'), '/login?error=1');
    const ok = await POST(form({ email: 'login@test.local', password: 'login-pass-1', next: '/students' }));
    assert.equal(ok.headers.get('Location'), '/students');
  });
});
