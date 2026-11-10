import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The business layer (src/, CommonJS): service, views, agent proposals and write actions. */
export const LMS = require('../src/01_Service.js');
