import crypto from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 8;

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password, salt, keylen, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, keylen, { ...params, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** `scrypt$N$r$p$salt$hash` (base64url). */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(KEYLEN).toString('base64url')}`;

/** Constant-ish time check; a missing hash still runs scrypt so unknown emails take as long. */
export async function verifyPassword(password, stored) {
  const parts = String(stored || DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  if (!expected.length) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(key, expected) && !!stored;
}

/** Error message for a password that is too weak, or ''. */
export function passwordProblem(password) {
  const s = String(password || '');
  if (s.length < MIN_PASSWORD_LENGTH) return `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`;
  if (s.length > 200) return '비밀번호가 너무 깁니다.';
  return '';
}
