function firstHeader(value) {
  return String(value || '').split(',')[0].trim().toLowerCase();
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch (e) {
    return '';
  }
}

function sameHost(origin, req) {
  const host = hostOf(origin);
  if (!host) return false;
  return [req.headers.get('x-forwarded-host'), req.headers.get('host'), hostOf(req.url)].some((h) => firstHeader(h) === host);
}

/**
 * Guard for cookie-authenticated POST routes (not OAuth/MCP, which Claude calls cross-origin).
 * Browsers send Origin and Sec-Fetch-Site on cross-site POSTs, so one naming another host or
 * site is refused (this also stops login CSRF on the form routes). json: the handler reads
 * req.json(), so the body must say application/json (cross-site forms can only send form or
 * text/plain bodies without a CORS preflight).
 * Returns the refusal Response, or null when the request may go on.
 */
export function guardPost(req, { json = true } = {}) {
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  if ((site && site !== 'same-origin' && site !== 'none') || (origin !== null && !sameHost(origin, req))) {
    return Response.json({ ok: false, error: '다른 사이트에서 보낸 요청은 받을 수 없습니다.' }, { status: 403 });
  }
  if (json && !String(req.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return Response.json({ ok: false, error: '요청 형식이 올바르지 않습니다. JSON으로 보내 주세요.' }, { status: 415 });
  }
  return null;
}
