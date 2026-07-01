import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "@/db/migrate";
import { seed } from "@/db/seed";
import { getPool } from "@/db/client";

// Full auth flow through the real Hono app against real Postgres.
const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

const HA_HEADERS = {
  "x-remote-user-id": "ha-user-ben",
  "x-remote-user-name": "ben",
  "x-remote-user-display-name": "Ben",
};

function cookieOf(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith(`${name}=`)) return c.split(";")[0].split("=").slice(1).join("=");
  }
  return null;
}

run("P2 auth flow (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let adminCookie: string;
  let deviceCookie: string;
  let employeeId: string;
  let employeeCookie: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(URL);
    await seed();
    ({ app } = await import("@/server/hono"));
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("whoami: HA identity present, unmapped on fresh install", async () => {
    const res = await app.request("/api/auth/whoami", { headers: HA_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ha.haUserId).toBe("ha-user-ben");
    expect(body.employee).toBeNull();
  });

  it("claim-admin: first HA user claims the seeded admin, gets a session", async () => {
    const res = await app.request("/api/auth/claim-admin", {
      method: "POST",
      headers: HA_HEADERS,
    });
    expect(res.status).toBe(200);
    adminCookie = cookieOf(res, "tc_session")!;
    expect(adminCookie).toBeTruthy();

    // second claim is rejected
    const again = await app.request("/api/auth/claim-admin", {
      method: "POST",
      headers: { ...HA_HEADERS, "x-remote-user-id": "ha-user-mallory" },
    });
    expect(again.status).toBe(409);
  });

  it("admin API allows the claimed admin, rejects anonymous", async () => {
    const anon = await app.request("/api/admin/employees");
    expect(anon.status).toBe(401);

    const ok = await app.request("/api/admin/employees", {
      headers: { cookie: `tc_session=${adminCookie}` },
    });
    expect(ok.status).toBe(200);
  });

  it("admin creates an employee with a PIN (audited)", async () => {
    const res = await app.request("/api/admin/employees", {
      method: "POST",
      headers: { cookie: `tc_session=${adminCookie}`, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Stew", role: "employee", pin: "2468" }),
    });
    expect(res.status).toBe(201);
    employeeId = (await res.json()).employee.id;

    const audit = await admin.query(
      "SELECT action FROM audit_log WHERE entity_type='employee' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toContain("create");
    expect(audit.rows.map((r) => r.action)).toContain("claim_admin");
  });

  it("kiosk employee grid lists only PIN-enabled staff", async () => {
    const res = await app.request("/api/auth/kiosk-employees");
    const body = await res.json();
    expect(body.employees).toHaveLength(1); // Stew (admin has no PIN yet)
    expect(body.employees[0].displayName).toBe("Stew");
  });

  it("first pin-login auto-binds the kiosk device (zero-devices bootstrap)", async () => {
    const res = await app.request("/api/auth/pin-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeId, pin: "2468" }),
    });
    expect(res.status).toBe(200);
    deviceCookie = cookieOf(res, "tc_device")!;
    employeeCookie = cookieOf(res, "tc_session")!;
    expect(deviceCookie).toBeTruthy();
    expect(employeeCookie).toBeTruthy();

    const devs = await admin.query("SELECT count(*)::int AS n FROM devices");
    expect(devs.rows[0].n).toBe(1);
  });

  it("second device (no cookie) is rejected: device_not_bound", async () => {
    const res = await app.request("/api/auth/pin-login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeId, pin: "2468" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("device_not_bound");
  });

  it("wrong PIN 5x on a bound device -> rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/auth/pin-login", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: `tc_device=${deviceCookie}` },
        body: JSON.stringify({ employeeId, pin: "0000" }),
      });
      expect(res.status).toBe(401);
    }
    const locked = await app.request("/api/auth/pin-login", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `tc_device=${deviceCookie}` },
      body: JSON.stringify({ employeeId, pin: "2468" }),
    });
    expect(locked.status).toBe(429);
  });

  it("employee session is authenticated but NOT admin (RBAC 403)", async () => {
    const session = await app.request("/api/auth/session", {
      headers: { cookie: `tc_session=${employeeCookie}` },
    });
    expect((await session.json()).session.employee.displayName).toBe("Stew");

    const forbidden = await app.request("/api/admin/employees", {
      headers: { cookie: `tc_session=${employeeCookie}` },
    });
    expect(forbidden.status).toBe(403);
  });

  it("logout revokes the session server-side", async () => {
    const out = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: `tc_session=${employeeCookie}` },
    });
    expect(out.status).toBe(200);
    const after = await app.request("/api/auth/session", {
      headers: { cookie: `tc_session=${employeeCookie}` },
    });
    expect((await after.json()).session).toBeNull();
  });

  it("audit chain remains intact after the whole flow", async () => {
    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(true);
  });
});
