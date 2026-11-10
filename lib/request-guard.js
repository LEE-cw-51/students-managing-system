function firstHeader(value) {
  return String(value || '').split(',')[0].trim().toLowerCase();
}

function sameHost(origin, headers) {
  let host;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch (e) {
    return false;
  }
  return [headers.get('x-forwarded-host'), headers.get('host')].some((h) => firstHeader(h) === host);
}

/**
 * Guard for cookie-authenticated POST routes (not OAuth/MCP, which Claude calls cross-origin).
 * Browsers send Origin on cross-site POSTs, so one naming another host is refused. json: the
 * handler reads req.json(), so the body must say application/json (cross-site forms can only
 * send form or text/plain bodies without a CORS preflight).
 * Returns the refusal Response, or null when the request may go on.
 */
export function guardPost(req, { json = true } = {}) {
  const origin = req.headers.get('origin');
  if (origin !== null && !sameHost(origin, req.headers)) {
    return Response.json({ ok: false, error: '다른 사이트에서 보낸 요청은 받을 수 없습니다.' }, { status: 403 });
  }
  if (json && !String(req.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
    return Response.json({ ok: false, error: '요청 형식이 올바르지 않습니다. JSON으로 보내 주세요.' }, { status: 415 });
  }
  return null;
}
