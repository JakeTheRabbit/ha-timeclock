-- P6: rostered shifts. date = NZ calendar date; start/end = minutes from
-- midnight local (avoids DST math on stored instants).
CREATE TABLE IF NOT EXISTS rosters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id),
  shift_date  date NOT NULL,
  start_min   int NOT NULL CHECK (start_min >= 0 AND start_min < 1440),
  end_min     int NOT NULL CHECK (end_min > 0 AND end_min <= 1440),
  job_id      uuid REFERENCES jobs(id),
  note        text,
  cancelled   boolean NOT NULL DEFAULT false,
  created_by  uuid NOT NULL REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS rosters_date_idx ON rosters (shift_date, employee_id);
CREATE INDEX IF NOT EXISTS rosters_employee_idx ON rosters (employee_id, shift_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON rosters TO timeclock_app;
