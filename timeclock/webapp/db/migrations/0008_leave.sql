-- P7: leave requests + balance ledger. The LEDGER is the balance truth —
-- balances are sums over deltas, so history is inspectable and adjustments
-- are first-class rows rather than silent updates.

CREATE TABLE IF NOT EXISTS leave_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  type        text NOT NULL CHECK (type IN ('annual','sick','bereavement','alt_holiday','unpaid')),
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  hours       numeric(6,2) NOT NULL CHECK (hours > 0),
  note        text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewer_id uuid REFERENCES employees(id),
  reviewed_at timestamptz,
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS leave_requests_emp_idx ON leave_requests (employee_id, created_at);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx ON leave_requests (status, created_at);

CREATE TABLE IF NOT EXISTS leave_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  type        text NOT NULL CHECK (type IN ('annual','sick','bereavement','alt_holiday')),
  delta_hours numeric(8,2) NOT NULL,
  source      text NOT NULL CHECK (source IN ('accrual','request','adjustment','alt_holiday_earned')),
  ref_id      uuid,                -- leave_request id / time_entry id / null
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_ledger_emp_idx ON leave_ledger (employee_id, type);

-- Accrual bookmark: worked time already accrued (per employee).
CREATE TABLE IF NOT EXISTS leave_accrual_marks (
  employee_id uuid PRIMARY KEY REFERENCES employees(id),
  accrued_through timestamptz NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON leave_requests, leave_ledger, leave_accrual_marks TO timeclock_app;
