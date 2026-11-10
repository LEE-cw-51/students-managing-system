-- Login attempt counters shared by every serverless instance (lib/login-limit.js).
-- Safe to run more than once.
create table if not exists lms.login_attempts (
  bucket text primary key,
  attempts integer not null default 0,
  window_start_ms bigint not null
);

alter table lms.login_attempts enable row level security;

revoke all on lms.login_attempts from anon, authenticated, public;
grant select, insert, update, delete on lms.login_attempts to postgres, service_role, lms_app;

drop policy if exists lms_app_crud on lms.login_attempts;
create policy lms_app_crud on lms.login_attempts
  for all
  to lms_app
  using (true)
  with check (true);
