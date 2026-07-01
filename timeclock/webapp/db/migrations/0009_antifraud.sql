-- P11: punch forensics on time entries. Additive, nullable — old rows fine.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS geo_lat  double precision;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS geo_lng  double precision;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS punch_ip text;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS photo_path text;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS fraud_flags jsonb NOT NULL DEFAULT '[]'::jsonb;
