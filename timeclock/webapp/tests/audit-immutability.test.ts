import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "@/db/migrate";
import { appendAudit } from "@/server/domain/audit/writer";
import { getPool } from "@/db/client";
import { verifyChain } from "@/server/domain/audit/hashchain";

// Runs only when a throwaway Postgres 16 is provided, e.g.:
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:55432/timeclock
const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P1 audit immutability (real Postgres)", () => {
  let admin: Pool;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL; // writer/getPool connect here
    admin = new Pool({ connectionString: URL });
    // Clean slate. DROP TABLE is DDL (not a row mutation) so it is allowed —
    // this is a fresh-DB reset, distinct from tampering with existing rows.
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(URL);
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("append-only writer inserts and the DB fills a valid hash chain", async () => {
    const a = await appendAudit({
      entityType: "time_entry",
      entityId: "entry-1",
      action: "create",
      newValue: { clockIn: "2026-07-02T08:00:00+12:00" },
    });
    const b = await appendAudit({
      entityType: "time_entry",
      entityId: "entry-1",
      action: "update",
      reason: "forgot to clock out",
      oldValue: { clockOut: null },
      newValue: { clockOut: "2026-07-02T16:30:00+12:00" },
    });

    expect(a.prevHash).toBe("0".repeat(64)); // genesis
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.prevHash).toBe(a.hash); // chain linked

    const { rows } = await admin.query(
      "SELECT prev_hash, hash, payload FROM audit_log ORDER BY id",
    );
    const chain = rows.map((r) => ({
      prevHash: r.prev_hash,
      hash: r.hash,
      payload: r.payload,
    }));
    expect(verifyChain(chain).ok).toBe(true);

    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(true);
  });

  it("UPDATE / DELETE / TRUNCATE on audit_log all raise (even as superuser)", async () => {
    await expect(
      admin.query("UPDATE audit_log SET reason = 'x' WHERE id = (SELECT min(id) FROM audit_log)"),
    ).rejects.toThrow(/append-only/);

    await expect(
      admin.query("DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log)"),
    ).rejects.toThrow(/append-only/);

    await expect(admin.query("TRUNCATE audit_log")).rejects.toThrow(/append-only/);
  });

  it("the app role cannot UPDATE/DELETE audit_log (Layer 1 privilege gate)", async () => {
    const has = async (priv: string) =>
      (
        await admin.query(
          "SELECT has_table_privilege('timeclock_app','audit_log',$1) AS ok",
          [priv],
        )
      ).rows[0].ok as boolean;

    expect(await has("SELECT")).toBe(true);
    expect(await has("INSERT")).toBe(true);
    expect(await has("UPDATE")).toBe(false);
    expect(await has("DELETE")).toBe(false);
  });

  it("hash chain DETECTS out-of-band tampering (Layer 3 backstop)", async () => {
    // Simulate a privileged attacker who disables the trigger to edit a row.
    await admin.query("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update");
    await admin.query(
      "UPDATE audit_log SET payload = payload || 'TAMPER' WHERE id = (SELECT min(id) FROM audit_log)",
    );
    await admin.query("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update");

    const { rows } = await admin.query(
      "SELECT prev_hash, hash, payload FROM audit_log ORDER BY id",
    );
    const chain = rows.map((r) => ({
      prevHash: r.prev_hash,
      hash: r.hash,
      payload: r.payload,
    }));
    expect(verifyChain(chain).ok).toBe(false);

    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(false);
  });
});
