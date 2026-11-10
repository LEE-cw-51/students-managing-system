import { LMS } from '../lms.js';

export { LMS };

export const str = (v) => (v === null || v === undefined ? '' : String(v));
export const pick = (obj, keys) => {
  const out = {};
  keys.forEach((k) => {
    if (obj && obj[k] !== undefined && obj[k] !== '' && obj[k] !== null) out[k] = obj[k];
  });
  return out;
};
export const badgeLabels = (badges) => (Array.isArray(badges) ? badges.map((b) => b && (b.label || b.text)).filter(Boolean) : []);

export const STUDENT_ID = LMS.AGENT_PARAM.studentId;
export const CLASS_ID = LMS.AGENT_PARAM.classId;
export const DATE = LMS.AGENT_PARAM.date;
export const MONTH = LMS.AGENT_PARAM.month;
