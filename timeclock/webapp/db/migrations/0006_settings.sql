-- P5: single-row settings document (zod-validated app-side).
CREATE TABLE IF NOT EXISTS settings (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  doc        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id, doc) VALUES (1, '{}') ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE ON settings TO timeclock_app;
