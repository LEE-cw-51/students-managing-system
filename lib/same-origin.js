function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch (e) {
    return '';
  }
}

/**
 * False when a browser says the request came from another site (Sec-Fetch-Site, Origin).
 * Requests without either header (non-browser clients) pass; `Origin: null` does not.
 */
export function isSameOrigin(req) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.get('origin');
  if (!origin) return true;
  const allowed = [hostOf(req.url), req.headers.get('host'), req.headers.get('x-forwarded-host')]
    .filter(Boolean)
    .map((h) => String(h).split(',')[0].trim().toLowerCase());
  return allowed.includes(hostOf(origin));
}
