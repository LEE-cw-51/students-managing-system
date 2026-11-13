import crypto from 'node:crypto';
import { sign, unsign } from './signing.js';
import { loadSessionUser } from './accounts.js';
import { isWorkspaceId, serviceRunner, withService } from './store.js';

export const CODE_TTL = 5 * 60;
export const ACCESS_TTL = 60 * 60;
export const REFRESH_TTL = 30 * 24 * 60 * 60;

const ALLOWED_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback'
];

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400'
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function firstHeader(value) {
  return String(value || '').split(',')[0].trim();
}

export function baseUrl(req) {
  const host = firstHeader(req.headers.get('x-forwarded-host')) || firstHeader(req.headers.get('host'));
  if (host) {
    const proto = firstHeader(req.headers.get('x-forwarded-proto')) || new URL(req.url).protocol.replace(':', '');
    return `${proto}://${host}`;
  }
  return new URL(req.url).origin;
}

export function resourceUrl(req) {
  return `${baseUrl(req)}/api/mcp`;
}

export function resourceMetadataUrl(req) {
  return `${baseUrl(req)}/.well-known/oauth-protected-resource`;
}

export function protectedResourceMetadata(req) {
  const base = baseUrl(req);
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    resource_name: '학생 관리 시스템'
  };
}

export function authorizationServerMetadata(req) {
  const base = baseUrl(req);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none']
  };
}

export function corsJson(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...extraHeaders }
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function oauthError(error, description, status = 400) {
  const body = { error };
  if (description) body.error_description = description;
  return corsJson(body, status);
}

export function unauthorizedResponse(req) {
  return Response.json(
    { error: 'invalid_token', error_description: '유효한 액세스 토큰이 필요합니다.' },
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Expose-Headers': 'WWW-Authenticate',
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl(req)}"`
      }
    }
  );
}

function isLoopbackDevUri(uri) {
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch (e) {
    return false;
  }
}

export function isAllowedRedirectUri(uri) {
  if (typeof uri !== 'string' || !uri) return false;
  return ALLOWED_REDIRECT_URIS.includes(uri) || isLoopbackDevUri(uri);
}

function tokenVersionOf(api) {
  const value = api.getSettings().mcp_token_version;
  return String(value == null || value === '' ? '0' : value);
}

/** The workspace's mcp_token_version ("연결 끊기" bumps it), as a string. */
export async function currentTokenVersion(workspaceId) {
  return withService(workspaceId, tokenVersionOf);
}

/** The user a code or token was granted to, or null when disabled, removed from wid, or signed out. */
async function grantUser(payload) {
  if (!payload || !isWorkspaceId(payload.wid) || !isWorkspaceId(payload.uid)) return null;
  return loadSessionUser({ uid: payload.uid, wid: payload.wid, ver: payload.uv });
}

/** withService bound to the token's workspace, with changes noted as the token's user. */
export function tokenRunner(auth) {
  return serviceRunner(auth.wid, { userEmail: auth.user.email });
}

// Signing purpose (lib/signing.js) of each OAuth token kind.
const PURPOSE_OF_TYP = { code: 'code', access: 'token', refresh: 'token' };

function verifyTyped(token, typ) {
  const payload = unsign(token, PURPOSE_OF_TYP[typ]);
  if (!payload || payload.typ !== typ) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec()) return null;
  return payload;
}

export function registerClient(body) {
  const uris = body && Array.isArray(body.redirect_uris) ? body.redirect_uris : null;
  if (!uris || !uris.length) {
    return { error: 'invalid_redirect_uri', error_description: 'redirect_uris가 필요합니다.' };
  }
  const bad = uris.find((u) => !isAllowedRedirectUri(u));
  if (bad !== undefined) {
    return { error: 'invalid_redirect_uri', error_description: `허용되지 않은 redirect_uri입니다: ${bad}` };
  }
  const name = String((body && body.client_name) || 'Claude').slice(0, 100);
  const issuedAt = nowSec();
  const clientId = sign({ typ: 'client', ru: uris, name, iat: issuedAt }, 'client');
  return {
    client: {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  };
}

export function verifyClient(clientId) {
  const payload = unsign(clientId, 'client');
  if (!payload || payload.typ !== 'client' || !Array.isArray(payload.ru)) return null;
  return payload;
}

/** Validates /oauth/authorize query params; `fatal` errors must not be redirected back to the client. */
export function validateAuthorizeParams(params) {
  const get = (k) => {
    const v = params ? params[k] : undefined;
    return typeof v === 'string' ? v : Array.isArray(v) ? String(v[0] || '') : '';
  };
  const clientId = get('client_id');
  const client = verifyClient(clientId);
  if (!client) return { fatal: true, error: '등록되지 않은 클라이언트입니다.' };
  let redirectUri = get('redirect_uri');
  if (!redirectUri && client.ru.length === 1) redirectUri = client.ru[0];
  if (!redirectUri || !client.ru.includes(redirectUri) || !isAllowedRedirectUri(redirectUri)) {
    return { fatal: true, error: '허용되지 않은 redirect_uri입니다.' };
  }
  const state = get('state');
  const base = { clientId, clientName: client.name || 'Claude', redirectUri, state };
  if (get('response_type') !== 'code') {
    return { ...base, error: 'unsupported_response_type', description: 'response_type은 code여야 합니다.' };
  }
  const codeChallenge = get('code_challenge');
  if (!codeChallenge || get('code_challenge_method') !== 'S256') {
    return { ...base, error: 'invalid_request', description: 'PKCE(S256) code_challenge가 필요합니다.' };
  }
  return { ...base, codeChallenge, scope: get('scope'), resource: get('resource') };
}

export function redirectWithParams(redirectUri, params) {
  const url = new URL(redirectUri);
  Object.entries(params).forEach(([k, v]) => {
    if (v) url.searchParams.set(k, v);
  });
  return url.toString();
}

/**
 * Code for the signed-in user's workspace. session: { uid, wid, ver } from getSession();
 * uv is the user's session version, so a password reset or disabling the user also cuts the connector.
 */
export async function issueAuthorizationCode({ clientId, redirectUri, codeChallenge, scope, resource }, session) {
  if (!session || !isWorkspaceId(session.uid) || !isWorkspaceId(session.wid)) throw new Error('로그인이 필요합니다.');
  const ver = await currentTokenVersion(session.wid);
  return sign({
    typ: 'code',
    cid: clientId,
    ru: redirectUri,
    cc: codeChallenge,
    sc: scope || '',
    res: resource || '',
    uid: session.uid,
    wid: session.wid,
    uv: Number(session.ver),
    ver,
    exp: nowSec() + CODE_TTL,
    jti: crypto.randomUUID()
  }, 'code');
}

export function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(String(verifier)).digest('base64url');
}

function pkceOk(verifier, challenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(String(challenge || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Access and refresh tokens for the same user, workspace, versions and connection (gid) as the grant. */
function issueTokens(grant, gid, now) {
  const sc = grant.sc || '';
  const claims = { cid: grant.cid, uid: grant.uid, wid: grant.wid, uv: Number(grant.uv), gid, ver: String(grant.ver), sc };
  return {
    access_token: sign({ typ: 'access', ...claims, iat: now, exp: now + ACCESS_TTL }, 'token'),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: sign({ typ: 'refresh', ...claims, iat: now, exp: now + REFRESH_TTL, jti: crypto.randomUUID() }, 'token'),
    ...(sc ? { scope: sc } : {})
  };
}

/**
 * Spends a code or refresh token in one transaction of its workspace: checks the user, the
 * workspace's token version and the connection, marks its jti used and records the connection
 * until the new refresh token expires. The connection id of a code is the code's jti. A jti seen
 * before means the token was replayed (stolen, or the first answer was lost), so the connection
 * is cut. Grants without uid/wid (issued before accounts) or gid are 'revoked'.
 * Returns { state: 'ok', gid } | { state: 'revoked' } | { state: 'used' }.
 */
async function redeemGrant(payload, issuedAt) {
  if (typeof payload.jti !== 'string' || !payload.jti) return { state: 'used' };
  if (!(await grantUser(payload))) return { state: 'revoked' };
  const gid = payload.typ === 'code' ? payload.jti : typeof payload.gid === 'string' ? payload.gid : '';
  if (!gid) return { state: 'revoked' };
  const client = verifyClient(payload.cid);
  const now = Date.now();
  return withService(payload.wid, (api) => {
    if (String(payload.ver) !== tokenVersionOf(api)) return { state: 'revoked' };
    if (payload.typ !== 'code' && !api.hasOAuthGrant(gid, now)) return { state: 'revoked' };
    if (!api.consumeOAuthJti(payload.jti, payload.exp * 1000, now)) {
      api.revokeMcpConnection(gid);
      return { state: 'used' };
    }
    api.saveOAuthGrant({ grant_id: gid, client_name: client ? client.name : '', exp_ms: (issuedAt + REFRESH_TTL) * 1000 }, now);
    return { state: 'ok', gid };
  });
}

/** Handles a token request body; returns { tokens } or { error, error_description }. */
export async function exchangeToken(params) {
  const get = (k) => (params && params[k] != null ? String(params[k]) : '');
  const grantType = get('grant_type');
  if (grantType === 'authorization_code') {
    const code = verifyTyped(get('code'), 'code');
    if (!code) return { error: 'invalid_grant', error_description: '인가 코드가 유효하지 않거나 만료되었습니다.' };
    if (get('client_id') !== code.cid) {
      return { error: 'invalid_grant', error_description: 'client_id가 일치하지 않습니다.' };
    }
    if (get('redirect_uri') !== code.ru) {
      return { error: 'invalid_grant', error_description: 'redirect_uri가 일치하지 않습니다.' };
    }
    if (!pkceOk(get('code_verifier'), code.cc)) {
      return { error: 'invalid_grant', error_description: 'PKCE 검증에 실패했습니다.' };
    }
    const now = nowSec();
    const grant = await redeemGrant(code, now);
    if (grant.state === 'revoked') return { error: 'invalid_grant', error_description: '연결이 해제된 인가 코드입니다.' };
    if (grant.state !== 'ok') return { error: 'invalid_grant', error_description: '이미 사용된 인가 코드입니다.' };
    return { tokens: issueTokens(code, grant.gid, now) };
  }
  if (grantType === 'refresh_token') {
    const refresh = verifyTyped(get('refresh_token'), 'refresh');
    if (!refresh) return { error: 'invalid_grant', error_description: '리프레시 토큰이 유효하지 않거나 만료되었습니다.' };
    if (get('client_id') && get('client_id') !== refresh.cid) {
      return { error: 'invalid_grant', error_description: 'client_id가 일치하지 않습니다.' };
    }
    const now = nowSec();
    const grant = await redeemGrant(refresh, now);
    if (grant.state === 'revoked') return { error: 'invalid_grant', error_description: '연결이 해제된 토큰입니다.' };
    if (grant.state !== 'ok') return { error: 'invalid_grant', error_description: '이미 사용된 리프레시 토큰이라 이 연결을 끊었습니다. Claude에서 다시 연결해 주세요.' };
    return { tokens: issueTokens(refresh, grant.gid, now) };
  }
  return { error: 'unsupported_grant_type', error_description: 'authorization_code 또는 refresh_token만 지원합니다.' };
}

/**
 * The access token's claims plus { user }, or null when the token is expired, forged, issued before
 * accounts (no uid/wid) or connections (no gid), its user is disabled, signed out or no longer in wid, or the
 * workspace cut the connection.
 */
export async function verifyAccessToken(token) {
  const payload = verifyTyped(token, 'access');
  if (!payload) return null;
  if (typeof payload.gid !== 'string' || !payload.gid) return null;
  const user = await grantUser(payload);
  if (!user) return null;
  const now = Date.now();
  const live = await withService(payload.wid, (api) => String(payload.ver) === tokenVersionOf(api)
    && api.hasOAuthGrant(payload.gid, now));
  return live ? { ...payload, user } : null;
}

export function bearerToken(req) {
  const header = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : '';
}

export async function readParams(req) {
  const ctype = req.headers.get('content-type') || '';
  if (ctype.includes('application/json')) {
    const body = await req.json().catch(() => null);
    return body && typeof body === 'object' ? body : {};
  }
  const text = await req.text().catch(() => '');
  return Object.fromEntries(new URLSearchParams(text));
}
