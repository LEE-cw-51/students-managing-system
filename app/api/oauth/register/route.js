import { corsJson, corsPreflight, oauthError, registerClient } from '../../../../lib/oauth.js';
import { clientIp, reserveClientRegistration } from '../../../../lib/login-limit.js';

export const runtime = 'nodejs';

export async function POST(req) {
  // Counted before the body is read, so malformed or oversized bodies use up the limit too.
  const gate = await reserveClientRegistration(clientIp(req.headers));
  if (!gate.ok) {
    const retryAfter = String(Math.max(1, Math.ceil(gate.retryAfterMs / 1000)));
    return corsJson(
      { error: 'too_many_requests', error_description: '클라이언트 등록 요청이 너무 많습니다. 잠시 뒤에 다시 시도해 주세요.' },
      429,
      { 'Retry-After': retryAfter }
    );
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return oauthError('invalid_client_metadata', 'JSON 본문이 필요합니다.');
  const result = registerClient(body);
  if (result.error) return oauthError(result.error, result.error_description);
  return corsJson(result.client, 201);
}

export function OPTIONS() {
  return corsPreflight();
}
