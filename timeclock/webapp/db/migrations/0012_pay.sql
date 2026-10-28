-- Pay tracking: per-employee hourly rate + on/off switch, a paid marker on
-- each time entry (rate + amount snapshotted when marked paid, so later rate
-- changes never rewrite history), and bonuses. Money is integer cents.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS hourly_rate_cents integer CHECK (hourly_rate_cents >= 0);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pay_tracking boolean NOT NULL DEFAULT true;

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS paid_at           timestamptz;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS paid_by           uuid REFERENCES employees(id);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS paid_rate_cents   integer;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS paid_amount_cents integer;

-- Bonuses are never deleted: a wrong one is voided (with a reason), and every
-- change is in the audit log. The app role gets no DELETE here.
CREATE TABLE IF NOT EXISTS bonuses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason       text NOT NULL,
  awarded_on   date NOT NULL,
  created_by   uuid NOT NULL REFERENCES employees(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  paid_at      timestamptz,
  paid_by      uuid REFERENCES employees(id),
  voided_at    timestamptz,
  voided_by    uuid REFERENCES employees(id),
  void_reason  text
);
CREATE INDEX IF NOT EXISTS bonuses_emp_idx ON bonuses (employee_id, awarded_on);

GRANT SELECT, INSERT, UPDATE ON bonuses TO timeclock_app;
