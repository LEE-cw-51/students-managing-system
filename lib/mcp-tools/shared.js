import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const LMS = require('../../src/01_Service.js');

export const str = (v) => (v === null || v === undefined ? '' : String(v));
export const pick = (obj, keys) => {
  const out = {};
  keys.forEach((k) => {
    if (obj && obj[k] !== undefined && obj[k] !== '' && obj[k] !== null) out[k] = obj[k];
  });
  return out;
};
export const badgeLabels = (badges) => (Array.isArray(badges) ? badges.map((b) => b && (b.label || b.text)).filter(Boolean) : []);

export const STUDENT_ID = { type: 'string', description: '학생 ID (예: STU-0001). search_students로 먼저 찾습니다.' };
export const CLASS_ID = { type: 'string', description: '반 ID (list_classes로 찾음)' };
export const DATE = (what) => ({ type: 'string', description: `${what} (YYYY-MM-DD)` });
export const MONTH = (what) => ({ type: 'string', description: `${what} (YYYY-MM)` });
