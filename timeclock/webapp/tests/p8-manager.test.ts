import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P8 manager board + pay-period lock + timesheet (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;
  let pastPeriodId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);

    // A finished period in the past (Mon 2026-06-01 .. Mon 2026-06-15 NZ).
    const { rows } = await admin.query(
      `INSERT INTO pay_periods (start_at, end_at)
       VALUES ('2026-05-31T12:00:00Z', '2026-06-14T12:00:00Z') RETURNING id`,
    );
    pastPeriodId = rows[0].id;

    // Week inside it: Mon-Fri 9h/day => 45h: daily OT 1h/day (5h), weekly none extra.
    for (let d = 0; d < 5; d++) {
      await admin.query(
        `INSERT INTO time_entries (employee_id, clock_in, clock_out, edited)
         VALUES ($1,
           ('2026-06-01T20:00:00Z'::timestamptz + ($2 || ' days')::interval),
           ('2026-06-02T05:00:00Z'::timestamptz + ($2 || ' days')::interval),
           $3)`,
        [w.employeeId, String(d), d === 0], // first day flagged edited
      );
    }
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("live board shows clocked-in staff with break state", async () => {
    await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    await app.request("/api/clock/break/start", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });

    const res = await app.request("/api/manager/board", { headers: jsonHeaders(w.adminCookie) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clockedIn).toHaveLength(1);
    expect(body.clockedIn[0].employeeName).toBe("Stew");
    expect(body.clockedIn[0].onBreak).toBe(true);

    await app.request("/api/clock/break/end", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
    await app.request("/api/clock/out", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
  });

  it("employee is denied the board (403)", async () => {
    const res = await app.request("/api/manager/board", { headers: jsonHeaders(w.employeeCookie) });
    expect(res.status).toBe(403);
  });

  it("pay-periods list materializes the current period", async () => {
    const res = await app.request("/api/manager/pay-periods", { headers: jsonHeaders(w.adminCookie) });
    const { periods } = await res.json();
    expect(periods.length).toBeGreaterThanOrEqual(2); // current + seeded past
  });

  it("timesheet computes OT + edited flags for the past period", async () => {
    const res = await app.request(`/api/manager/pay-periods/${pastPeriodId}/timesheet`, {
      headers: jsonHeaders(w.adminCookie),
    });
    expect(res.status).toBe(200);
    const { rows } = await res.json();
    const stew = rows.find((r: { employeeId: string }) => r.employeeId === w.employeeId);
    expect(stew).toBeTruthy();
    expect(stew.totals.workedMin).toBe(45 * 60);
    expect(stew.totals.ot1Min).toBe(5 * 60); // 1h/day over 8h
    expect(stew.totals.ordinaryMin).toBe(40 * 60);
    expect(stew.totals.editedDays).toBe(1);
    // 9h with no breaks -> compliance flags on every day
    expect(stew.totals.complianceFlagCount).toBeGreaterThan(0);
  });

  it("lock: finished period locks; unfinished 409; edits inside 423", async () => {
    const current = await app.request("/api/manager/pay-periods", { headers: jsonHeaders(w.adminCookie) });
    const { periods } = await current.json();
    const unfinished = periods.find((p: { lockedAt: string | null; endAt: string }) => new Date(p.endAt) > new Date());
    if (unfinished) {
      const notYet = await app.request(`/api/manager/pay-periods/${unfinished.id}/lock`, {
        method: "POST",
        headers: jsonHeaders(w.adminCookie),
      });
      expect(notYet.status).toBe(409);
    }

    const lock = await app.request(`/api/manager/pay-periods/${pastPeriodId}/lock`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
    });
    expect(lock.status).toBe(200);

    // Entry inside the locked period can no longer be edited.
    const { rows } = await admin.query(
      "SELECT id FROM time_entries WHERE clock_in < '2026-06-14T12:00:00Z' LIMIT 1",
    );
    const edit = await app.request(`/api/entries/${rows[0].id}`, {
      method: "PATCH",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ note: "sneak", reason: "post-lock" }),
    });
    expect(edit.status).toBe(423);

    const relock = await app.request(`/api/manager/pay-periods/${pastPeriodId}/lock`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
    });
    expect(relock.status).toBe(409); // already locked
  });

  it("unlock needs admin + reason; audited", async () => {
    const noReason = await app.request(`/api/manager/pay-periods/${pastPeriodId}/unlock`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({}),
    });
    expect(noReason.status).toBe(400);

    const ok = await app.request(`/api/manager/pay-periods/${pastPeriodId}/unlock`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ reason: "payroll correction after sign-off" }),
    });
    expect(ok.status).toBe(200);

    const audit = await admin.query(
      "SELECT count(*)::int n FROM audit_log WHERE entity_type='pay_period' AND action IN ('lock','unlock')",
    );
    expect(audit.rows[0].n).toBe(2);
  });

  it("audit viewer lists rows; chain verify endpoint reports ok", async () => {
    const rows = await app.request("/api/manager/audit?limit=10", { headers: jsonHeaders(w.adminCookie) });
    expect(rows.status).toBe(200);
    expect((await rows.json()).rows.length).toBeGreaterThan(0);

    const verify = await app.request("/api/manager/audit/verify", { headers: jsonHeaders(w.adminCookie) });
    expect((await verify.json()).ok).toBe(true);
  });
});
