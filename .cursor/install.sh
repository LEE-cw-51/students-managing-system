#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for math-power-lms (Next.js + Postgres).
# Installs & provisions a local PostgreSQL (with SSL, required by lib/db.js),
# writes a dev .env.local, installs node deps, and seeds demo data.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- System: PostgreSQL ---------------------------------------------------
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

PG_VER="$(ls /etc/postgresql 2>/dev/null | sort -n | tail -1)"
PG_VER="${PG_VER:-16}"

# lib/db.js connects with ssl:'require', so the server must offer SSL.
# The default Debian/Ubuntu config points at the snakeoil self-signed cert.
sudo make-ssl-cert generate-default-snakeoil --force-overwrite >/dev/null 2>&1 || true

# Start the cluster so we can provision it (no systemd in the container).
sudo pg_ctlcluster "$PG_VER" main start 2>/dev/null || true
for _ in $(seq 1 30); do pg_isready -q && break; sleep 1; done

# --- Roles + database (idempotent) ---------------------------------------
# The Supabase-style roles let supabase/migrations/*.sql apply unchanged.
sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  if not exists (select from pg_roles where rolname='lms_app') then create role lms_app login password 'lms_local_pw'; end if;
end $$;
SQL

if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname='lms'" | grep -q 1; then
  sudo -u postgres createdb -O lms_app lms
fi

# --- Schema (apply once; migration's CREATE POLICY is not idempotent) -----
if ! sudo -u postgres psql -d lms -tAc \
    "select 1 from information_schema.tables where table_schema='lms' and table_name='kv'" | grep -q 1; then
  for f in supabase/migrations/*.sql; do
    sudo -u postgres psql -d lms -v ON_ERROR_STOP=1 -f "$f"
  done
fi

# --- Dev environment file (generated; never committed) --------------------
if [ ! -f .env.local ]; then
  cat > .env.local <<EOF
DATABASE_URL=postgres://lms_app:lms_local_pw@127.0.0.1:5432/lms
AUTH_SECRET=$(openssl rand -hex 32)
LMS_PASSWORD=math1234
LMS_TZ=Asia/Seoul
EOF
fi

# --- Node dependencies ----------------------------------------------------
npm ci

# --- Optional demo data (seed script is a no-op once populated) -----------
npm run seed || true

echo "install.sh: done"
