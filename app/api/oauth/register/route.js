import { corsJson, corsPreflight, oauthError, registerClient } from '../../../../lib/oauth.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return oauthError('invalid_client_metadata', 'JSON 본문이 필요합니다.');
  const result = registerClient(body);
  if (result.error) return oauthError(result.error, result.error_description);
  return corsJson(result.client, 201);
}

export function OPTIONS() {
  return corsPreflight();
}
