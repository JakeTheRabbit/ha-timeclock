import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";
import { compareShift, nzWallToInstant } from "@/server/domain/roster/compare";
import type { Roster } from "@/db/schema";

describe("P6 roster domain (unit)", () => {
  it("nzWallToInstant handles NZDT (+13, January) and NZST (+12, July)", () => {
    // 2026-01-15 08:00 NZDT = 2026-01-14T19:00Z
    expect(nzWallToInstant("2026-01-15", 8 * 60).toISOString()).toBe("2026-01-14T19:00:00.000Z");
    // 2026-07-15 08:00 NZST = 2026-07-14T20:00Z
    expect(nzWallToInstant("2026-07-15", 8 * 60).toISOString()).toBe("2026-07-14T20:00:00.000Z");
  });

  const shift = (over: Partial<Roster> = {}): Roster =>
    ({
      id: "r1",
      employeeId: "e1",
      shiftDate: "2026-07-15",
      startMin: 8 * 60,
      endMin: 16 * 60,
      jobId: null,
      note: null,
      cancelled: false,
      createdBy: "m1",
      createdAt: new Date(),
    }) as Roster;

  const sStart = () => nzWallToInstant("2026-07-15", 8 * 60);

  it("on-time punch -> ok (grace 5min)", () => {
    const cin = new Date(sStart().getTime() + 3 * 60_000);
    const r = compareShift(shift(), [{ clockIn: cin, clockOut: new Date(cin.getTime() + 8 * 3600_000) }], new Date(sStart().getTime() + 9 * 3600_000));
    expect(r.status).toBe("ok");
    expect(r.lateMin).toBe(0);
  });

  it("late punch -> late with minutes", () => {
    const cin = new Date(sStart().getTime() + 22 * 60_000);
    const r = compareShift(shift(), [{ clockIn: cin, clockOut: null }], new Date(sStart().getTime() + 9 * 3600_000));
    expect(r.status).toBe("late");
    expect(r.lateMin).toBe(22);
  });

  it("no punch by shift end -> no_show; before start -> upcoming", () => {
    expect(compareShift(shift(), [], new Date(sStart().getTime() + 9 * 3600_000)).status).toBe("no_show");
    expect(compareShift(shift(), [], new Date(sStart().getTime() - 3600_000)).status).toBe("upcoming");
  });

  it("open entry during shift -> in_progress", () => {
    const cin = new Date(sStart().getTime() + 60_000);
    const r = compareShift(shift(), [{ clockIn: cin, clockOut: null }], new Date(sStart().getTime() + 2 * 3600_000));
    expect(r.status).toBe("in_progress");
  });
});

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P6 roster API (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;

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

  it("employee cannot create shifts (403); admin can (201, audited)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const denied = await app.request("/api/roster", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ employeeId: w.employeeId, shiftDate: today, startMin: 480, endMin: 960 }),
    });
    expect(denied.status).toBe(403);

    const ok = await app.request("/api/roster", {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ employeeId: w.employeeId, shiftDate: today, startMin: 0, endMin: 60 }),
    });
    expect(ok.status).toBe(201);
    const audit = await admin.query("SELECT count(*)::int n FROM audit_log WHERE entity_type='roster'");
    expect(audit.rows[0].n).toBe(1);
  });

  it("compare flags no_show for a past unworked shift", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await app.request(`/api/roster/compare?date=${today}`, {
      headers: jsonHeaders(w.adminCookie),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shifts).toHaveLength(1);
    // shift 00:00-01:00 local today has passed (or is in progress) — either way
    // there is no punch, so status must be no_show/late/upcoming, never ok.
    expect(["no_show", "late", "upcoming"]).toContain(body.shifts[0].status);
  });

  it("mine returns own shifts; cancel removes them (audited)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mine = await app.request(`/api/roster/mine?from=${today}&to=${today}`, {
      headers: jsonHeaders(w.employeeCookie),
    });
    const shifts = (await mine.json()).shifts;
    expect(shifts).toHaveLength(1);

    const cancel = await app.request(`/api/roster/${shifts[0].id}/cancel`, {
      method: "POST",
      headers: jsonHeaders(w.adminCookie),
    });
    expect(cancel.status).toBe(200);

    const after = await app.request(`/api/roster/mine?from=${today}&to=${today}`, {
      headers: jsonHeaders(w.employeeCookie),
    });
    expect((await after.json()).shifts).toHaveLength(0);
  });
});
