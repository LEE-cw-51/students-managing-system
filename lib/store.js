import { createRequire } from 'node:module';
import { loadEnv } from './env.js';
import { PUBLIC_API } from './public-api.js';

loadEnv();

const require = createRequire(import.meta.url);
const LMS = require('../src/01_Service.js');

const TZ = process.env.LMS_TZ || 'Asia/Seoul';

function formatNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

function formatToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/** Workspace that held all data before accounts existed (see the accounts migration). */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkspaceId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function requireWorkspaceId(workspaceId) {
  if (!isWorkspaceId(workspaceId)) throw new Error('작업공간을 찾을 수 없습니다.');
  return workspaceId;
}

export async function createPgStore(tx, workspaceId, options = {}) {
  requireWorkspaceId(workspaceId);
  const loaded = {};
  const dirty = new Set();
  const rows = await tx`select name, rows from lms.kv where workspace_id = ${workspaceId}`;
  rows.forEach((row) => {
    loaded[row.name] = Array.isArray(row.rows) ? row.rows : [];
  });
  Object.keys(LMS.TABLES).forEach((name) => {
    if (!Object.prototype.hasOwnProperty.call(loaded, name)) loaded[name] = [];
  });

  return {
    readTable(name) {
      return loaded[name] || [];
    },
    writeTable(name, next) {
      loaded[name] = next || [];
      dirty.add(name);
    },
    now: formatNow,
    today: formatToday,
    currentUserEmail() {
      return options.userEmail || 'teacher@local';
    },
    // withService already runs each request in one Postgres transaction.
    transaction(fn) {
      return fn();
    },
    async flush() {
      for (const name of dirty) {
        await tx`
          insert into lms.kv (workspace_id, name, rows, updated_at)
          values (${workspaceId}, ${name}, ${tx.json(loaded[name] || [])}, now())
          on conflict (workspace_id, name) do update
          set rows = excluded.rows, updated_at = now()
        `;
      }
      dirty.clear();
    }
  };
}

// Dev-only: LMS_STORE=file keeps data in dev-server/ (no Postgres needed): the default workspace
// in data.json, other workspaces in data-<workspace id>.json.
export function useFileStore() {
  return process.env.LMS_STORE === 'file' && process.env.NODE_ENV !== 'production';
}

const fileStores = new Map();

function getFileStore(workspaceId) {
  if (fileStores.has(workspaceId)) return fileStores.get(workspaceId);
  const fs = require('node:fs');
  const path = require('node:path');
  const { createMemoryStore } = require('../tests/memory-store.js');
  const name = workspaceId === DEFAULT_WORKSPACE_ID ? 'data.json' : `data-${workspaceId.toLowerCase()}.json`;
  const file = path.join(process.cwd(), 'dev-server', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const base = createMemoryStore({ fs, file });
  const store = Object.assign({}, base, { now: formatNow, today: formatToday });
  if (workspaceId === DEFAULT_WORKSPACE_ID && !store.readTable('Students').length) {
    const { seedRich } = require('../scripts/dev-data.js');
    const api = LMS.createService(store);
    api.ensureSchema();
    seedRich(api, formatToday());
  }
  fileStores.set(workspaceId, store);
  return store;
}

/**
 * Runs fn(api) on one workspace's data in a single transaction, serialized per workspace.
 * options: { userEmail } for records that note who made a change.
 */
export async function withService(workspaceId, fn, options = {}) {
  requireWorkspaceId(workspaceId);
  if (typeof fn !== 'function') throw new TypeError('withService(workspaceId, fn)');
  if (useFileStore()) {
    const store = Object.assign({}, getFileStore(workspaceId), {
      currentUserEmail: () => options.userEmail || 'teacher@local'
    });
    const api = LMS.createService(store);
    return store.transaction(() => {
      api.ensureSchema();
      return fn(api);
    });
  }
  const { getSql } = await import('./db.js');
  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(872163, hashtext(${workspaceId}))`;
    const store = await createPgStore(tx, workspaceId, options);
    const api = LMS.createService(store);
    api.ensureSchema();
    const result = fn(api);
    await store.flush();
    return result;
  });
}

/** withService bound to one workspace, for helpers that take a `run(fn)` argument. */
export function serviceRunner(workspaceId, options = {}) {
  requireWorkspaceId(workspaceId);
  return (fn) => withService(workspaceId, fn, options);
}

/** Whether the browser may call this service function through /api/[name]. */
export function isPublicApi(api, name) {
  return Object.prototype.hasOwnProperty.call(api, name) && typeof api[name] === 'function' && PUBLIC_API.has(name);
}

export { LMS };
