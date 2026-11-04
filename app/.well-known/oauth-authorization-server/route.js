import { authorizationServerMetadata, corsJson, corsPreflight } from '../../../lib/oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req) {
  return corsJson(authorizationServerMetadata(req));
}

export function OPTIONS() {
  return corsPreflight();
}
