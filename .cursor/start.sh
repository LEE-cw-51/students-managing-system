#!/usr/bin/env bash
# Per-boot startup: bring the local PostgreSQL server up and wait for it.
set -euo pipefail

PG_VER="$(ls /etc/postgresql 2>/dev/null | sort -n | tail -1)"
PG_VER="${PG_VER:-16}"

sudo pg_ctlcluster "$PG_VER" main start 2>/dev/null || true
for _ in $(seq 1 30); do pg_isready -q && break; sleep 1; done

echo "start.sh: postgres ready"
