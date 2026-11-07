-- Teacher accounts + workspaces. Existing lms.kv rows move into the default workspace
-- (00000000-0000-0000-0000-000000000001); the first admin claims it on first login
-- (ADMIN_EMAIL + LMS_PASSWORD) or via scripts/create-admin.mjs.

create table if not exists lms.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text not null default '',
  role text not null default 'teacher' check (role in ('admin', 'teacher')),
  disabled boolean not null default false,
  session_version integer not null default 1,
  created_at timestamptz not null default now()
);

create unique index if not exists users_email_key on lms.users (lower(email));

create table if not exists lms.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists lms.workspace_members (
  workspace_id uuid not null references lms.workspaces (id) on delete cascade,
  user_id uuid not null references lms.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on lms.workspace_members (user_id);

create table if not exists lms.invites (
  token_hash text primary key,
  purpose text not null default 'invite' check (purpose in ('invite', 'reset')),
  email text not null,
  name text not null default '',
  role text not null default 'teacher' check (role in ('admin', 'teacher')),
  user_id uuid references lms.users (id) on delete cascade,
  workspace_id uuid references lms.workspaces (id) on delete cascade,
  created_by uuid references lms.users (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

insert into lms.workspaces (id, name)
values ('00000000-0000-0000-0000-000000000001', '기본 작업공간')
on conflict (id) do nothing;

alter table lms.kv add column if not exists workspace_id uuid;
update lms.kv set workspace_id = '00000000-0000-0000-0000-000000000001' where workspace_id is null;
alter table lms.kv alter column workspace_id set not null;
alter table lms.kv drop constraint if exists kv_pkey;
alter table lms.kv add constraint kv_pkey primary key (workspace_id, name);
alter table lms.kv drop constraint if exists kv_workspace_fk;
alter table lms.kv add constraint kv_workspace_fk
  foreign key (workspace_id) references lms.workspaces (id) on delete cascade;

alter table lms.users enable row level security;
alter table lms.workspaces enable row level security;
alter table lms.workspace_members enable row level security;
alter table lms.invites enable row level security;

revoke all on lms.users, lms.workspaces, lms.workspace_members, lms.invites from anon, authenticated, public;
grant select, insert, update, delete on lms.users, lms.workspaces, lms.workspace_members, lms.invites
  to postgres, service_role, lms_app;

drop policy if exists lms_app_crud on lms.users;
create policy lms_app_crud on lms.users for all to lms_app using (true) with check (true);
drop policy if exists lms_app_crud on lms.workspaces;
create policy lms_app_crud on lms.workspaces for all to lms_app using (true) with check (true);
drop policy if exists lms_app_crud on lms.workspace_members;
create policy lms_app_crud on lms.workspace_members for all to lms_app using (true) with check (true);
drop policy if exists lms_app_crud on lms.invites;
create policy lms_app_crud on lms.invites for all to lms_app using (true) with check (true);
