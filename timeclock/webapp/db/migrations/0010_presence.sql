-- Presence-based clock reminders: per-employee HA notify target + presence
-- entity (device_tracker / person / binary_sensor / wifi-SSID sensor). The
-- add-on polls the presence entity and sends an actionable notification to the
-- notify service. Additive + nullable; employees grants are table-level so the
-- new columns inherit them (no grant change needed).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notify_service  text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS presence_entity text;
