import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { entryAmountCents } from "@/server/domain/pay/pay";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";

describe("pay maths", () => {
  it("worked minutes × hourly rate, rounded to the cent", () => {
    expect(entryAmountCents(480, 2550)).toBe(20400); // 8h × $25.50
    expect(entryAmountCents(125, 2333)).toBe(4860); // 2h05 × $23.33 = 48.6042
  });
});

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P17 pay: rate, paid marker, bonuses, tracking switch (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: AuthedWorld;
  let entryId: string;
  let openId: string;
  const req = (method: string, path: string, cookie: string, body?: unknown) =>
    app.request(path, { method, headers: jsonHeaders(cookie), body: body === undefined ? undefined : JSON.stringify(body) });
  const range = `from=${new Date(Date.now() - 7 * 86400_000).toISOString()}&to=${new Date(Date.now() + 86400_000).toISOString()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);
    // A closed 8h entry (no breaks) and an open one.
    const a = await admin.query(
      `INSERT INTO time_entries (employee_id, clock_in, clock_out)
         VALUES ($1, now() - interval '20 hours', now() - interval '12 hours') RETURNING id`,
      [w.employeeId],
    );
    entryId = a.rows[0].id;
    const b = await admin.query(
      `INSERT INTO time_entries (employee_id, clock_in) VALUES ($1, now() - interval '1 hour') RETURNING id`,
      [w.employeeId],
    );
    openId = b.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("pay screens are manager+ only", async () => {
    expect((await req("GET", "/api/pay/employees", w.employeeCookie)).status).toBe(403);
    expect((await req("GET", "/api/pay/employees", w.adminCookie)).status).toBe(200);
  });

  it("can't mark paid without a rate; with one, amount is snapshotted", async () => {
    const noRate = await req("POST", "/api/pay/mark", w.adminCookie, { entryIds: [entryId], paid: true });
    expect(noRate.status).toBe(409);
    expect((await noRate.json()).error).toBe("no_hourly_rate");

    expect((await req("PATCH", `/api/admin/employees/${w.employeeId}`, w.adminCookie, { hourlyRateCents: 2550 })).status).toBe(200);
    const sum = await (await req("GET", `/api/pay/${w.employeeId}?${range}`, w.adminCookie)).json();
    expect(sum.totals.unpaidCents).toBe(20400);

    const open = await req("POST", "/api/pay/mark", w.adminCookie, { entryIds: [openId], paid: true });
    expect((await open.json()).error).toBe("entry_still_open");

    const ok = await req("POST", "/api/pay/mark", w.adminCookie, { entryIds: [entryId], paid: true, note: "bank 28 Oct" });
    expect(ok.status).toBe(200);
    const row = await admin.query("SELECT paid_rate_cents, paid_amount_cents FROM time_entries WHERE id=$1", [entryId]);
    expect(row.rows[0]).toEqual({ paid_rate_cents: 2550, paid_amount_cents: 20400 });

    // A later rate change doesn't rewrite what was paid.
    await req("PATCH", `/api/admin/employees/${w.employeeId}`, w.adminCookie, { hourlyRateCents: 3000 });
    const after = await (await req("GET", `/api/pay/${w.employeeId}?${range}`, w.adminCookie)).json();
    expect(after.totals.paidCents).toBe(20400);
    expect(after.totals.unpaidCents).toBe(0);
  });

  it("staff can't edit paid time; unmarking reopens it", async () => {
    const res = await req("PATCH", `/api/entries/${entryId}`, w.employeeCookie, { note: "x", reason: "too late" });
    expect(res.status).toBe(423);
    expect((await res.json()).error).toBe("entry_paid");

    await req("POST", "/api/pay/mark", w.adminCookie, { entryIds: [entryId], paid: false, note: "wrong week" });
    const row = await admin.query("SELECT paid_at, paid_amount_cents FROM time_entries WHERE id=$1", [entryId]);
    expect(row.rows[0]).toEqual({ paid_at: null, paid_amount_cents: null });
  });

  it("bonuses add to what's owed, can be paid, and are voided not deleted", async () => {
    const add = await req("POST", "/api/pay/bonuses", w.adminCookie, {
      employeeId: w.employeeId,
      amountCents: 5000,
      reason: "harvest weekend",
      awardedOn: "2026-10-25",
    });
    expect(add.status).toBe(201);
    const bonusId = (await add.json()).bonusId;
    const wrong = await req("POST", "/api/pay/bonuses", w.adminCookie, {
      employeeId: w.employeeId,
      amountCents: 999,
      reason: "typo",
      awardedOn: "2026-10-25",
    });
    const wrongId = (await wrong.json()).bonusId;
    expect((await req("POST", `/api/pay/bonuses/${wrongId}/void`, w.adminCookie, { reason: "entered by mistake" })).status).toBe(200);

    const sum = await (await req("GET", `/api/pay/${w.employeeId}?${range}`, w.adminCookie)).json();
    expect(sum.totals.unpaidCents).toBe(24000 + 5000); // 8h × $30 + bonus, void excluded
    expect(sum.bonuses).toHaveLength(2);

    await req("POST", "/api/pay/mark", w.adminCookie, { bonusIds: [bonusId], paid: true });
    expect((await req("POST", `/api/pay/bonuses/${bonusId}/void`, w.adminCookie, { reason: "nope" })).status).toBe(409);

    await expect(admin.query("SET ROLE timeclock_app; DELETE FROM bonuses")).rejects.toThrow(/permission denied/);
    await admin.query("RESET ROLE");
  });

  it("pay tracking off: person drops off the pay screen and can't be paid", async () => {
    await req("PATCH", `/api/admin/employees/${w.employeeId}`, w.adminCookie, { payTracking: false });
    const list = await (await req("GET", "/api/pay/employees", w.adminCookie)).json();
    expect(list.employees.some((e: { id: string }) => e.id === w.employeeId)).toBe(false);
    expect((await req("GET", `/api/pay/${w.employeeId}?${range}`, w.adminCookie)).status).toBe(409);
    const mark = await req("POST", "/api/pay/mark", w.adminCookie, { entryIds: [entryId], paid: true });
    expect((await mark.json()).error).toBe("pay_tracking_off");
  });

  it("every pay action is audited and the chain holds", async () => {
    const { rows } = await admin.query(
      "SELECT action FROM audit_log WHERE action IN ('mark_paid','mark_unpaid','void') OR entity_type='bonus' ORDER BY id",
    );
    expect(rows.map((r) => r.action)).toEqual(["mark_paid", "mark_unpaid", "create", "create", "void", "mark_paid"]);
    const chain = await admin.query("SELECT ok FROM verify_audit_chain()");
    expect(chain.rows[0].ok).toBe(true);
  });
});
