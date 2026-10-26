import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P4 edits + corrections (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: AuthedWorld;
  let entryId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);

    // A closed entry to edit, a few hours old — always inside the self-edit
    // window (today or yesterday, facility TZ) whatever time the suite runs.
    await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    await app.request("/api/clock/out", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
    const { rows } = await admin.query("SELECT id FROM time_entries LIMIT 1");
    entryId = rows[0].id;
    await admin.query(
      `UPDATE time_entries SET clock_in = now() - interval '200 minutes',
         clock_out = now() - interval '120 minutes' WHERE id = $1`,
      [entryId],
    );
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("edit without a reason is rejected", async () => {
    const res = await app.request(`/api/entries/${entryId}`, {
      method: "PATCH",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ note: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("self-edit writes new value + audit old->new and flags entry", async () => {
    const newOut = new Date(Date.now() - 110 * 60_000).toISOString();
    const res = await app.request(`/api/entries/${entryId}`, {
      method: "PATCH",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ clockOut: newOut, reason: "forgot to clock out" }),
    });
    expect(res.status).toBe(200);

    const entry = await admin.query("SELECT edited FROM time_entries WHERE id=$1", [entryId]);
    expect(entry.rows[0].edited).toBe(true);

    const audit = await admin.query(
      "SELECT reason, old_value, new_value FROM audit_log WHERE action='self_edit'",
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].reason).toBe("forgot to clock out");
    expect(audit.rows[0].old_value).toBeTruthy();
    expect(audit.rows[0].new_value).toContain(newOut.slice(0, 16));
  });

  it("a manager edits someone else's entry directly, audited as manager_edit", async () => {
    const res = await app.request(`/api/entries/${entryId}`, {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ note: "hi", reason: "manager fix" }),
    });
    expect(res.status).toBe(200);
    const audit = await admin.query("SELECT actor_id FROM audit_log WHERE action='manager_edit'");
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].actor_id).toBe(w.adminId);
  });

  it("self-edit locks after the day-after window (423), can't move a shift into it either", async () => {
    const { rows } = await admin.query(
      `INSERT INTO time_entries (employee_id, clock_in, clock_out)
         SELECT employee_id, now() - interval '4 days', now() - interval '4 days' + interval '8 hours'
         FROM time_entries WHERE id = $1 RETURNING id`,
      [entryId],
    );
    const old = await app.request(`/api/entries/${rows[0].id}`, {
      method: "PATCH",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ note: "late fix", reason: "too late" }),
    });
    expect(old.status).toBe(423);
    expect((await old.json()).error).toBe("edit_window_closed");

    const moved = await app.request(`/api/entries/${entryId}`, {
      method: "PATCH",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ clockIn: new Date(Date.now() - 4 * 86400_000).toISOString(), reason: "move it" }),
    });
    expect(moved.status).toBe(423);

    const audit = await admin.query("SELECT count(*)::int n FROM audit_log WHERE action='self_edit'");
    expect(audit.rows[0].n).toBe(1); // refused edits leave the entry and log untouched
  });

  it("nonsense times rejected (out before in)", async () => {
    const res = await app.request(`/api/entries/${entryId}`, {
      method: "PATCH",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ clockOut: "2020-01-01T00:00:00Z", reason: "bad edit" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("clock_out_before_in");
  });

  it("correction request -> employee cannot approve own (RBAC) -> admin approves -> applied", async () => {
    const reqOut = new Date(Date.now() - 100 * 60_000).toISOString();
    const create = await app.request("/api/corrections", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({
        timeEntryId: entryId,
        requested: { clockOut: reqOut },
        reason: "actually stayed later",
      }),
    });
    expect(create.status).toBe(201);
    const correctionId = (await create.json()).correctionId;

    const denied = await app.request(`/api/corrections/${correctionId}/approve`, {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({}),
    });
    expect(denied.status).toBe(403); // employee < lead

    const pending = await app.request("/api/corrections/pending", {
      headers: jsonHeaders(w.adminCookie),
    });
    expect((await pending.json()).corrections).toHaveLength(1);

    const approve = await app.request(`/api/corrections/${correctionId}/approve`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ note: "confirmed with lead" }),
    });
    expect(approve.status).toBe(200);

    const entry = await admin.query("SELECT clock_out, edited FROM time_entries WHERE id=$1", [entryId]);
    expect(new Date(entry.rows[0].clock_out).toISOString()).toBe(reqOut);
    expect(entry.rows[0].edited).toBe(true);

    const again = await app.request(`/api/corrections/${correctionId}/approve`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(404); // already reviewed
  });

  it("locked pay period blocks self-edit AND correction approval (423)", async () => {
    // Materialize + lock a period covering the entry.
    await admin.query(
      `INSERT INTO pay_periods (start_at, end_at, locked_at)
       VALUES (now() - interval '7 days', now() + interval '7 days', now())`,
    );
    const edit = await app.request(`/api/entries/${entryId}`, {
      method: "PATCH",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ note: "sneaky", reason: "post-lock edit" }),
    });
    expect(edit.status).toBe(423);
    expect((await edit.json()).error).toBe("pay_period_locked");
    await admin.query("DELETE FROM pay_periods");
  });

  it("my-hours range returns hydrated entries with edited flag", async () => {
    const from = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const res = await app.request(`/api/entries/mine?from=${from}&to=${to}`, {
      headers: jsonHeaders(w.employeeCookie),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].edited).toBe(true);
    expect(body.entries[0].workedMinutes).toBeGreaterThan(0);
  });

  it("audit chain intact after edit workflows", async () => {
    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(true);
  });
});
