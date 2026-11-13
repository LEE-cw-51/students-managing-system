import crypto from 'node:crypto';
import { loadEnv } from './env.js';

loadEnv();

/**
 * What a signed token is for. Each purpose has its own HMAC key derived from AUTH_SECRET
 * (HKDF-SHA256), so a token made for one purpose never verifies as another.
 */
export const SIGNING_PURPOSES = Object.freeze({
  session: 'lms/session',
  client: 'lms/oauth-client',
  code: 'lms/oauth-code',
  token: 'lms/oauth-token'
});

const HKDF_SALT = 'students-managing-system/signing/v1';
const derivedKeys = new Map();

function secret() {
  const s = process.env.AUTH_SECRET || '';
  if (!s) throw new Error('AUTH_SECRET이 없습니다.');
  return s;
}

function infoOf(purpose) {
  const info = SIGNING_PURPOSES[purpose];
  if (!info) throw new Error(`알 수 없는 서명 용도입니다: ${purpose}`);
  return info;
}

function purposeKey(purpose) {
  const s = secret();
  const cacheKey = `${purpose}\u0000${s}`;
  let key = derivedKeys.get(cacheKey);
  if (!key) {
    key = Buffer.from(crypto.hkdfSync('sha256', s, HKDF_SALT, infoOf(purpose), 32));
    derivedKeys.set(cacheKey, key);
  }
  return key;
}

function macOf(key, body) {
  return crypto.createHmac('sha256', key).update(body).digest('base64url');
}

function macMatches(mac, expected) {
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** `body.mac` signed with the key of `purpose` (a SIGNING_PURPOSES key). */
export function sign(payload, purpose) {
  const key = purposeKey(purpose);
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${macOf(key, body)}`;
}

/**
 * The payload of a token signed for `purpose`, or null. Tokens signed before keys were split
 * per purpose used AUTH_SECRET itself; they still verify so nobody is logged out or has to
 * reconnect Claude. Callers keep checking expiry: sessions, refresh tokens and codes signed
 * that way run out on their own, OAuth client ids have no expiry.
 */
export function unsign(token, purpose) {
  const key = purposeKey(purpose);
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const [body, mac] = token.split('.');
  if (!macMatches(mac, macOf(key, body)) && !macMatches(mac, macOf(secret(), body))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
}
