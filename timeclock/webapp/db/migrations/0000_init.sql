-- P1 core schema. Idempotent (safe to re-apply on every boot).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Employees. ha_username maps the Ingress X-Remote-User header (P2).
CREATE TABLE IF NOT EXISTS employees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ha_username  text UNIQUE,
  display_name text NOT NULL,
  pin_hash     text,
  role         text NOT NULL DEFAULT 'employee'
                 CHECK (role IN ('employee','lead','manager','admin')),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Time entries: the MUTABLE current truth. Every edit also writes an audit row
-- (enforced by the app service, not a DB trigger — edits are legitimate here).
CREATE TABLE IF NOT EXISTS time_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  clock_in    timestamptz NOT NULL,
  clock_out   timestamptz,
  job_id      uuid,                 -- FK to jobs added in P3
  note        text,
  edited      boolean NOT NULL DEFAULT false,   -- manager report flags these
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_employee_idx
  ON time_entries (employee_id, clock_in);

-- Append-only audit log. `payload` is the canonical serialization the hash is
-- computed over; prev_hash/hash form the tamper-evident chain (0001 hardening).
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  action      text NOT NULL,
  actor_id    uuid,
  reason      text,
  old_value   text,
  new_value   text,
  payload     text NOT NULL,
  prev_hash   char(64) NOT NULL,
  hash        char(64) NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_type, entity_id, id);
