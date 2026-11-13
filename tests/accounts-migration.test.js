'use strict';

// Structural checks of the accounts migration (no database needed): the backfill moves every
// existing lms.kv row into the default workspace the code expects, and lms_app can use the new tables.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const MIGRATION = 'supabase/migrations/20261114000000_accounts.sql';
const sql = read(MIGRATION).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const DEFAULT_ID = '00000000-0000-0000-0000-000000000001';
const NEW_TABLES = ['users', 'workspaces', 'workspace_members', 'invites'];

/** Position of the first match; fails when missing. */
function at(re) {
  const m = re.exec(sql);
  assert.ok(m, `missing in ${MIGRATION}: ${re}`);
  return m.index;
}

/** Column names of a `create table lms.<name> (...)` statement. */
function columnsOf(table) {
  const m = new RegExp(`create table if not exists lms\\.${table} \\((.*?)\\);`).exec(sql);
  assert.ok(m, `create table lms.${table}`);
  return m[1].split(/,(?![^(]*\))/).map((s) => s.trim().split(' ')[0]).filter((c) => c && c !== 'primary');
}

describe('accounts migration', () => {
  it('runs after the base schema', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).sort();
    assert.ok(files.indexOf('20260914120000_lms_schema.sql') < files.indexOf(path.basename(MIGRATION)));
  });

  it('uses the same default workspace id as the code', () => {
    const { DEFAULT_WORKSPACE_ID } = require('../lib/store.js');
    assert.equal(DEFAULT_WORKSPACE_ID, DEFAULT_ID);
    assert.match(read('scripts/seed.js'), new RegExp(`WORKSPACE_ID = '${DEFAULT_ID}'`));
  });

  it('creates the default workspace, then adds workspace_id defaulting to it, keeping the old key (expand step)', () => {
    const insertWs = at(new RegExp(`insert into lms\\.workspaces \\(id, name\\) values \\('${DEFAULT_ID}', [^)]*\\) on conflict \\(id\\) do nothing`));
    const addCol = at(new RegExp(`alter table lms\\.kv add column if not exists workspace_id uuid not null default '${DEFAULT_ID}';`));
    const index = at(/create unique index if not exists kv_workspace_name_key on lms\.kv \(workspace_id, name\);/);
    const fk = at(/alter table lms\.kv add constraint kv_workspace_fk foreign key \(workspace_id\) references lms\.workspaces \(id\)/);
    assert.ok(insertWs < fk && addCol < fk, 'the default workspace exists before rows point at it');
    assert.ok(addCol < index);
    assert.doesNotMatch(sql, /drop constraint if exists kv_pkey/, 'the old code still needs kv_pkey (name)');
    assert.doesNotMatch(sql, /primary key \(workspace_id, name\)/, 'the key swap lives in supabase/rollout/');
  });

  it('keeps the contract and rollback steps out of supabase/migrations', () => {
    const rollout = fs.readdirSync(path.join(root, 'supabase/rollout')).sort();
    assert.deepEqual(rollout, ['20261114_accounts_contract.sql', '20261114_accounts_rollback.sql', '20261114_accounts_rollback_cleanup.sql']);
    const flat = (rel) => read(rel).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
    assert.match(flat('supabase/rollout/20261114_accounts_contract.sql'), /add constraint kv_pkey primary key using index kv_workspace_name_key/);
    for (const file of ['20261114_accounts_rollback.sql', '20261114_accounts_rollback_cleanup.sql']) {
      const body = flat(`supabase/rollout/${file}`);
      assert.match(body, /lock table lms\.kv in access exclusive mode/, file);
      assert.match(body, new RegExp(`workspace_id <> '${DEFAULT_ID}'`), file);
    }
  });

  it('can run twice', () => {
    NEW_TABLES.forEach((t) => at(new RegExp(`create table if not exists lms\\.${t} `)));
    assert.equal((sql.match(/create policy/g) || []).length, (sql.match(/drop policy if exists/g) || []).length);
    assert.doesNotMatch(sql, /create (unique )?index (?!if not exists)/);
    assert.match(sql, /alter table lms\.kv drop constraint if exists kv_workspace_fk;/);
  });

  it('keeps the new tables away from anon/authenticated and open to lms_app under RLS', () => {
    at(/revoke all on lms\.users, lms\.workspaces, lms\.workspace_members, lms\.invites from anon, authenticated, public;/);
    at(/grant select, insert, update, delete on lms\.users, lms\.workspaces, lms\.workspace_members, lms\.invites to [^;]*\blms_app\b/);
    NEW_TABLES.forEach((t) => {
      at(new RegExp(`alter table lms\\.${t} enable row level security;`));
      at(new RegExp(`create policy lms_app_crud on lms\\.${t} for all to lms_app using \\(true\\) with check \\(true\\);`));
    });
  });

  it('has every column the account code reads and writes', () => {
    const accounts = read('lib/accounts.js');
    const insertCols = (table) => {
      const m = new RegExp(`insert into lms\\.${table} \\(([^)]*)\\)`).exec(accounts);
      assert.ok(m, `insert into lms.${table} in lib/accounts.js`);
      return m[1].split(',').map((s) => s.trim());
    };
    const has = (table, cols) => cols.forEach((c) => assert.ok(columnsOf(table).includes(c), `lms.${table}.${c}`));
    has('users', [...insertCols('users'), 'id', 'disabled', 'session_version', 'created_at']);
    has('workspaces', [...insertCols('workspaces'), 'created_at']);
    has('workspace_members', [...insertCols('workspace_members'), 'created_at']);
    has('invites', [...insertCols('invites'), 'used_at']);
    at(/create unique index if not exists users_email_key on lms\.users \(lower\(email\)\);/);
    assert.match(accounts, /where lower\(email\) = \$\{email\}/, 'email lookups use the lower(email) index');
  });

  it('matches the queries in lib/store.js', () => {
    const store = read('lib/store.js');
    assert.match(store, /from lms\.kv where workspace_id = \$\{workspaceId\}/);
    assert.match(store, /on conflict \(workspace_id, name\) do update/);
    assert.match(store, /if \(workspaceId === DEFAULT_WORKSPACE_ID\) await tx`select pg_advisory_xact_lock\(872163\)`/,
      'the default workspace also takes the pre-account lock while both versions may run');
  });
});
