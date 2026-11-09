-- Accounts rollout, optional last rollback step: run by hand after 20261108_accounts_rollback.sql and after
-- the pre-account code is deployed again. Removes workspace_id from lms.kv; the account tables stay
-- (the old code never reads them). To move forward again, rerun
-- supabase/migrations/20261108120000_accounts.sql by hand.

begin;

lock table lms.kv in access exclusive mode;

do $$
declare
  pk_cols text[];
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'lms' and table_name = 'kv' and column_name = 'workspace_id'
  ) then
    raise notice 'lms.kv has no workspace_id column; nothing to clean up';
    return;
  end if;

  if exists (select 1 from lms.kv where workspace_id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'lms.kv has rows outside the default workspace; move or delete them before cleaning up';
  end if;

  select array_agg(a.attname::text order by a.attname) into pk_cols
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = 'lms.kv'::regclass and i.indisprimary;

  if pk_cols is distinct from array['name'] then
    raise exception 'lms.kv primary key is not (name): run 20261108_accounts_rollback.sql first';
  end if;

  alter table lms.kv drop constraint if exists kv_workspace_fk;
  drop index if exists lms.kv_workspace_name_key;
  alter table lms.kv drop column workspace_id;
end $$;

commit;
