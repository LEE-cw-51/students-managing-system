import { corsJson, corsPreflight, protectedResourceMetadata } from '../../../lib/oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req) {
  return corsJson(protectedResourceMetadata(req));
}

export function OPTIONS() {
  return corsPreflight();
}
