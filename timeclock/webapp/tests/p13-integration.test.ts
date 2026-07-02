import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";

// P13: HA integration — external clock API (widgets/card), sensor push,
// generated package YAML. Real Postgres, real Hono app.
const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P13 HA integration (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let world: AuthedWorld;
  let apiKey: string;

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

  it("ext API is disabled until a key exists; bad key rejected", async () => {
    const noKey = await app.request("/api/ext/summary");
    expect(noKey.status).toBe(401);

    const keyRes = await app.request("/api/admin/integration/key", {
      method: "POST",
      headers: jsonHeaders(world.adminCookie),
    });
    expect(keyRes.status).toBe(200);
    apiKey = (await keyRes.json()).apiKey;
    expect(apiKey).toMatch(/^[0-9a-f]{48}$/);

    const badKey = await app.request("/api/ext/summary", {
      headers: { "x-timeclock-key": "wrong" },
    });
    expect(badKey.status).toBe(401);
  });

  it("ext summary returns per-employee stats", async () => {
    const res = await app.request("/api/ext/summary", {
      headers: { "x-timeclock-key": apiKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const stew = body.employees.find((e: { name: string }) => e.name === "Stew");
    expect(stew.status).toBe("out");
    expect(stew.daily).toHaveLength(42);
    expect(stew.weekly).toHaveLength(26);
  });

  it("ext punch toggle clocks in, then out, through the real clock logic", async () => {
    const tin = await app.request("/api/ext/punch", {
      method: "POST",
      headers: { "x-timeclock-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ employee: world.employeeId, action: "toggle" }),
    });
    expect(tin.status).toBe(200);
    expect((await tin.json()).action).toBe("in");

    // Status reflects it (by display-name slug this time).
    const st = await app.request("/api/ext/status/stew", {
      headers: { "x-timeclock-key": apiKey },
    });
    expect((await st.json()).status).toBe("in");

    const tout = await app.request("/api/ext/punch", {
      method: "POST",
      headers: { "x-timeclock-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ employee: "stew", action: "toggle" }),
    });
    expect((await tout.json()).action).toBe("out");

    // Real entry exists and was audited like any punch.
    const entries = await admin.query(
      "SELECT count(*)::int AS n FROM time_entries WHERE clock_out IS NOT NULL",
    );
    expect(entries.rows[0].n).toBe(1);
    const audit = await admin.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action IN ('clock_in','clock_out')",
    );
    expect(audit.rows[0].n).toBe(2);
  });

  it("double clock-in via ext is rejected cleanly", async () => {
    const a = await app.request("/api/ext/punch", {
      method: "POST",
      headers: { "x-timeclock-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ employee: "stew", action: "in" }),
    });
    expect(a.status).toBe(200);
    const b = await app.request("/api/ext/punch", {
      method: "POST",
      headers: { "x-timeclock-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ employee: "stew", action: "in" }),
    });
    expect(b.status).toBe(409);
    // clean up: toggle back out
    await app.request("/api/ext/punch", {
      method: "POST",
      headers: { "x-timeclock-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ employee: "stew", action: "out" }),
    });
  });

  it("unknown employee -> 404", async () => {
    const res = await app.request("/api/ext/punch", {
      method: "POST",
      headers: { "x-timeclock-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ employee: "nobody", action: "toggle" }),
    });
    expect(res.status).toBe(404);
  });

  it("generated package YAML carries the key and a script per employee", async () => {
    const { buildPackageYaml } = await import("@/server/integrations/ha/install");
    const yaml = await buildPackageYaml();
    expect(yaml).toContain("rest_command:");
    expect(yaml).toContain(apiKey);
    expect(yaml).toContain("timeclock_stew_toggle:");
    expect(yaml).toContain("/api/ext/punch");
  });

  it("state push publishes slim summary + per-employee sensors; history only on demand", async () => {
    const { pushTimeclockStates, setFetchImpl } = await import(
      "@/server/integrations/ha/state-push"
    );
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    setFetchImpl(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    });
    process.env.SUPERVISOR_TOKEN = "test-token";
    try {
      await pushTimeclockStates();

      // Default push: summary is SLIM (no daily/weekly/punches) and there is
      // NO history sensor.
      const summary = calls.find((c) => c.url.endsWith("/states/sensor.timeclock_summary"));
      expect(summary).toBeTruthy();
      const attrs = summary!.body.attributes as {
        employees: Record<string, unknown>[];
      };
      const stew = attrs.employees.find((e) => e.name === "Stew");
      expect(stew).toBeTruthy();
      expect(stew).not.toHaveProperty("daily");
      expect(stew).not.toHaveProperty("weekly");
      expect(stew).not.toHaveProperty("punches");

      expect(calls.some((c) => c.url.endsWith("/states/sensor.timeclock_stew"))).toBe(true);
      expect(calls.some((c) => c.url.endsWith("/states/sensor.timeclock_stew_today"))).toBe(true);
      expect(calls.some((c) => c.url.endsWith("/states/sensor.timeclock_history"))).toBe(false);

      // includeHistory: the heavy series move to a dedicated history sensor.
      calls.length = 0;
      await pushTimeclockStates({ includeHistory: true });

      const summary2 = calls.find((c) => c.url.endsWith("/states/sensor.timeclock_summary"));
      expect(summary2).toBeTruthy();
      const attrs2 = summary2!.body.attributes as { employees: Record<string, unknown>[] };
      for (const e of attrs2.employees) {
        expect(e).not.toHaveProperty("daily");
        expect(e).not.toHaveProperty("weekly");
        expect(e).not.toHaveProperty("punches");
      }

      const history = calls.find((c) => c.url.endsWith("/states/sensor.timeclock_history"));
      expect(history).toBeTruthy();
      const hAttrs = history!.body.attributes as {
        employees: { name: string; daily: unknown[]; weekly: unknown[]; punches: unknown[] }[];
      };
      const hStew = hAttrs.employees.find((e) => e.name === "Stew");
      expect(hStew).toBeTruthy();
      expect(hStew!.daily).toHaveLength(42);
      expect(hStew!.weekly).toHaveLength(26);
      expect(Array.isArray(hStew!.punches)).toBe(true);
    } finally {
      delete process.env.SUPERVISOR_TOKEN;
      setFetchImpl(fetch);
    }
  });
});
