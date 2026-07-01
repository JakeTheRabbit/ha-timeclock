-- =========================================================================
-- Immutable, hash-chained audit_log  (Layer 2 = triggers, Layer 3 = chain).
-- Idempotent: functions use CREATE OR REPLACE; triggers are dropped first.
-- =========================================================================

-- ---- Layer 3: hash chain, computed authoritatively in the DB ----
-- hash_n = sha256( hash_{n-1} || payload_n ),  genesis prev = 64 zeros.
CREATE OR REPLACE FUNCTION audit_log_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prev char(64);
BEGIN
  -- Serialize all audit inserts so the chain cannot fork under concurrency.
  -- Xact-scoped advisory lock: released automatically at commit/rollback.
  PERFORM pg_advisory_xact_lock(4923372010);

  SELECT a.hash INTO prev FROM audit_log a ORDER BY a.id DESC LIMIT 1;
  IF prev IS NULL THEN
    prev := repeat('0', 64);
  END IF;

  -- Client-supplied prev_hash/hash are ignored: the DB is the source of truth.
  NEW.prev_hash := prev;
  NEW.hash := encode(digest(prev || NEW.payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_hash_chain_biu ON audit_log;
CREATE TRIGGER audit_log_hash_chain_biu
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_hash_chain();

-- ---- Layer 2: block UPDATE / DELETE / TRUNCATE ----
CREATE OR REPLACE FUNCTION audit_log_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- TRUNCATE bypasses row-level triggers, so guard it at statement level.
CREATE OR REPLACE FUNCTION audit_log_block_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: TRUNCATE is not permitted'
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_truncate();

-- ---- Integrity verifier: walk the chain, report the first break ----
CREATE OR REPLACE FUNCTION verify_audit_chain()
RETURNS TABLE(ok boolean, broken_at bigint, detail text)
LANGUAGE plpgsql
AS $$
DECLARE
  r audit_log%ROWTYPE;
  expected_prev char(64) := repeat('0', 64);
  computed char(64);
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id ASC LOOP
    IF r.prev_hash <> expected_prev THEN
      ok := false; broken_at := r.id; detail := 'prev_hash breaks chain link';
      RETURN NEXT; RETURN;
    END IF;
    computed := encode(digest(r.prev_hash || r.payload, 'sha256'), 'hex');
    IF r.hash <> computed THEN
      ok := false; broken_at := r.id; detail := 'hash mismatch (payload tampered)';
      RETURN NEXT; RETURN;
    END IF;
    expected_prev := r.hash;
  END LOOP;
  ok := true; broken_at := NULL; detail := 'chain intact';
  RETURN NEXT;
END;
$$;
