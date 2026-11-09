-- Accounts rollout, rollback to the step-1 (expand) state, where both the pre-account code and the new
-- code can read and write lms.kv. Run by hand, then redeploy the old code if needed; drop the leftover
-- column afterwards with 20261108_accounts_rollback_cleanup.sql.
-- Refuses while any lms.kv row belongs to a workspace other than the default one (that data would be
-- unreachable for the old code). Does nothing right after step 1.

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
    raise notice 'lms.kv has no workspace_id column; nothing to roll back';
    return;
  end if;

  if exists (select 1 from lms.kv where workspace_id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'lms.kv has rows outside the default workspace; move or delete them before rolling back';
  end if;

  select array_agg(a.attname::text order by a.attname) into pk_cols
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
  where i.indrelid = 'lms.kv'::regclass and i.indisprimary;

  if pk_cols is distinct from array['name'] then
    alter table lms.kv drop constraint if exists kv_pkey;
    alter table lms.kv add constraint kv_pkey primary key (name);
  end if;

  create unique index if not exists kv_workspace_name_key on lms.kv (workspace_id, name);
  alter table lms.kv alter column workspace_id set default '00000000-0000-0000-0000-000000000001';
end $$;

commit;
