import { getSession } from './auth.js';
import { isSameOrigin } from './same-origin.js';

function deny(status, error) {
  return Response.json({ ok: false, error }, { status });
}

/** True when a state-changing request comes from this site as a JSON fetch (blocks form posts from other origins). */
export function isSameOriginJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (!String(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return false;
  return isSameOrigin(req);
}

/** The reply that stops a request before the handler runs, or null when an admin may go ahead. */
export function adminDenied(req, session) {
  if (!session) return deny(401, '로그인이 필요합니다.');
  if (session.role !== 'admin') return deny(403, '관리자만 사용할 수 있습니다.');
  if (!isSameOriginJson(req)) return deny(403, '허용되지 않은 요청입니다.');
  return null;
}

/**
 * Route handler that runs only for a signed-in admin (checked against the database on every request).
 * handler({ req, params, session }) returns JSON data; account errors meant for the user become 400.
 */
export function adminRoute(handler, loadSession = getSession) {
  return async (req, ctx) => {
    const session = await loadSession();
    const denied = adminDenied(req, session);
    if (denied) return denied;
    try {
      const params = ctx && ctx.params ? await ctx.params : {};
      return Response.json({ ok: true, data: await handler({ req, params, session }) });
    } catch (e) {
      if (e && e.expose) return Response.json({ ok: false, error: e.message, code: e.code }, { status: 400 });
      console.error('admin request failed', e);
      return deny(500, '서버 오류가 발생했습니다.');
    }
  };
}

/** An error whose message adminRoute shows to the admin. */
export function adminError(message) {
  const e = new Error(message);
  e.expose = true;
  e.code = 'ADMIN_ERROR';
  return e;
}

/** JSON body of a request, or {} when missing or malformed. */
export async function jsonBody(req) {
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}
