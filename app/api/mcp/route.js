import { withService } from '../../../lib/store.js';
import { handleMcpRequest } from '../../../lib/mcp-server.js';
import { unauthorizedResponse, verifyAccessToken } from '../../../lib/oauth.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') || '').trim());
  return m ? m[1].trim() : '';
}

/** Bearer token payload, or null when the token is missing, expired or revoked. */
async function authorize(req) {
  const token = bearer(req);
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  return payload ? { token, payload } : null;
}

// Stateless: there is no session to stream to (GET) or to end (DELETE).
function methodNotAllowed() {
  return Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: '이 서버는 POST 요청만 받습니다.' }, id: null },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

/** Claude 커넥터 (remote MCP, Streamable HTTP). */
export async function POST(req) {
  const auth = await authorize(req);
  if (!auth) return unauthorizedResponse(req);
  const p = auth.payload;
  return handleMcpRequest(req, {
    run: withService,
    authInfo: { token: auth.token, clientId: String(p.client_id || p.cid || ''), scopes: [], expiresAt: typeof p.exp === 'number' ? p.exp : undefined }
  });
}

export async function GET(req) {
  if (!(await authorize(req))) return unauthorizedResponse(req);
  return methodNotAllowed();
}

export async function DELETE(req) {
  if (!(await authorize(req))) return unauthorizedResponse(req);
  return methodNotAllowed();
}
