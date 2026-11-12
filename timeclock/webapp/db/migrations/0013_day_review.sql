-- Day review (0.10.0): staff edit their own days freely until a manager
-- approves the day. Every staff change lands in `modifications` (with the
-- staff reason) for a manager to acknowledge or dispute; a dispute opens a
-- message thread. Approvals, modifications and messages are never deleted
-- except an approval a manager revokes (audited).

CREATE TABLE IF NOT EXISTS day_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  day         date NOT NULL,                 -- facility-local calendar day
  approved_by uuid NOT NULL REFERENCES employees(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day)
);

GRANT SELECT, INSERT, DELETE ON day_approvals TO timeclock_app;

CREATE TABLE IF NOT EXISTS modifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  actor_id        uuid NOT NULL REFERENCES employees(id),
  day             date NOT NULL,
  -- No FK: a removed entry keeps its modification history.
  time_entry_id   uuid,
  kind            text NOT NULL CHECK (kind IN (
                    'entry_add','entry_edit','entry_remove',
                    'break_add','break_edit','break_remove')),
  before          jsonb,
  after           jsonb,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','acknowledged','disputed','resolved')),
  acknowledged_by uuid REFERENCES employees(id),
  acknowledged_at timestamptz,
  disputed_by     uuid REFERENCES employees(id),
  disputed_at     timestamptz,
  resolved_by     uuid REFERENCES employees(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS modifications_status_idx ON modifications (status, created_at);
CREATE INDEX IF NOT EXISTS modifications_emp_idx ON modifications (employee_id, day);

GRANT SELECT, INSERT, UPDATE ON modifications TO timeclock_app;

CREATE TABLE IF NOT EXISTS modification_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modification_id uuid NOT NULL REFERENCES modifications(id),
  author_id       uuid NOT NULL REFERENCES employees(id),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS modification_messages_mod_idx ON modification_messages (modification_id, created_at);

GRANT SELECT, INSERT ON modification_messages TO timeclock_app;

-- A removed entry takes its correction requests with it (the audit log keeps
-- both). Before this, the FK blocked removing an entry at all.
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_time_entry_id_fkey;
ALTER TABLE corrections ADD CONSTRAINT corrections_time_entry_id_fkey
  FOREIGN KEY (time_entry_id) REFERENCES time_entries(id) ON DELETE CASCADE;
