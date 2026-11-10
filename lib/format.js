const DAYS = '일월화수목금토';

function parts(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return { y, m, d, day: DAYS[new Date(y, m - 1, d).getDay()] };
}

/** 2026-10-21 → 10월 21일 (수) */
export function formatDate(iso, withYear) {
  if (!iso) return '';
  const p = parts(iso);
  return `${withYear ? p.y + '년 ' : ''}${p.m}월 ${p.d}일 (${p.day})`;
}

/** 2026-10-21 → 10.21 (수) */
export function shortDate(iso) {
  if (!iso) return '';
  const p = parts(iso);
  return `${p.m}.${p.d} (${p.day})`;
}

/** 10.21 (수) ~ 10.23 (금); a one-day range shows only the start. */
export function dateRange(start, end, format = shortDate) {
  if (!start) return '';
  return end && end !== start ? `${format(start)} ~ ${format(end)}` : format(start);
}

export function relativeDay(iso, today) {
  if (!iso || !today) return '';
  const a = new Date(...iso.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const b = new Date(...today.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  return diff > 0 ? `${diff}일 후` : `${-diff}일 전`;
}

export function percent(v) {
  return v === null || v === undefined ? '-' : `${v}%`;
}

export function points(v) {
  return v === null || v === undefined ? '-' : `${v}점`;
}

export function score(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Phone number as a tel: link, or '' when it has no digits. */
export function telHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return /\d/.test(digits) ? 'tel:' + digits : '';
}

export function timeSpan(t) {
  if (!t || !t.start) return '';
  return t.start + (t.end ? '–' + t.end : '');
}
