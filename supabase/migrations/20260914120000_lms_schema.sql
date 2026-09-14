create schema if not exists lms;

create table if not exists lms.kv (
  name text primary key,
  rows jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table lms.kv enable row level security;

revoke all on schema lms from anon, authenticated, public;
revoke all on all tables in schema lms from anon, authenticated, public;
grant usage on schema lms to postgres, service_role, lms_app;
grant select, insert, update, delete on all tables in schema lms to postgres, service_role, lms_app;

create policy lms_app_crud on lms.kv
  for all
  to lms_app
  using (true)
  with check (true);
