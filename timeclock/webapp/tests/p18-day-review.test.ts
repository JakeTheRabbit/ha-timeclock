import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";
import { nzDateOf } from "@/server/domain/holidays/stat-pay";
import { tzOffset } from "@/lib/tz";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

/** Facility-local wall time on day D (YYYY-MM-DD) as an instant. */
function at(day: string, hhmm: string): string {
  const probe = new Date(`${day}T12:00:00Z`);
  return new Date(`${day}T${hhmm}:00${tzOffset(probe)}`).toISOString();
}

run("P18 day review: staff edit, modifications, acknowledge/dispute, approval lock", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: AuthedWorld;
  const D = nzDateOf(new Date(Date.now() - 5 * 86400_000)); // well past the old day-after window
  const D2 = nzDateOf(new Date(Date.now() - 4 * 86400_000));
  let morning: string;
  let afternoon: string;

  const emp = (path: string, method: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: jsonHeaders(w.employeeCookie),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const mgr = (path: string, method: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: jsonHeaders(w.adminCookie),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);
  }, 60_000);

  afterAll(async () => {
    await admin.end();
  });

  it("staff add a forgotten shift on an old day (no edit window any more)", async () => {
    const res = await emp("/entries", "POST", {
      clockIn: at(D, "07:00"),
      clockOut: at(D, "11:30"),
      reason: "forgot to clock in",
    });
    expect(res.status).toBe(201);
    morning = (await res.json()).entryId;
  });

  it("staff add a second start/finish on the same day (left site and came back)", async () => {
    const res = await emp("/entries", "POST", {
      clockIn: at(D, "13:00"),
      clockOut: at(D, "16:00"),
      reason: "went to supplier, came back",
    });
    expect(res.status).toBe(201);
    afternoon = (await res.json()).entryId;
  });

  it("overlapping shifts are refused", async () => {
    const res = await emp("/entries", "POST", {
      clockIn: at(D, "11:00"),
      clockOut: at(D, "14:00"),
      reason: "overlap",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("overlaps_other_entry");
  });

  it("staff edit, add and remove breaks", async () => {
    const add = await emp(`/entries/${morning}/breaks`, "POST", {
      startAt: at(D, "09:00"),
      endAt: at(D, "09:15"),
      paid: true,
      reason: "smoko",
    });
    expect(add.status).toBe(201);
    const breakId = (await add.json()).breakId;

    const clash = await emp(`/entries/${morning}/breaks`, "POST", {
      startAt: at(D, "09:10"),
      endAt: at(D, "09:20"),
      reason: "clash",
    });
    expect((await clash.json()).error).toBe("breaks_overlap");

    const edit = await emp(`/entries/${morning}/breaks/${breakId}`, "PATCH", {
      endAt: at(D, "09:20"),
      reason: "was 20 min",
    });
    expect(edit.status).toBe(200);

    const noReason = await emp(`/entries/${morning}/breaks/${breakId}`, "DELETE", {});
    expect(noReason.status).toBe(400);
    const del = await emp(`/entries/${morning}/breaks/${breakId}`, "DELETE", { reason: "no break taken" });
    expect(del.status).toBe(200);
    const { rows } = await admin.query("SELECT count(*)::int n FROM breaks WHERE time_entry_id = $1", [morning]);
    expect(rows[0].n).toBe(0);
  });

  it("staff edit and remove whole entries", async () => {
    const edit = await emp(`/entries/${afternoon}`, "PATCH", { clockOut: at(D, "16:30"), reason: "left later" });
    expect(edit.status).toBe(200);

    const extra = await emp("/entries", "POST", { clockIn: at(D, "17:00"), clockOut: at(D, "18:00"), reason: "test" });
    const extraId = (await extra.json()).entryId;
    const del = await emp(`/entries/${extraId}`, "DELETE", { reason: "added by mistake" });
    expect(del.status).toBe(200);
    const gone = await admin.query("SELECT 1 FROM time_entries WHERE id = $1", [extraId]);
    expect(gone.rowCount).toBe(0);
    const audit = await admin.query(
      "SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'self_edit_remove'",
      [extraId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("staff can't touch someone else's entry", async () => {
    const own = await mgr("/entries", "POST", {
      employeeId: w.adminId,
      clockIn: at(D, "08:00"),
      clockOut: at(D, "09:00"),
      reason: "manager shift",
    });
    const id = (await own.json()).entryId;
    const res = await emp(`/entries/${id}`, "DELETE", { reason: "nope" });
    expect(res.status).toBe(403);
  });

  it("every staff change is on the manager's list with its reason", async () => {
    const res = await mgr("/review/modifications", "GET");
    expect(res.status).toBe(200);
    const { modifications } = await res.json();
    const kinds = modifications.map((m: { kind: string }) => m.kind).sort();
    expect(kinds).toEqual(
      ["break_add", "break_edit", "break_remove", "entry_add", "entry_add", "entry_add", "entry_edit", "entry_remove"].sort(),
    );
    expect(modifications.every((m: { reason: string; status: string }) => m.reason && m.status === "pending")).toBe(true);
    // Manager's own edits are audited but not put on the review list.
    expect(modifications.every((m: { employeeId: string }) => m.employeeId === w.employeeId)).toBe(true);
    expect(modifications[0].employeeName).toBe("Stew");

    // Staff can't read the manager list.
    expect((await emp("/review/modifications", "GET")).status).toBe(403);
  });

  it("acknowledge = read it; dispute opens a conversation", async () => {
    const { modifications } = await (await mgr("/review/modifications", "GET")).json();
    const [first, second, ...rest] = modifications;

    expect((await mgr(`/review/modifications/${first.id}/acknowledge`, "POST", {})).status).toBe(200);
    expect((await mgr(`/review/modifications/${first.id}/acknowledge`, "POST", {})).status).toBe(409);

    expect((await mgr(`/review/modifications/${second.id}/dispute`, "POST", {})).status).toBe(400);
    const d = await mgr(`/review/modifications/${second.id}/dispute`, "POST", { message: "I didn't see you on site then?" });
    expect(d.status).toBe(200);

    const mine = await (await emp("/review/mine/disputes", "GET")).json();
    expect(mine.modifications).toHaveLength(1);
    expect(mine.modifications[0].messages[0].body).toContain("didn't see you");

    const reply = await emp(`/review/modifications/${second.id}/messages`, "POST", { body: "I was in the veg room" });
    expect(reply.status).toBe(201);
    const thread = await (await mgr(`/review/modifications/${second.id}`, "GET")).json();
    expect(thread.modification.messages.map((m: { authorName: string }) => m.authorName)).toEqual(["Ben", "Stew"]);

    // Approval is blocked while the day has an open dispute.
    const blocked = await (await mgr("/review/days/approve", "POST", { employeeId: w.employeeId, days: [D] })).json();
    expect(blocked.approved).toEqual([]);
    expect(blocked.skipped[0].reason).toBe("dispute_open");

    expect((await mgr(`/review/modifications/${second.id}/resolve`, "POST", { note: "All good" })).status).toBe(200);

    const bulk = await (await mgr("/review/modifications/acknowledge", "POST", { ids: rest.map((m: { id: string }) => m.id) })).json();
    expect(bulk.acknowledged).toBe(rest.length);
    const open = await (await mgr("/review/modifications", "GET")).json();
    expect(open.modifications).toHaveLength(0);
  });

  it("an approved day is locked for staff, not for managers", async () => {
    const days = await (await mgr(`/review/days?employeeId=${w.employeeId}&from=${D}&to=${D2}`, "GET")).json();
    const day = days.days.find((x: { day: string }) => x.day === D);
    expect(day.entries).toHaveLength(2);
    expect(day.workedMinutes).toBe(270 + 210);
    expect(day.approved).toBeNull();

    const res = await (await mgr("/review/days/approve", "POST", { employeeId: w.employeeId, days: [D] })).json();
    expect(res.approved).toEqual([D]);

    const list = await (
      await emp(`/entries/mine?from=${at(D, "00:00")}&to=${at(D2, "23:59")}`, "GET")
    ).json();
    expect(list.entries.every((e: { dayApproved: boolean; selfEditable: boolean }) => e.dayApproved && !e.selfEditable)).toBe(true);

    expect((await (await emp(`/entries/${morning}`, "PATCH", { clockOut: at(D, "12:00"), reason: "x x x" })).json()).error).toBe(
      "day_approved",
    );
    expect((await emp(`/entries/${morning}`, "DELETE", { reason: "remove" })).status).toBe(423);
    expect(
      (await emp(`/entries/${morning}/breaks`, "POST", { startAt: at(D, "10:00"), endAt: at(D, "10:10"), reason: "brk" })).status,
    ).toBe(423);
    expect(
      (await emp("/entries", "POST", { clockIn: at(D, "19:00"), clockOut: at(D, "20:00"), reason: "late" })).status,
    ).toBe(423);

    // Moving a shift from an open day INTO the approved day is refused too.
    const other = await emp("/entries", "POST", { clockIn: at(D2, "07:00"), clockOut: at(D2, "08:00"), reason: "early" });
    const otherId = (await other.json()).entryId;
    expect((await emp(`/entries/${otherId}`, "PATCH", { clockIn: at(D, "20:00"), reason: "moved" })).status).toBe(423);

    // Manager still can.
    expect((await mgr(`/entries/${morning}`, "PATCH", { clockOut: at(D, "11:45"), reason: "manager fix" })).status).toBe(200);
    expect((await mgr(`/entries/${morning}/breaks`, "POST", { startAt: at(D, "10:00"), endAt: at(D, "10:30"), reason: "lunch" })).status).toBe(201);

    // Staff status on My hours.
    const mine = await (await emp(`/review/mine?from=${D}&to=${D2}`, "GET")).json();
    expect(mine.approvedDays).toEqual([D]);
  });

  it("managers remove breaks (incl. auto-deducted) too", async () => {
    const { rows } = await admin.query("SELECT id FROM breaks WHERE time_entry_id = $1", [morning]);
    await admin.query("UPDATE breaks SET auto_deducted = true WHERE id = $1", [rows[0].id]);
    const res = await mgr(`/entries/${morning}/breaks/${rows[0].id}`, "DELETE", { reason: "took no lunch" });
    expect(res.status).toBe(200);
  });

  it("a manager can take an approval back (reason required), reopening staff edits", async () => {
    expect((await mgr("/review/days/unapprove", "POST", { employeeId: w.employeeId, day: D })).status).toBe(400);
    expect(
      (await mgr("/review/days/unapprove", "POST", { employeeId: w.employeeId, day: D, reason: "Stew needs to fix" })).status,
    ).toBe(200);
    expect((await emp(`/entries/${morning}`, "PATCH", { clockOut: at(D, "11:50"), reason: "fixed" })).status).toBe(200);
  });

  it("open shifts block approving their day", async () => {
    const today = nzDateOf(new Date());
    await emp("/clock/in", "POST", {});
    const res = await (await mgr("/review/days/approve", "POST", { employeeId: w.employeeId, days: [today] })).json();
    expect(res.skipped[0].reason).toBe("open_entry");
  });

  it("audit chain stays intact", async () => {
    const v = await (await mgr("/manager/audit/verify", "GET")).json();
    expect(v.ok).toBe(true);
  });
});
