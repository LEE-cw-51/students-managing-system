import { corsJson, corsPreflight, exchangeToken, oauthError, readParams } from '../../../../lib/oauth.js';

export const runtime = 'nodejs';

export async function POST(req) {
  const params = await readParams(req);
  try {
    const result = await exchangeToken(params);
    if (result.error) return oauthError(result.error, result.error_description);
    return corsJson(result.tokens);
  } catch (e) {
    return oauthError('server_error', '토큰을 발급하지 못했습니다.', 500);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
