#!/usr/bin/with-contenv bashio
# One-shot: create persistent dirs and initdb the cluster on first boot only.
set -e

mkdir -p /data/postgres /data/backups /run/postgresql
chown -R postgres:postgres /data/postgres /data/backups /run/postgresql
chmod 700 /data/postgres

if [ ! -s /data/postgres/PG_VERSION ]; then
  bashio::log.info "Initializing PostgreSQL cluster (first boot)"
  # musl has no locale archive -> use C locale; loopback-only -> trust auth.
  s6-setuidgid postgres \
    initdb -D /data/postgres -E UTF8 --locale=C --auth=trust
else
  bashio::log.info "PostgreSQL cluster already present — skipping initdb"
fi
