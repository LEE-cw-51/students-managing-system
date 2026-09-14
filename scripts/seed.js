'use strict';

// Optional local demo data (홍길동 / 김철수 / 이영희). Real use starts empty.

const fs = require('fs');
const path = require('path');
const postgres = require('postgres');
const LMS = require('../src/01_Service.js');
const { seedDemo } = require('../tests/memory-store.js');

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const key = trimmed.slice(0, i);
    const value = trimmed.slice(i + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1, prepare: false });
  const loaded = {};
  const rows = await sql`select name, rows from lms.kv`;
  rows.forEach((row) => { loaded[row.name] = row.rows || []; });
  Object.keys(LMS.TABLES).forEach((name) => {
    if (!loaded[name]) loaded[name] = [];
  });
  const store = {
    readTable(name) { return loaded[name] || []; },
    writeTable(name, next) { loaded[name] = next || []; },
    now() { return '2026-09-14T10:00:00'; },
    today() { return '2026-09-14'; },
    currentUserEmail() { return 'teacher@local'; },
    withLock(fn) { return fn(); },
    invalidateCache() {}
  };
  if (store.readTable('Students').length) {
    console.log('already seeded', store.readTable('Students').length, 'students');
    await sql.end();
    return;
  }
  seedDemo(LMS.createService(store));
  for (const name of Object.keys(LMS.TABLES)) {
    await sql`
      insert into lms.kv (name, rows, updated_at)
      values (${name}, ${sql.json(store.readTable(name))}, now())
      on conflict (name) do update
      set rows = excluded.rows, updated_at = now()
    `;
  }
  console.log('seeded demo students', store.readTable('Students').length);
  await sql.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
