-- P3: jobs (project costing) + breaks. Idempotent.

CREATE TABLE IF NOT EXISTS jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  code       text UNIQUE,               -- payroll/costing code
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Breaks belong to a time entry. paid=false breaks are deducted from worked time.
CREATE TABLE IF NOT EXISTS breaks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_entry_id uuid NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  start_at      timestamptz NOT NULL,
  end_at        timestamptz,
  paid          boolean NOT NULL DEFAULT false,
  auto_deducted boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS breaks_entry_idx ON breaks (time_entry_id);

-- FK for the job_id column created in 0000 (guarded: only add once).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_job_id_fkey'
  ) THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT time_entries_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON jobs   TO timeclock_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON breaks TO timeclock_app;
