/** Same-origin path for post-login redirects, or '' when unsafe. */
export function safeNext(value) {
  const s = typeof value === 'string' ? value : '';
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\u0000-\u001f]/.test(s)) return '';
  return s;
}
