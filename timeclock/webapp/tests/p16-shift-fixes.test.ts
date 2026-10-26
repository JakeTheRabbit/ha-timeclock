import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";
import { setFetchImpl } from "@/server/domain/antifraud/door-access";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

// HA history stub: the card reader swiped `swipeMinAgo` minutes ago (null = no swipe).
let swipeMinAgo: number | null = null;
setFetchImpl((async (url: string) => {
  if (!String(url).includes("/history/period/")) return new Response("[]", { status: 404 });
  const rows = [{ state: "off", last_changed: new Date(Date.now() - 4 * 3600_000).toISOString() }];
  if (swipeMinAgo != null)
    rows.push({ state: "on", last_changed: new Date(Date.now() - swipeMinAgo * 60_000).toISOString() });
  return new Response(JSON.stringify([rows]), { status: 200 });
}) as typeof fetch);

run("P16 shift fixes: double-tap, open-shift + break edits, manager edit, door flag", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: AuthedWorld;
  const post = (path: string, cookie: string, body: unknown = {}) =>
    app.request(path, { method: "POST", headers: jsonHeaders(cookie), body: JSON.stringify(body) });
  const patch = (path: string, cookie: string, body: unknown) =>
    app.request(path, { method: "PATCH", headers: jsonHeaders(cookie), body: JSON.stringify(body) });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.SUPERVISOR_TOKEN = "test-supervisor-token";
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);
  }, 60_000);

  afterAll(async () => {
    delete process.env.SUPERVISOR_TOKEN;
    await admin.end();
    await getPool().end();
  });

  it("clock-in within a minute of clocking out is refused (double tap)", async () => {
    expect((await post("/api/clock/in", w.employeeCookie)).status).toBe(201);
    expect((await post("/api/clock/out", w.employeeCookie)).status).toBe(200);
    const again = await post("/api/clock/in", w.employeeCookie);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("just_clocked_out");
    // Cooldown elapsed -> allowed again.
    await admin.query("UPDATE time_entries SET clock_out = now() - interval '2 minutes'");
    swipeMinAgo = 30;
    const ok = await post("/api/clock/in", w.employeeCookie);
    expect(ok.status).toBe(201);
    expect((await ok.json()).fraudFlags).toEqual([]);
  });

  it("staff fix the start time of a shift they're still clocked into", async () => {
    const { rows } = await admin.query("SELECT id FROM time_entries WHERE clock_out IS NULL");
    const newIn = new Date(Date.now() - 20 * 60_000).toISOString();
    const res = await patch(`/api/entries/${rows[0].id}`, w.employeeCookie, { clockIn: newIn, reason: "forgot to tap in" });
    expect(res.status).toBe(200);
    const after = await admin.query("SELECT clock_in, clock_out FROM time_entries WHERE id=$1", [rows[0].id]);
    expect(after.rows[0].clock_out).toBeNull();
    expect(new Date(after.rows[0].clock_in).toISOString().slice(0, 16)).toBe(newIn.slice(0, 16));

    const future = await patch(`/api/entries/${rows[0].id}`, w.employeeCookie, {
      clockIn: new Date(Date.now() + 3600_000).toISOString(),
      reason: "time travel",
    });
    expect(future.status).toBe(400);
    expect((await future.json()).error).toBe("clock_in_in_future");
  });

  it("staff add and fix breaks on the open shift; breaks must sit inside it", async () => {
    const { rows } = await admin.query("SELECT id FROM time_entries WHERE clock_out IS NULL");
    const id = rows[0].id;
    const add = await post(`/api/entries/${id}/breaks`, w.employeeCookie, {
      startAt: new Date(Date.now() - 15 * 60_000).toISOString(),
      endAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      paid: true,
      reason: "forgot to tap break",
    });
    expect(add.status).toBe(201);
    const breakId = (await add.json()).breakId;

    const fix = await patch(`/api/entries/${id}/breaks/${breakId}`, w.employeeCookie, {
      paid: false,
      reason: "it was my lunch",
    });
    expect(fix.status).toBe(200);

    const outside = await post(`/api/entries/${id}/breaks`, w.employeeCookie, {
      startAt: new Date(Date.now() - 5 * 3600_000).toISOString(),
      endAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
      reason: "before shift",
    });
    expect(outside.status).toBe(400);
    expect((await outside.json()).error).toBe("break_outside_shift");

    const audit = await admin.query(
      "SELECT action, old_value, new_value FROM audit_log WHERE entity_type='break' AND action LIKE 'self_edit%' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["self_edit_break_add", "self_edit_break"]);
    expect(audit.rows[1].new_value).toContain('"paid":false');
  });

  it("a moved start time with no swipe before it gets flagged no_door_access", async () => {
    await admin.query("UPDATE employees SET access_entities = '{binary_sensor.rfid_stew}' WHERE id=$1", [w.employeeId]);
    const { rows } = await admin.query("SELECT id FROM time_entries WHERE clock_out IS NULL");
    swipeMinAgo = null;
    const res = await patch(`/api/entries/${rows[0].id}`, w.employeeCookie, {
      clockIn: new Date(Date.now() - 25 * 60_000).toISOString(),
      reason: "moved earlier",
    });
    expect(res.status).toBe(200);
    const after = await admin.query("SELECT fraud_flags FROM time_entries WHERE id=$1", [rows[0].id]);
    expect(after.rows[0].fraud_flags).toEqual(["no_door_access"]);
  });

  it("clock-in with readers mapped but no swipe is flagged; managers edit any day", async () => {
    await post("/api/clock/out", w.employeeCookie);
    await admin.query("UPDATE time_entries SET clock_out = now() - interval '2 minutes' WHERE clock_out > now() - interval '1 minute'");
    swipeMinAgo = null;
    const res = await post("/api/clock/in", w.employeeCookie);
    expect(res.status).toBe(201);
    expect((await res.json()).fraudFlags).toEqual(["no_door_access"]);

    // An entry well past the staff window: staff locked out, manager can edit.
    const { rows } = await admin.query(
      `INSERT INTO time_entries (employee_id, clock_in, clock_out)
         VALUES ($1, now() - interval '6 days', now() - interval '6 days' + interval '4 hours') RETURNING id`,
      [w.employeeId],
    );
    const body = { clockOut: new Date(Date.now() - 6 * 86400_000 + 5 * 3600_000).toISOString(), reason: "camera check" };
    expect((await patch(`/api/entries/${rows[0].id}`, w.employeeCookie, body)).status).toBe(423);
    expect((await patch(`/api/entries/${rows[0].id}`, w.adminCookie, body)).status).toBe(200);
  });

  it("manager can list an employee's entries with flags", async () => {
    const from = new Date(Date.now() - 14 * 86400_000).toISOString();
    const to = new Date(Date.now() + 86400_000).toISOString();
    const res = await app.request(`/api/manager/entries?employeeId=${w.employeeId}&from=${from}&to=${to}`, {
      headers: jsonHeaders(w.adminCookie),
    });
    expect(res.status).toBe(200);
    const { entries } = await res.json();
    expect(entries.length).toBe(4);
    expect(entries.some((e: { fraudFlags: string[] }) => e.fraudFlags.includes("no_door_access"))).toBe(true);
    const staff = await app.request(`/api/manager/entries?employeeId=${w.employeeId}&from=${from}&to=${to}`, {
      headers: jsonHeaders(w.employeeCookie),
    });
    expect(staff.status).toBe(403);
  });

  it("audit chain intact after all of it", async () => {
    const { rows } = await admin.query("SELECT ok FROM verify_audit_chain()");
    expect(rows[0].ok).toBe(true);
  });
});
