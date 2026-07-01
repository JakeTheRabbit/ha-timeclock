-- P4: correction requests (request -> lead/manager approval -> applied).

CREATE TABLE IF NOT EXISTS corrections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id uuid NOT NULL REFERENCES time_entries(id),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  requested     jsonb NOT NULL,            -- {clockIn?, clockOut?, note?}
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  reviewer_id   uuid REFERENCES employees(id),
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corrections_status_idx ON corrections (status, created_at);
CREATE INDEX IF NOT EXISTS corrections_employee_idx ON corrections (employee_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON corrections TO timeclock_app;

-- Pay periods (table now; sign-off/lock endpoints arrive in P8). A locked
-- period makes its time entries immutable (guard in domain/payperiod).
CREATE TABLE IF NOT EXISTS pay_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_at   timestamptz NOT NULL UNIQUE,
  end_at     timestamptz NOT NULL,
  locked_at  timestamptz,
  locked_by  uuid REFERENCES employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON pay_periods TO timeclock_app;

