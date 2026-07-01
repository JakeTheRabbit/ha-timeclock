import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";
import { ANNUAL_ACCRUAL_RATE } from "@/server/domain/leave/accrual";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P7 leave + accrual (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);

    // One closed 8h shift for Stew (yesterday).
    await admin.query(
      `INSERT INTO time_entries (employee_id, clock_in, clock_out)
       VALUES ($1, now() - interval '32 hours', now() - interval '24 hours')`,
      [w.employeeId],
    );
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("accrual engine converts worked hours to annual-leave hours (4/52)", async () => {
    const res = await app.request("/api/leave/accrue", {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
    });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    const mine = results.find((r: { employeeId: string }) => r.employeeId === w.employeeId);
    expect(mine.hoursWorked).toBeCloseTo(8, 1);
    expect(mine.accruedHours).toBeCloseTo(8 * ANNUAL_ACCRUAL_RATE, 2); // ≈0.62

    // Idempotent: second run accrues nothing new.
    const again = await app.request("/api/leave/accrue", {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
    });
    expect((await again.json()).results).toHaveLength(0);
  });

  it("balance too low -> request 409; adjustment tops up; request then succeeds", async () => {
    const req = () =>
      app.request("/api/leave", {
        method: "POST",
        headers: jsonHeaders(w.employeeCookie),
        body: JSON.stringify({
          type: "annual",
          startDate: "2026-08-03",
          endDate: "2026-08-03",
          hours: 8,
          note: "day off",
        }),
      });

    const insufficient = await req();
    expect(insufficient.status).toBe(409); // balance ≈0.62h < 8h

    const adjust = await app.request("/api/leave/adjust", {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({
        employeeId: w.employeeId,
        type: "annual",
        deltaHours: 40,
        note: "opening balance migration",
      }),
    });
    expect(adjust.status).toBe(200);

    const ok = await req();
    expect(ok.status).toBe(201);
  });

  it("approve deducts the ledger; balance reflects it", async () => {
    const pending = await app.request("/api/leave/pending", { headers: jsonHeaders(w.adminCookie) });
    const [p] = (await pending.json()).requests;
    const approve = await app.request(`/api/leave/${p.id}/approve`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
    });
    expect(approve.status).toBe(200);

    const mine = await app.request("/api/leave/mine", { headers: jsonHeaders(w.employeeCookie) });
    const body = await mine.json();
    expect(body.requests[0].status).toBe("approved");
    // 0.62 accrued + 40 adjust - 8 taken ≈ 32.62
    expect(body.balances.annual).toBeCloseTo(0.62 + 40 - 8, 1);
  });

  it("unpaid leave skips balance checks entirely", async () => {
    const res = await app.request("/api/leave", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ type: "unpaid", startDate: "2026-09-01", endDate: "2026-09-05", hours: 40 }),
    });
    expect(res.status).toBe(201);
  });

  it("employee cannot run accrual or adjust (403); audit chain intact", async () => {
    const acc = await app.request("/api/leave/accrue", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
    });
    expect(acc.status).toBe(403);

    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(true);
  });
});
