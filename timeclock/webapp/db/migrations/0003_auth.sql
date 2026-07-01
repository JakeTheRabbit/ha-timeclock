-- P2: sessions + kiosk devices. Idempotent.

-- Kiosk devices. token_hash = sha256(token); the raw token lives only in the
-- device's cookie, so a DB leak does not leak usable device credentials.
CREATE TABLE IF NOT EXISTS devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  token_hash  char(64) NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

-- Employee sessions (kiosk PIN logins). DB-backed so they are revocable.
CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  device_id    uuid REFERENCES devices(id),
  ha_user_id   text,
  ha_user_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_employee_idx ON sessions (employee_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON devices  TO timeclock_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO timeclock_app;
