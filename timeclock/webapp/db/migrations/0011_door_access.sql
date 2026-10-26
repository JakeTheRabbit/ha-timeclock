-- Door-access cross-check: the HA card-reader entities (binary_sensor that
-- turns "on" per swipe) belonging to each employee. A clock-in with no swipe
-- on any of them in the lookback window is flagged no_door_access. Additive;
-- employees grants are table-level so the column inherits them.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS access_entities text[] NOT NULL DEFAULT '{}';
