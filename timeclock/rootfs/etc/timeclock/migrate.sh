#!/usr/bin/with-contenv bashio
# One-shot: wait for PG, ensure the app DB, apply idempotent SQL migrations as
# the owner (postgres). The runtime app connects as the non-superuser role
# `timeclock_app` created by 0002_grants.sql — never as postgres.
set -e

bashio::log.info "Waiting for PostgreSQL to accept connections"
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1 && break
  sleep 1
done
pg_isready -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1 \
  || bashio::exit.nok "PostgreSQL did not become ready in time"

if ! psql -h 127.0.0.1 -U postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='timeclock'" | grep -q 1; then
  bashio::log.info "Creating database 'timeclock'"
  createdb -h 127.0.0.1 -U postgres timeclock
fi

shopt -s nullglob
for f in /opt/timeclock/migrations/*.sql; do
  bashio::log.info "Applying migration $(basename "$f")"
  psql -h 127.0.0.1 -U postgres -d timeclock -v ON_ERROR_STOP=1 -f "$f"
done
bashio::log.info "Migrations applied (audit immutability active)"
