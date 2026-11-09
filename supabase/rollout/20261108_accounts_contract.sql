-- Accounts rollout, step 2 (contract). Run by hand (SQL Editor or psql) only after
-- supabase/migrations/20261108120000_accounts.sql is applied, the new code is deployed and the logs show
-- no more requests from the pre-account code. Afterwards each workspace can store its own tables.
-- Safe to run again: does nothing once the primary key is (workspace_id, name).
-- Undo: supabase/rollout/20261108_accounts_rollback.sql.

begin;

lock table lms.kv in access exclusive mode;

do $$
declare
  pk_cols text[];
begin
  select array_agg(a.attname::text order by a.attname) into pk_cols
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = 'lms.kv'::regclass and i.indisprimary;

  if pk_cols = array['name', 'workspace_id'] then
    raise notice 'lms.kv primary key is already (workspace_id, name); nothing to do';
    return;
  end if;
  if to_regclass('lms.kv_workspace_name_key') is null then
    raise exception 'lms.kv_workspace_name_key is missing: apply supabase/migrations/20261108120000_accounts.sql first';
  end if;

  alter table lms.kv drop constraint kv_pkey;
  alter table lms.kv add constraint kv_pkey primary key using index kv_workspace_name_key;
end $$;

alter table lms.kv alter column workspace_id drop default;

commit;
