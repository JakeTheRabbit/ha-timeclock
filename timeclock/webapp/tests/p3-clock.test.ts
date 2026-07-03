import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";
import {
  autoDeductMinutes,
  unpaidBreakMinutes,
  workedMinutes,
  AUTO_DEDUCT_MIN,
} from "@/server/domain/time/breaks";
import type { Break } from "@/db/schema";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

const mkBreak = (startMin: number, endMin: number | null, paid = false): Break =>
  ({
    id: "b",
    timeEntryId: "e",
    startAt: new Date(Date.UTC(2026, 0, 1, 0, startMin)),
    endAt: endMin == null ? null : new Date(Date.UTC(2026, 0, 1, 0, endMin)),
    paid,
    autoDeducted: false,
    createdAt: new Date(),
  }) as Break;

describe("P3 break/time domain (unit)", () => {
  it("unpaid break minutes sum; paid breaks ignored", () => {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 120));
    expect(unpaidBreakMinutes([mkBreak(0, 30), mkBreak(60, 75), mkBreak(80, 90, true)], at)).toBe(45);
  });

  it("open break counts up to `at`", () => {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 50));
    expect(unpaidBreakMinutes([mkBreak(20, null)], at)).toBe(30);
  });

  it("auto-deduct: only on long shifts with insufficient unpaid break", () => {
    expect(autoDeductMinutes(5 * 60, 0)).toBe(0); // short shift
    expect(autoDeductMinutes(7 * 60, 0)).toBe(AUTO_DEDUCT_MIN); // long, none taken
    expect(autoDeductMinutes(7 * 60, 10)).toBe(AUTO_DEDUCT_MIN - 10); // top-up
    expect(autoDeductMinutes(7 * 60, 45)).toBe(0); // already took enough
  });

  it("worked minutes = span - unpaid", () => {
    const cin = new Date(Date.UTC(2026, 0, 1, 8, 0));
    const cout = new Date(Date.UTC(2026, 0, 1, 16, 0));
    expect(workedMinutes(cin, cout, [mkBreak(0, 30)])).toBe(450);
  });
});

run("P3 clock flow (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: AuthedWorld;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("clock status starts empty; clock/in requires session", async () => {
    const anon = await app.request("/api/clock/status");
    expect(anon.status).toBe(401);
    const res = await app.request("/api/clock/status", { headers: jsonHeaders(w.employeeCookie) });
    expect((await res.json()).open).toBeNull();
  });

  it("clock in -> status open; double clock-in 409", async () => {
    const res = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);

    const again = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(409);

    const status = await app.request("/api/clock/status", { headers: jsonHeaders(w.employeeCookie) });
    expect((await status.json()).open).not.toBeNull();
  });

  it("break start/end round-trip; double-start 409", async () => {
    const start = await app.request("/api/clock/break/start", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    expect(start.status).toBe(201);
    const dbl = await app.request("/api/clock/break/start", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    expect(dbl.status).toBe(409);
    const end = await app.request("/api/clock/break/end", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
    });
    expect(end.status).toBe(200);
  });

  it("paid rest break: {paid:true} persists and status reports it", async () => {
    const start = await app.request("/api/clock/break/start", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ paid: true }),
    });
    expect(start.status).toBe(201);

    const status = await app.request("/api/clock/status", { headers: jsonHeaders(w.employeeCookie) });
    const open = (await status.json()).open;
    expect(open.onBreak.paid).toBe(true);

    // Paid rest breaks are NOT deducted from worked time.
    const row = await admin.query("SELECT paid FROM breaks ORDER BY created_at DESC LIMIT 1");
    expect(row.rows[0].paid).toBe(true);

    const end = await app.request("/api/clock/break/end", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
    });
    expect(end.status).toBe(200);
  });

  it("clock out on a long shift auto-deducts the meal break", async () => {
    // Backdate the open entry to a 7-hour shift (time_entries is mutable truth).
    await admin.query(
      "UPDATE time_entries SET clock_in = now() - interval '7 hours' WHERE clock_out IS NULL",
    );
    const res = await app.request("/api/clock/out", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Took ~0-1min of real break earlier; auto-deduct tops up to 30.
    expect(body.autoDeductedMin).toBeGreaterThan(25);
    expect(body.workedMinutes).toBeLessThanOrEqual(7 * 60 - 30 + 2);

    const autoBreaks = await admin.query("SELECT * FROM breaks WHERE auto_deducted");
    expect(autoBreaks.rowCount).toBe(1);
  });

  it("job switch closes + reopens entries under the new job", async () => {
    const mk = await app.request("/api/admin/jobs", {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ name: "Trimming", code: "TRIM" }),
    });
    expect(mk.status).toBe(201);
    const jobId = (await mk.json()).job.id;

    await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    const sw = await app.request("/api/clock/switch-job", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ jobId }),
    });
    expect(sw.status).toBe(200);

    const status = await app.request("/api/clock/status", { headers: jsonHeaders(w.employeeCookie) });
    expect((await status.json()).open.job.name).toBe("Trimming");
    await app.request("/api/clock/out", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
  });

  it("every punch is audited and the chain stays intact", async () => {
    const audit = await admin.query(
      "SELECT action, count(*)::int AS n FROM audit_log WHERE entity_type IN ('time_entry','break') GROUP BY action ORDER BY action",
    );
    const actions = Object.fromEntries(audit.rows.map((r) => [r.action, r.n]));
    expect(actions.clock_in).toBeGreaterThanOrEqual(2);
    expect(actions.clock_out).toBeGreaterThanOrEqual(2);
    expect(actions.break_start).toBe(1);
    expect(actions.break_end).toBe(1);
    expect(actions.auto_deduct).toBe(1);
    expect(actions.switch_job_open).toBe(1);

    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(true);
  });
});
