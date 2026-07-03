import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, HA_HEADERS } from "./helpers";
import { setFetchImpl, _resetAvatarCaches } from "@/server/integrations/ha/avatars";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

/**
 * P16 avatars — the /api/avatars/:id route proxies an employee's HA person
 * picture via the Supervisor core proxy, matching person -> employee, and
 * 404s (→ initials fallback) when there is no match. Supervisor is mocked.
 */
run("P16 avatars (real Postgres, mocked Supervisor)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;

  // Mock: /api/states returns two people; the image path returns JPEG bytes.
  const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]); // JPEG magic + data
  function mockSupervisor() {
    return vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/api/states")) {
        return new Response(
          JSON.stringify([
            {
              entity_id: "person.stew",
              state: "home",
              attributes: { friendly_name: "Stew", user_id: "ha-user-stew", entity_picture: "/local/stew.jpg" },
            },
            {
              entity_id: "person.ben",
              state: "home",
              attributes: { friendly_name: "Ben", user_id: "ha-user-demo", entity_picture: "/api/image/serve/xyz/512x512" },
            },
            // A person with no picture — must be ignored.
            { entity_id: "person.nobody", state: "away", attributes: { user_id: "ha-user-nobody" } },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (u.includes("/local/stew.jpg") || u.includes("/api/image/serve/")) {
        return new Response(IMG, { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.SUPERVISOR_TOKEN = "test-supervisor-token";
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);
    // Link the seeded "Stew" employee to the HA username so person.stew matches.
    await admin.query(`UPDATE employees SET ha_username = 'ha-user-stew' WHERE id = $1`, [w.employeeId]);
  }, 60_000);

  beforeEach(() => {
    _resetAvatarCaches();
    setFetchImpl(mockSupervisor());
  });

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("streams the matched HA picture as image bytes", async () => {
    const res = await app.request(`/api/avatars/${w.employeeId}`, { headers: HA_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(IMG.length);
    expect(buf[0]).toBe(0xff); // JPEG magic survived the proxy
  });

  it("matches the admin by the HA user id it was claimed with", async () => {
    // bootstrapWorld's admin was claimed with x-remote-user-id = ha-user-demo,
    // which claim-admin stores as ha_username → person.ben matches.
    const res = await app.request(`/api/avatars/${w.adminId}`, { headers: HA_HEADERS });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  it("404s when the employee has no matching HA person picture", async () => {
    const [row] = (
      await admin.query(
        `INSERT INTO employees (display_name, role) VALUES ('Unlinked', 'employee') RETURNING id`,
      )
    ).rows;
    const res = await app.request(`/api/avatars/${row.id}`, { headers: HA_HEADERS });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_avatar");
  });

  it("rejects a malformed employee id", async () => {
    const res = await app.request(`/api/avatars/not-a-uuid!!`, { headers: HA_HEADERS });
    expect(res.status).toBe(400);
  });

  it("404s (no crash) when there is no SUPERVISOR_TOKEN (outside HA)", async () => {
    const saved = process.env.SUPERVISOR_TOKEN;
    delete process.env.SUPERVISOR_TOKEN;
    try {
      _resetAvatarCaches();
      const res = await app.request(`/api/avatars/${w.employeeId}`, { headers: HA_HEADERS });
      expect(res.status).toBe(404);
    } finally {
      process.env.SUPERVISOR_TOKEN = saved;
    }
  });
});
