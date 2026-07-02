import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders, type AuthedWorld } from "./helpers";
import {
  pollPresenceOnce,
  setFetchImpl,
  _resetMemory,
} from "@/server/integrations/ha/presence";
import {
  buildAutomationYaml,
  buildHandlersYaml,
  buildScriptsYaml,
} from "@/server/integrations/ha/install";

// P15: presence reminders end to end — admin wiring of notify/presence per
// employee, the ha-entities discovery gate, the pollPresenceOnce sweep against a
// faked HA states/services API, and the generated handler/script YAML shape.
// Real Postgres, real Hono app; HA is faked via setFetchImpl.
const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

const PRESENCE_ENTITY = "device_tracker.stew_phone";
const NOTIFY_SERVICE = "notify.mobile_app_stew";

run("P15 presence reminders (real Postgres)", () => {
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
    // Restore real fetch + drop the test-only supervisor token so nothing else
    // starts hitting a fake HA.
    setFetchImpl(fetch);
    delete process.env.SUPERVISOR_TOKEN;
    await admin.end();
    await getPool().end();
  });

  it("PATCH sets notifyService + presenceEntity; GET echoes them", async () => {
    const res = await app.request(`/api/admin/employees/${world.employeeId}`, {
      method: "PATCH",
      headers: jsonHeaders(world.adminCookie),
      body: JSON.stringify({
        notifyService: NOTIFY_SERVICE,
        presenceEntity: PRESENCE_ENTITY,
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const list = await app.request("/api/admin/employees", {
      headers: { cookie: `tc_session=${world.adminCookie}` },
    });
    expect(list.status).toBe(200);
    const stew = (await list.json()).employees.find(
      (e: { id: string }) => e.id === world.employeeId,
    );
    expect(stew.notifyService).toBe(NOTIFY_SERVICE);
    expect(stew.presenceEntity).toBe(PRESENCE_ENTITY);
  });

  it("PATCH with empty string clears the mappings back to null", async () => {
    const res = await app.request(`/api/admin/employees/${world.employeeId}`, {
      method: "PATCH",
      headers: jsonHeaders(world.adminCookie),
      body: JSON.stringify({ notifyService: "", presenceEntity: "" }),
    });
    expect(res.status).toBe(200);

    const list = await app.request("/api/admin/employees", {
      headers: { cookie: `tc_session=${world.adminCookie}` },
    });
    const stew = (await list.json()).employees.find(
      (e: { id: string }) => e.id === world.employeeId,
    );
    expect(stew.notifyService).toBeNull();
    expect(stew.presenceEntity).toBeNull();

    // Re-apply the mappings so the poll test below has an employee to notify.
    await app.request(`/api/admin/employees/${world.employeeId}`, {
      method: "PATCH",
      headers: jsonHeaders(world.adminCookie),
      body: JSON.stringify({
        notifyService: NOTIFY_SERVICE,
        presenceEntity: PRESENCE_ENTITY,
      }),
    });
  });

  it("GET /api/admin/ha-entities reports available:false without SUPERVISOR_TOKEN", async () => {
    expect(process.env.SUPERVISOR_TOKEN).toBeUndefined();
    const res = await app.request("/api/admin/ha-entities", {
      headers: { cookie: `tc_session=${world.adminCookie}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, presence: [], notify: [] });
  });

  it("pollPresenceOnce: cold start never notifies; commits an 'in' after arriveGrace", async () => {
    // Enable presence via the real settings PATCH (deep-merged + validated).
    const patch = await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(world.adminCookie),
      body: JSON.stringify({ presence: { enabled: true } }),
    });
    expect(patch.status).toBe(200);
    const arriveGraceSec = (await patch.json()).settings.presence.arriveGraceSec as number;
    expect(arriveGraceSec).toBeGreaterThan(0); // default 120

    // Fake HA: /api/states returns a mutable "present"/"away" reading for the
    // employee's presence entity; /api/services/notify/* is captured.
    const notifies: { url: string; body: Record<string, unknown> }[] = [];
    let phoneState = "not_home"; // start AWAY so cold start commits "away"
    setFetchImpl(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/states")) {
        return new Response(
          JSON.stringify([{ entity_id: PRESENCE_ENTITY, state: phoneState }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/services/notify/")) {
        notifies.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    process.env.SUPERVISOR_TOKEN = "test-supervisor-token";
    _resetMemory();

    const T0 = 5_000_000;

    // Sweep 1 (cold start, phone away): adopts state silently, no notify.
    await pollPresenceOnce(T0);
    expect(notifies).toHaveLength(0);

    // Phone arrives. Sweep 2 arms the arrive-grace timer — still no notify.
    phoneState = "home";
    await pollPresenceOnce(T0 + 1000);
    expect(notifies).toHaveLength(0);

    // Sweep 3 after arriveGrace has elapsed: commit -> notify "in".
    await pollPresenceOnce(T0 + 1000 + (arriveGraceSec + 1) * 1000);
    expect(notifies).toHaveLength(1);

    const sent = notifies[0];
    expect(sent.url).toContain("/api/services/notify/mobile_app_stew");
    const actions = (sent.body.data as { actions: { action: string }[] }).actions;
    expect(actions[0].action).toMatch(/^TIMECLOCK_IN__/);
    expect(actions[0].action).toBe(`TIMECLOCK_IN__${world.employeeId}`);

    // A steady follow-up sweep does not re-notify (one per committed transition).
    await pollPresenceOnce(T0 + 1000 + (arriveGraceSec + 2) * 1000);
    expect(notifies).toHaveLength(1);
  });

  it("pollPresenceOnce no-ops with no SUPERVISOR_TOKEN even when enabled", async () => {
    const saved = process.env.SUPERVISOR_TOKEN;
    delete process.env.SUPERVISOR_TOKEN;
    let fetched = false;
    setFetchImpl(async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    });
    await pollPresenceOnce(9_000_000);
    expect(fetched).toBe(false);
    if (saved) process.env.SUPERVISOR_TOKEN = saved;
  });

  it("handlers YAML is rest_command-only (no automation -> no automation.reload)", async () => {
    const yaml = await buildHandlersYaml();
    expect(yaml).toContain("rest_command:");
    expect(yaml).toContain("timeclock_punch:");
    // The dynamic key/URL live here; the automation must NOT, so a key/URL
    // change never drags an automation.reload with it.
    expect(yaml).not.toContain("automation:");
    expect(yaml).not.toContain("id: timeclock_notify_actions");
  });

  it("automation YAML is the fully-static notification-action handler", async () => {
    const yaml = buildAutomationYaml();
    expect(yaml).toContain("automation:");
    expect(yaml).toContain("id: timeclock_notify_actions");
    expect(yaml).toContain("mobile_app_notification_action");
    expect(yaml).toContain("rest_command.timeclock_punch");
    // The tap decodes back into a punch verb from the action id.
    expect(yaml).toContain("TIMECLOCK_IN");
    // No rest_command block here — that reloads independently.
    expect(yaml).not.toContain("rest_command:");
    // Fully static: no interpolated add-on state should leak into the file.
    expect(yaml).not.toMatch(/\bhttp:\/\//);
  });

  it("scripts YAML is roster-only: no rest_command / automation blocks", async () => {
    const yaml = await buildScriptsYaml();
    expect(yaml).toContain("script:");
    expect(yaml).toContain("timeclock_stew_toggle:");
    expect(yaml).not.toContain("rest_command:");
    expect(yaml).not.toContain("automation:");
  });
});
