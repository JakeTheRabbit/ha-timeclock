-- =========================================================================
-- Layer 1: the runtime app connects as a NON-superuser role that has no
-- privilege to UPDATE/DELETE audit_log at all — the triggers (0001) are the
-- backstop, this is the primary gate. DDL/migrations run as the owner
-- (postgres); the app never does.
-- Idempotent.
-- =========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'timeclock_app') THEN
    -- Loopback-only + trust auth in the add-on, so no password is needed.
    CREATE ROLE timeclock_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO timeclock_app;

-- Mutable business tables: full DML.
GRANT SELECT, INSERT, UPDATE, DELETE ON employees    TO timeclock_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_entries TO timeclock_app;

-- Audit log: append-only. SELECT + INSERT ONLY. No UPDATE/DELETE/TRUNCATE.
GRANT SELECT, INSERT ON audit_log TO timeclock_app;

-- Sequences (bigserial id) need USAGE for INSERT.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO timeclock_app;

GRANT EXECUTE ON FUNCTION verify_audit_chain() TO timeclock_app;
