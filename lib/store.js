import { createRequire } from 'node:module';
import { loadEnv } from './env.js';

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

export async function createPgStore(tx) {
  const loaded = {};
  const dirty = new Set();
  const rows = await tx`select name, rows from lms.kv`;
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
      return 'teacher@local';
    },
    withLock(fn) {
      return fn();
    },
    invalidateCache() {},
    async flush() {
      for (const name of dirty) {
        await tx`
          insert into lms.kv (name, rows, updated_at)
          values (${name}, ${tx.json(loaded[name] || [])}, now())
          on conflict (name) do update
          set rows = excluded.rows, updated_at = now()
        `;
      }
      dirty.clear();
    }
  };
}

// Dev-only: LMS_STORE=file keeps data in dev-server/data.json (no Postgres needed).
function useFileStore() {
  return process.env.LMS_STORE === 'file' && process.env.NODE_ENV !== 'production';
}

let fileStore;

function getFileStore() {
  if (fileStore) return fileStore;
  const fs = require('node:fs');
  const path = require('node:path');
  const { createMemoryStore } = require('../tests/memory-store.js');
  const { seedRich } = require('../scripts/dev-data.js');
  const file = path.join(process.cwd(), 'dev-server', 'data.json');
  const base = createMemoryStore({ fs, file });
  fileStore = Object.assign({}, base, { now: formatNow, today: formatToday });
  if (!fileStore.readTable('Students').length) {
    const api = LMS.createService(fileStore);
    api.ensureSchema();
    seedRich(api, formatToday());
  }
  return fileStore;
}

export async function withService(fn) {
  if (useFileStore()) {
    const api = LMS.createService(getFileStore());
    api.ensureSchema();
    return fn(api);
  }
  const { getSql } = await import('./db.js');
  const sql = getSql();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(872163)`;
    const store = await createPgStore(tx);
    const api = LMS.createService(store);
    api.ensureSchema();
    const result = fn(api);
    await store.flush();
    return result;
  });
}

export { LMS };
