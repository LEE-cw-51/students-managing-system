'use strict';

// The accounts rollout on a real Postgres: step 1 (expand), step 2 (contract) and both rollback files,
// checked with the SQL the pre-account code and the new code actually send.
// Needs TEST_DATABASE_URL (a superuser on a throwaway server, e.g.
// `docker run --rm -d -e POSTGRES_PASSWORD=pg -p 54329:5432 postgres:17` and
// `postgres://postgres:pg@localhost:54329/postgres`); skipped otherwise. Each test makes and drops its own database.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.TEST_DATABASE_URL;
const root = path.join(__dirname, '..');
const sqlFile = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const SCHEMA = 'supabase/migrations/20260914120000_lms_schema.sql';
const EXPAND = 'supabase/migrations/20261108120000_accounts.sql';
const CONTRACT = 'supabase/rollout/20261108_accounts_contract.sql';
const ROLLBACK = 'supabase/rollout/20261108_accounts_rollback.sql';
const CLEANUP = 'supabase/rollout/20261108_accounts_rollback_cleanup.sql';
const DEFAULT_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

// Pre-account code: lib/store.js at 2ab8759^ (the commit before accounts).
const oldCode = {
  load: (sql) => sql`select name, rows from lms.kv`,
  save: (sql, name, rows) => sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(872163)`;
    await tx`
      insert into lms.kv (name, rows, updated_at)
      values (${name}, ${tx.json(rows)}, now())
      on conflict (name) do update
      set rows = excluded.rows, updated_at = now()
    `;
  })
};

// New code: lib/store.js (createPgStore / withService).
const newCode = {
  load: (sql, wid) => sql`select name, rows from lms.kv where workspace_id = ${wid}`,
  save: (sql, wid, name, rows) => sql.begin(async (tx) => {
    if (wid === DEFAULT_ID) await tx`select pg_advisory_xact_lock(872163)`;
    await tx`select pg_advisory_xact_lock(872163, hashtext(${wid}))`;
    await tx`
      insert into lms.kv (workspace_id, name, rows, updated_at)
      values (${wid}, ${name}, ${tx.json(rows)}, now())
      on conflict (workspace_id, name) do update
      set rows = excluded.rows, updated_at = now()
    `;
  })
};

const byName = (rows) => Object.fromEntries([...rows].map((r) => [r.name, r.rows]));

describe('accounts rollout on Postgres', { skip: !BASE_URL && 'TEST_DATABASE_URL not set' }, () => {
  let postgres;
  let admin;
  const open = [];

  before(async () => {
    postgres = require('postgres');
    admin = postgres(BASE_URL, { max: 1, onnotice: () => {} });
    await admin.unsafe(`
      do $$
      declare r text;
      begin
        foreach r in array array['anon', 'authenticated', 'service_role', 'lms_app'] loop
          if not exists (select 1 from pg_roles where rolname = r) then
            execute format('create role %I nologin', r);
          end if;
        end loop;
      end $$;
    `);
  });

  after(async () => {
    for (const { sql, name } of open) {
      await sql.end({ timeout: 5 });
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
    }
    if (admin) await admin.end({ timeout: 5 });
  });

  /** A new database with the base schema and pre-account data written by the old code. */
  async function freshDb() {
    const name = `lms_rollout_${crypto.randomBytes(4).toString('hex')}`;
    await admin.unsafe(`create database "${name}"`);
    const url = new URL(BASE_URL);
    url.pathname = `/${name}`;
    const sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
    open.push({ sql, name });
    await sql.unsafe(sqlFile(SCHEMA));
    await oldCode.save(sql, 'Students', [{ id: 's1', name: '홍길동' }]);
    await oldCode.save(sql, '_Meta', [{ key: 'schema_version', value: 7 }]);
    return sql;
  }

  /** Runs a SQL file like the SQL Editor does; a failure inside its begin/commit leaves no open transaction. */
  async function run(sql, rel) {
    const conn = await sql.reserve();
    try {
      await conn.unsafe(sqlFile(rel));
    } catch (e) {
      await conn.unsafe('rollback');
      throw e;
    } finally {
      conn.release();
    }
  }

  async function shape(sql) {
    const [row] = await sql`
      select
        (select array_agg(a.attname::text order by a.attname)
           from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
           where i.indrelid = 'lms.kv'::regclass and i.indisprimary) as pk,
        (select array_agg(indexname::text order by indexname) from pg_indexes where schemaname = 'lms' and tablename = 'kv') as indexes,
        (select column_default from information_schema.columns
           where table_schema = 'lms' and table_name = 'kv' and column_name = 'workspace_id') as col_default,
        exists (select 1 from information_schema.columns
           where table_schema = 'lms' and table_name = 'kv' and column_name = 'workspace_id') as has_col
    `;
    return row;
  }

  async function addWorkspace(sql, id = OTHER_ID) {
    await sql`insert into lms.workspaces (id, name) values (${id}, '두 번째') on conflict (id) do nothing`;
  }

  /** Both versions read and write; returns the rows the old code sees. */
  async function bothCodesWork(sql, tag) {
    await oldCode.save(sql, 'Students', [{ id: 's1', name: `옛-${tag}` }]);
    await oldCode.save(sql, `Old_${tag}`, [{ tag }]);
    await newCode.save(sql, DEFAULT_ID, 'Classes', [{ id: 'c1', tag }]);
    const viaNew = byName(await newCode.load(sql, DEFAULT_ID));
    assert.deepEqual(viaNew.Students, [{ id: 's1', name: `옛-${tag}` }], 'new code sees the old code write');
    assert.deepEqual(viaNew[`Old_${tag}`], [{ tag }]);
    const viaOld = byName(await oldCode.load(sql));
    assert.deepEqual(viaOld.Classes, [{ id: 'c1', tag }], 'old code sees the new code write');
    return viaOld;
  }

  it('step 1: existing rows land in the default workspace and both versions can save', async () => {
    const sql = await freshDb();
    await run(sql, EXPAND);
    const rows = await sql`select workspace_id, name from lms.kv order by name`;
    assert.deepEqual(rows.map((r) => [r.workspace_id, r.name]), [[DEFAULT_ID, 'Students'], [DEFAULT_ID, '_Meta']]);
    const seen = await bothCodesWork(sql, 'a');
    assert.deepEqual(seen._Meta, [{ key: 'schema_version', value: 7 }]);
    const s = await shape(sql);
    assert.deepEqual(s.pk, ['name']);
    assert.ok(s.indexes.includes('kv_workspace_name_key'));
  });

  it('step 1 shares the old lock: an old instance waits while the new code writes the default workspace', async () => {
    const sql = await freshDb();
    await run(sql, EXPAND);
    const reserved = await sql.reserve();
    try {
      await reserved`begin`;
      await reserved`select pg_advisory_xact_lock(872163)`;
      await reserved`select pg_advisory_xact_lock(872163, hashtext(${DEFAULT_ID}))`;
      const [{ got }] = await sql`select pg_try_advisory_xact_lock(872163) as got`;
      assert.equal(got, false, 'the pre-account lock is taken');
      await reserved`commit`;
    } finally {
      reserved.release();
    }
  });

  it('step 1 can run twice', async () => {
    const sql = await freshDb();
    await run(sql, EXPAND);
    await bothCodesWork(sql, 'b');
    const before1 = { shape: await shape(sql), rows: byName(await oldCode.load(sql)) };
    await run(sql, EXPAND);
    assert.deepEqual({ shape: await shape(sql), rows: byName(await oldCode.load(sql)) }, before1);
  });

  it('step 2 lets a second workspace store its tables, and only then; the old code then stops working', async () => {
    const sql = await freshDb();
    await run(sql, EXPAND);
    await addWorkspace(sql);
    await assert.rejects(newCode.save(sql, OTHER_ID, 'Students', [{ id: 'x' }]), (e) => e.code === '23505', 'kv_pkey (name) still holds');
    await run(sql, CONTRACT);
    const s = await shape(sql);
    assert.deepEqual(s.pk, ['name', 'workspace_id']);
    assert.equal(s.col_default, null);
    await newCode.save(sql, OTHER_ID, 'Students', [{ id: 'x' }]);
    assert.deepEqual(byName(await newCode.load(sql, OTHER_ID)).Students, [{ id: 'x' }]);
    assert.deepEqual(byName(await newCode.load(sql, DEFAULT_ID)).Students, [{ id: 's1', name: '홍길동' }]);
    await newCode.save(sql, DEFAULT_ID, 'Students', [{ id: 's2' }]);
    await assert.rejects(oldCode.save(sql, 'Students', [{ id: 'old' }]), 'old code cannot save after step 2');
  });

  it('step 2 can run twice', async () => {
    const sql = await freshDb();
    await run(sql, EXPAND);
    await run(sql, CONTRACT);
    const once = await shape(sql);
    await run(sql, CONTRACT);
    assert.deepEqual(await shape(sql), once);
  });

  it('step 2 refuses to run before step 1', async () => {
    const sql = await freshDb();
    await assert.rejects(run(sql, CONTRACT));
    assert.deepEqual((await shape(sql)).pk, ['name']);
  });

  for (const afterStep of ['step 1', 'step 2']) {
    it(`rollback right after ${afterStep}: both versions work, then cleanup leaves the old code with its data`, async () => {
      const sql = await freshDb();
      await run(sql, EXPAND);
      if (afterStep === 'step 2') {
        await run(sql, CONTRACT);
        await newCode.save(sql, DEFAULT_ID, 'Lessons', [{ id: 'l1' }]);
      }
      const shapeAfterExpand = afterStep === 'step 1' ? await shape(sql) : null;
      await run(sql, ROLLBACK);
      if (shapeAfterExpand) assert.deepEqual(await shape(sql), shapeAfterExpand, 'no change right after step 1');
      const s = await shape(sql);
      assert.deepEqual(s.pk, ['name']);
      assert.ok(s.indexes.includes('kv_workspace_name_key'));
      assert.match(String(s.col_default), new RegExp(DEFAULT_ID));
      const seen = await bothCodesWork(sql, 'r');
      if (afterStep === 'step 2') assert.deepEqual(seen.Lessons, [{ id: 'l1' }], 'data written after step 2 is kept');

      await run(sql, CLEANUP);
      assert.equal((await shape(sql)).has_col, false);
      await oldCode.save(sql, 'Students', [{ id: 's9' }]);
      const left = byName(await oldCode.load(sql));
      assert.deepEqual(left.Students, [{ id: 's9' }]);
      assert.deepEqual(left._Meta, [{ key: 'schema_version', value: 7 }]);
      assert.deepEqual(left.Classes, [{ id: 'c1', tag: 'r' }]);

      await run(sql, EXPAND);
      await bothCodesWork(sql, 'again');
    });
  }

  it('rollback and cleanup refuse while another workspace has data', async () => {
    const sql = await freshDb();
    await run(sql, EXPAND);
    await addWorkspace(sql);
    await newCode.save(sql, OTHER_ID, 'OnlyHere', [{ id: 'o1' }]);
    await assert.rejects(run(sql, ROLLBACK), /outside the default workspace/);
    await assert.rejects(run(sql, CLEANUP), /outside the default workspace/);
    assert.deepEqual(byName(await newCode.load(sql, OTHER_ID)).OnlyHere, [{ id: 'o1' }]);

    await run(sql, CONTRACT);
    await newCode.save(sql, OTHER_ID, 'Students', [{ id: 'o2' }]);
    await assert.rejects(run(sql, ROLLBACK), /outside the default workspace/);
    const s = await shape(sql);
    assert.deepEqual(s.pk, ['name', 'workspace_id'], 'nothing changed');
    assert.equal(s.has_col, true);
  });

  it('cleanup refuses to run before rollback once step 2 is applied', async () => {
    const sql = await freshDb();
    await run(sql, EXPAND);
    await run(sql, CONTRACT);
    await assert.rejects(run(sql, CLEANUP), /run 20261108_accounts_rollback\.sql first/);
    assert.equal((await shape(sql)).has_col, true);
  });
});
