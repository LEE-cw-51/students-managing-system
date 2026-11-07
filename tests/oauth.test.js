'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// currentTokenVersion reads Settings through withService and tokens are checked against accounts:
// keep the file stores in a temp folder, never in dev-server/. Must run before lib/store.js is loaded.
const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-oauth-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const oauth = require('../lib/oauth.js');
const { sign, unsign } = require('../lib/signing.js');
const { safeNext } = require('../lib/safe-next.js');
const { withService, LMS, DEFAULT_WORKSPACE_ID } = require('../lib/store.js');
const { createMemoryStore } = require('./memory-store.js');
const { bootstrapAdmin, createInvite, acceptInvite, setUserDisabled } = require('../lib/accounts.js');

const {
  registerClient, validateAuthorizeParams, issueAuthorizationCode, exchangeToken, verifyAccessToken,
  pkceChallenge, isAllowedRedirectUri, unauthorizedResponse, currentTokenVersion, CODE_TTL, ACCESS_TTL, REFRESH_TTL
} = oauth;

const sessionOf = ({ user, workspaceId }) => ({ uid: user.id, wid: workspaceId, ver: user.session_version, email: user.email });

/** A teacher invited into a workspace of their own; returns their session. */
async function newTeacher(email) {
  const { token } = await createInvite({ email });
  return sessionOf(await acceptInvite(token, { password: 'teacher-pass-1' }));
}

let admin;
before(async () => {
  admin = sessionOf(await bootstrapAdmin({ email: 'admin@test.local', password: 'admin-pass-1' }));
});

/** Signed claims for a hand-made token of the given session. */
async function claimsOf(session) {
  return { uid: session.uid, wid: session.wid, uv: session.ver, ver: await currentTokenVersion(session.wid) };
}

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'abcdefghijklmnopqrstuvwxyz0123456789-._~ABCDEFG';
const nowSec = () => Math.floor(Date.now() / 1000);

function authorizeParams(clientId, extra = {}) {
  return {
    client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', state: 'st-1',
    code_challenge: pkceChallenge(VERIFIER), code_challenge_method: 'S256', ...extra
  };
}

async function issueCode(session = admin) {
  const { client } = registerClient({ redirect_uris: [REDIRECT], client_name: 'Claude' });
  const params = validateAuthorizeParams(authorizeParams(client.client_id));
  assert.equal(params.error, undefined);
  return { clientId: client.client_id, code: await issueAuthorizationCode(params, session) };
}

async function issueTokens(session = admin) {
  const { clientId, code } = await issueCode(session);
  const out = await exchangeToken({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: REDIRECT });
  assert.ok(out.tokens, JSON.stringify(out));
  return { clientId, tokens: out.tokens };
}

async function bumpTokenVersion(workspaceId = DEFAULT_WORKSPACE_ID) {
  const next = String(Number(await currentTokenVersion(workspaceId)) + 1);
  await withService(workspaceId, (api) => api.saveSettings({ mcp_token_version: next }));
  return next;
}

/** Runs fn with Date.now moved forward by seconds. */
async function later(t, seconds, fn) {
  const real = Date.now();
  t.mock.method(Date, 'now', () => real + seconds * 1000);
  try {
    return await fn();
  } finally {
    Date.now.mock.restore();
  }
}

describe('oauth client registration', () => {
  it('accepts only the claude.ai and claude.com callbacks', () => {
    const ok = registerClient({ redirect_uris: [REDIRECT, 'https://claude.com/api/mcp/auth_callback'] });
    assert.ok(ok.client.client_id);
    assert.equal(ok.client.token_endpoint_auth_method, 'none');
    [
      'https://evil.example/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback/../steal',
      'https://claude.ai.evil.example/api/mcp/auth_callback'
    ].forEach((uri) => {
      const out = registerClient({ redirect_uris: [REDIRECT, uri] });
      assert.equal(out.error, 'invalid_redirect_uri', uri);
      assert.equal(out.client, undefined, uri);
    });
    assert.equal(registerClient({}).error, 'invalid_redirect_uri');
    assert.equal(registerClient({ redirect_uris: [] }).error, 'invalid_redirect_uri');
  });

  it('allows loopback callbacks only outside production', () => {
    assert.equal(isAllowedRedirectUri('http://localhost:6274/oauth/callback'), true);
    process.env.NODE_ENV = 'production';
    try {
      assert.equal(isAllowedRedirectUri('http://localhost:6274/oauth/callback'), false);
      assert.equal(isAllowedRedirectUri(REDIRECT), true);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });
});

describe('oauth authorize', () => {
  it('refuses unknown clients and redirect_uris that were not registered, without redirecting', () => {
    const { client } = registerClient({ redirect_uris: [REDIRECT] });
    assert.equal(validateAuthorizeParams(authorizeParams('forged.client')).fatal, true);
    const tampered = client.client_id.replace(/^./, (c) => (c === 'e' ? 'f' : 'e'));
    assert.equal(validateAuthorizeParams(authorizeParams(tampered)).fatal, true);
    const other = validateAuthorizeParams(authorizeParams(client.client_id, { redirect_uri: 'https://claude.com/api/mcp/auth_callback' }));
    assert.equal(other.fatal, true);
    const evil = validateAuthorizeParams(authorizeParams(client.client_id, { redirect_uri: 'https://evil.example/cb' }));
    assert.equal(evil.fatal, true);
  });

  it('requires response_type=code and an S256 challenge', () => {
    const { client } = registerClient({ redirect_uris: [REDIRECT] });
    const plain = validateAuthorizeParams(authorizeParams(client.client_id, { code_challenge_method: 'plain' }));
    assert.equal(plain.fatal, undefined);
    assert.equal(plain.error, 'invalid_request');
    assert.equal(plain.redirectUri, REDIRECT);
    assert.equal(validateAuthorizeParams(authorizeParams(client.client_id, { code_challenge: '' })).error, 'invalid_request');
    assert.equal(validateAuthorizeParams(authorizeParams(client.client_id, { response_type: 'token' })).error, 'unsupported_response_type');
  });
});

describe('oauth token exchange', () => {
  it('trades a code for tokens with the right PKCE verifier', async () => {
    const { tokens } = await issueTokens();
    assert.equal(tokens.token_type, 'Bearer');
    assert.equal(tokens.expires_in, ACCESS_TTL);
    const payload = await verifyAccessToken(tokens.access_token);
    assert.equal(payload.typ, 'access');
    assert.equal(payload.exp - payload.iat, ACCESS_TTL);
  });

  it('rejects a wrong, missing or malformed verifier', async () => {
    const { clientId, code } = await issueCode();
    const base = { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT };
    for (const verifier of [VERIFIER.replace(/.$/, 'H'), '', 'short', pkceChallenge(VERIFIER), VERIFIER + ' ']) {
      const out = await exchangeToken({ ...base, code_verifier: verifier });
      assert.equal(out.error, 'invalid_grant', verifier);
      assert.equal(out.tokens, undefined, verifier);
    }
    assert.ok((await exchangeToken({ ...base, code_verifier: VERIFIER })).tokens, 'failed attempts do not use up the code');
  });

  it('rejects a code sent with a missing or different client_id or redirect_uri', async () => {
    const { clientId, code } = await issueCode();
    const base = { grant_type: 'authorization_code', code, code_verifier: VERIFIER };
    for (const extra of [
      { client_id: clientId + 'x', redirect_uri: REDIRECT },
      { redirect_uri: REDIRECT },
      { client_id: clientId, redirect_uri: 'https://claude.com/api/mcp/auth_callback' },
      { client_id: clientId },
      { client_id: clientId, redirect_uri: '' }
    ]) {
      const out = await exchangeToken({ ...base, ...extra });
      assert.equal(out.error, 'invalid_grant', JSON.stringify(extra));
      assert.equal(out.tokens, undefined, JSON.stringify(extra));
    }
    assert.ok((await exchangeToken({ ...base, client_id: clientId, redirect_uri: REDIRECT })).tokens);
  });

  it('accepts a code only once', async () => {
    const { clientId, code } = await issueCode();
    const body = { grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: REDIRECT };
    assert.ok((await exchangeToken(body)).tokens);
    const replay = await exchangeToken(body);
    assert.equal(replay.error, 'invalid_grant');
    assert.equal(replay.tokens, undefined);
    const { jti, ...withoutJti } = unsign(code);
    assert.ok(jti);
    const noJti = sign(withoutJti);
    assert.equal((await exchangeToken({ ...body, code: noJti })).error, 'invalid_grant');
  });

  it('rejects an expired code', async (t) => {
    const { clientId, code } = await issueCode();
    const out = await later(t, CODE_TTL + 1, () => exchangeToken({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: REDIRECT }));
    assert.equal(out.error, 'invalid_grant');
  });

  it('refreshes tokens and keeps token kinds apart', async () => {
    const { clientId, tokens } = await issueTokens();
    assert.equal((await exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.access_token })).error, 'invalid_grant');
    assert.equal((await exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: 'other' })).error, 'invalid_grant');
    const refreshed = await exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    assert.ok(await verifyAccessToken(refreshed.tokens.access_token));
    assert.notEqual(refreshed.tokens.refresh_token, tokens.refresh_token);
    assert.equal(await verifyAccessToken(tokens.refresh_token), null);
    assert.equal((await exchangeToken({ grant_type: 'password' })).error, 'unsupported_grant_type');
  });

  it('rotates refresh tokens: an old one is refused, the new one works', async () => {
    const { clientId, tokens } = await issueTokens();
    const first = await exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    assert.ok(first.tokens);
    const reuse = await exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId });
    assert.equal(reuse.error, 'invalid_grant');
    assert.equal(reuse.tokens, undefined);
    const second = await exchangeToken({ grant_type: 'refresh_token', refresh_token: first.tokens.refresh_token, client_id: clientId });
    assert.ok(second.tokens);
    assert.ok(await verifyAccessToken(second.tokens.access_token));
    assert.equal((await exchangeToken({ grant_type: 'refresh_token', refresh_token: first.tokens.refresh_token })).error, 'invalid_grant');
  });

  it('keeps used ids only until they expire', () => {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    assert.equal(api.consumeOAuthJti('a', 1000, 0), true);
    assert.equal(api.consumeOAuthJti('b', 5000, 0), true);
    assert.equal(api.consumeOAuthJti('a', 1000, 500), false);
    assert.equal(api.consumeOAuthJti('', 1000, 500), false);
    assert.equal(api.consumeOAuthJti('c', 9000, 1000), true);
    assert.deepEqual(store.readTable('OAuthJti').map((r) => r.jti), ['b', 'c']);
    assert.equal(api.consumeOAuthJti('b', 5000, 4000), false);
    assert.equal(api.consumeOAuthJti('d', 20000, 10000), true);
    assert.deepEqual(store.readTable('OAuthJti').map((r) => r.jti), ['d']);
  });
});

describe('oauth token expiry and revocation', () => {
  it('rejects expired access and refresh tokens', async (t) => {
    const { tokens } = await issueTokens();
    assert.ok(await later(t, ACCESS_TTL - 5, () => verifyAccessToken(tokens.access_token)));
    assert.equal(await later(t, ACCESS_TTL + 1, () => verifyAccessToken(tokens.access_token)), null);
    const refresh = await later(t, REFRESH_TTL + 1, () => exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }));
    assert.equal(refresh.error, 'invalid_grant');

    const claims = await claimsOf(admin);
    assert.equal(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ...claims, exp: nowSec() - 1 })), null);
    assert.equal(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ...claims })), null, 'no exp');
    assert.ok(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ...claims, exp: nowSec() + 60 })));
  });

  it('rejects forged or garbled tokens', async () => {
    const good = sign({ typ: 'access', cid: 'c', ...(await claimsOf(admin)), exp: nowSec() + 60 });
    const [body] = good.split('.');
    const otherSecret = require('node:crypto').createHmac('sha256', 'other').update(body).digest('base64url');
    for (const token of ['', 'abc', 'a.b', `${body}.${otherSecret}`, `${body}.`, null, undefined]) {
      assert.equal(await verifyAccessToken(token), null, String(token));
    }
  });

  it('cutting the connection invalidates every access token, refresh token and code', async () => {
    const { tokens } = await issueTokens();
    const pending = await issueCode();
    assert.ok(await verifyAccessToken(tokens.access_token));
    await bumpTokenVersion();
    assert.equal(await verifyAccessToken(tokens.access_token), null);
    assert.equal((await exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).error, 'invalid_grant');
    const code = await exchangeToken({ grant_type: 'authorization_code', code: pending.code, code_verifier: VERIFIER, client_id: pending.clientId, redirect_uri: REDIRECT });
    assert.equal(code.error, 'invalid_grant');
    // A fresh connection works again on the new version.
    const fresh = await issueTokens();
    assert.ok(await verifyAccessToken(fresh.tokens.access_token));
  });
});

describe('oauth tokens are bound to a user and workspace', () => {
  it('carries uid, wid and the user version from the code into access and refresh tokens', async () => {
    const teacher = await newTeacher('carry@test.local');
    assert.notEqual(teacher.wid, DEFAULT_WORKSPACE_ID);
    const { clientId, code } = await issueCode(teacher);
    const c = unsign(code);
    assert.deepEqual([c.typ, c.uid, c.wid, c.uv, c.ver], ['code', teacher.uid, teacher.wid, teacher.ver, '0']);
    const out = await exchangeToken({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: REDIRECT });
    for (const token of [out.tokens.access_token, out.tokens.refresh_token]) {
      const p = unsign(token);
      assert.deepEqual([p.cid, p.uid, p.wid, p.uv, p.ver], [clientId, teacher.uid, teacher.wid, teacher.ver, '0']);
    }
    const verified = await verifyAccessToken(out.tokens.access_token);
    assert.equal(verified.wid, teacher.wid);
    assert.equal(verified.user.email, 'carry@test.local');

    const refreshed = await exchangeToken({ grant_type: 'refresh_token', refresh_token: out.tokens.refresh_token, client_id: clientId });
    for (const token of [refreshed.tokens.access_token, refreshed.tokens.refresh_token]) {
      const p = unsign(token);
      assert.deepEqual([p.uid, p.wid, p.uv], [teacher.uid, teacher.wid, teacher.ver]);
    }
    assert.equal((await verifyAccessToken(refreshed.tokens.access_token)).wid, teacher.wid);
  });

  it('needs a signed-in session to issue a code', async () => {
    const { client } = registerClient({ redirect_uris: [REDIRECT] });
    const params = validateAuthorizeParams(authorizeParams(client.client_id));
    await assert.rejects(issueAuthorizationCode(params), /로그인/);
    await assert.rejects(issueAuthorizationCode(params, { uid: admin.uid, wid: 'nope', ver: 1 }), /로그인/);
  });

  it('keeps token versions and used ids per workspace', async () => {
    const teacher = await newTeacher('apart@test.local');
    const mine = await issueTokens(teacher);
    const theirs = await issueTokens(admin);
    await bumpTokenVersion(DEFAULT_WORKSPACE_ID);
    assert.equal(await verifyAccessToken(theirs.tokens.access_token), null);
    assert.ok(await verifyAccessToken(mine.tokens.access_token), 'cutting another workspace leaves this one connected');
    await bumpTokenVersion(teacher.wid);
    assert.equal(await verifyAccessToken(mine.tokens.access_token), null);

    const fresh = await issueTokens(teacher);
    const { jti, exp } = unsign(fresh.tokens.refresh_token);
    assert.ok((await exchangeToken({ grant_type: 'refresh_token', refresh_token: fresh.tokens.refresh_token })).tokens);
    assert.equal(await withService(teacher.wid, (api) => api.consumeOAuthJti(jti, exp * 1000, Date.now())), false, 'used in the teacher workspace');
    assert.equal(await withService(DEFAULT_WORKSPACE_ID, (api) => api.consumeOAuthJti(jti, exp * 1000, Date.now())), true, 'unknown to the default workspace');
  });

  it('rejects the tokens and pending codes of a disabled user, even after re-enabling', async () => {
    const teacher = await newTeacher('disabled@test.local');
    const { clientId, tokens } = await issueTokens(teacher);
    const pending = await issueCode(teacher);
    assert.ok(await verifyAccessToken(tokens.access_token));
    await setUserDisabled(teacher.uid, true);
    assert.equal(await verifyAccessToken(tokens.access_token), null);
    assert.equal((await exchangeToken({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId })).error, 'invalid_grant');
    const code = await exchangeToken({ grant_type: 'authorization_code', code: pending.code, code_verifier: VERIFIER, client_id: pending.clientId, redirect_uri: REDIRECT });
    assert.equal(code.error, 'invalid_grant');
    // Re-enabling bumps the user version, so old grants stay dead; a new consent works.
    const back = await setUserDisabled(teacher.uid, false);
    assert.equal(await verifyAccessToken(tokens.access_token), null);
    const fresh = await issueTokens({ ...teacher, ver: back.session_version });
    assert.ok(await verifyAccessToken(fresh.tokens.access_token));
  });

  it('rejects a token for a workspace the user does not belong to', async () => {
    const teacher = await newTeacher('outsider@test.local');
    const claims = await claimsOf(teacher);
    const exp = nowSec() + 60;
    assert.ok(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ...claims, exp })));
    const ver = await currentTokenVersion(DEFAULT_WORKSPACE_ID);
    assert.equal(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ...claims, wid: DEFAULT_WORKSPACE_ID, ver, exp })), null);
    assert.equal(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ...claims, uv: claims.uv + 1, exp })), null, 'stale user version');
  });

  it('rejects legacy codes and tokens that carry no uid/wid', async () => {
    const ver = await currentTokenVersion(DEFAULT_WORKSPACE_ID);
    const exp = nowSec() + 60;
    assert.equal(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ver, exp })), null);
    assert.equal(await verifyAccessToken(sign({ typ: 'access', cid: 'c', ver, uid: admin.uid, uv: admin.ver, exp })), null, 'no wid');
    const legacyRefresh = sign({ typ: 'refresh', cid: 'c', ver, sc: '', exp, jti: 'legacy-refresh' });
    assert.equal((await exchangeToken({ grant_type: 'refresh_token', refresh_token: legacyRefresh })).error, 'invalid_grant');
    const { clientId, code } = await issueCode();
    const { uid, wid, uv, ...legacyCode } = unsign(code);
    const out = await exchangeToken({ grant_type: 'authorization_code', code: sign(legacyCode), code_verifier: VERIFIER, client_id: clientId, redirect_uri: REDIRECT });
    assert.equal(out.error, 'invalid_grant');
  });
});

describe('oauth 401 response', () => {
  it('points to the protected resource metadata', async () => {
    const res = unauthorizedResponse(new Request('https://lms.example/api/mcp', { headers: { 'x-forwarded-host': 'app.example, proxy', 'x-forwarded-proto': 'https' } }));
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer resource_metadata="https://app.example/.well-known/oauth-protected-resource"');
    assert.match(res.headers.get('Access-Control-Expose-Headers'), /WWW-Authenticate/);
    assert.equal((await res.json()).error, 'invalid_token');
  });
});

describe('safeNext', () => {
  it('keeps same-site paths only', () => {
    assert.equal(safeNext('/oauth/authorize?client_id=a&state=b'), '/oauth/authorize?client_id=a&state=b');
    assert.equal(safeNext('/'), '/');
    ['//evil.example', '//evil.example/path', 'http://evil.example', 'https://evil.example', '/\\evil.example', '\\\\evil.example',
      '/ok\\path', 'javascript:alert(1)', 'evil', '', '/\nset-cookie', '/\tx', null, undefined, 42, ['/a']]
      .forEach((v) => assert.equal(safeNext(v), '', JSON.stringify(v)));
  });
});
