// Service functions the browser calls through /api/[name] (directly or inside apiBatch).
// Anything else on the service object stays server-only.
// Names are owned by src/service-domains.js (same maps createService uses for domain seams).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { publicApiNames } = require('../src/service-domains.js');

export const PUBLIC_API = new Set(publicApiNames());
