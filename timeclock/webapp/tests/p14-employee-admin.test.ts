import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";

// P14: admin employee lifecycle — deactivate/reactivate and role changes via
// PATCH /api/admin/employees/:id, and how that reflects in the kiosk grid.
// Regression: PATCH {active:false} must hide the employee from kiosk-employees.
const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P14 employee admin PATCH (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let world: AuthedWorld;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    world = await bootstrapWorld(app);
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  async function kioskNames(): Promise<string[]> {
    const res = await app.request("/api/auth/kiosk-employees");
    expect(res.status).toBe(200);
    const body = await res.json();
    return body.employees.map((e: { displayName: string }) => e.displayName);
  }

  it("deactivating an employee hides them from the kiosk grid", async () => {
    expect(await kioskNames()).toContain("Stew");

    const res = await app.request(`/api/admin/employees/${world.employeeId}`, {
      method: "PATCH",
      headers: jsonHeaders(world.adminCookie),
      body: JSON.stringify({ active: false }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await kioskNames()).not.toContain("Stew");
  });

  it("reactivating restores them on the kiosk grid", async () => {
    const res = await app.request(`/api/admin/employees/${world.employeeId}`, {
      method: "PATCH",
      headers: jsonHeaders(world.adminCookie),
      body: JSON.stringify({ active: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await kioskNames()).toContain("Stew");
  });

  it("PATCH {role:'lead'} updates the role (visible in admin list + audited)", async () => {
    const res = await app.request(`/api/admin/employees/${world.employeeId}`, {
      method: "PATCH",
      headers: jsonHeaders(world.adminCookie),
      body: JSON.stringify({ role: "lead" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const list = await app.request("/api/admin/employees", {
      headers: { cookie: `tc_session=${world.adminCookie}` },
    });
    expect(list.status).toBe(200);
    const stew = (await list.json()).employees.find(
      (e: { displayName: string }) => e.displayName === "Stew",
    );
    expect(stew.role).toBe("lead");
    expect(stew.active).toBe(true);

    // Every PATCH above was audited with old/new values.
    const audit = await admin.query(
      "SELECT old_value, new_value FROM audit_log WHERE entity_type='employee' AND action='update' AND entity_id=$1 ORDER BY id",
      [world.employeeId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(3);
    const last = audit.rows[audit.rows.length - 1];
    expect(JSON.parse(last.old_value).role).toBe("employee");
    expect(JSON.parse(last.new_value).role).toBe("lead");
  });
});
