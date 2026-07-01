import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";
import { setFetchImpl } from "@/server/integrations/notify/ha-notify";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P10 notifications + auto-clockout (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;
  const sent: { url: string; auth: string | null; body: unknown }[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    process.env.SUPERVISOR_TOKEN = "test-supervisor-token";
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);

    // Fake the Supervisor API.
    setFetchImpl(vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({
        url: String(url),
        auth: (init?.headers as Record<string, string>)?.authorization ?? null,
        body: JSON.parse(String(init?.body ?? "null")),
      });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch);
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("HA notifier posts to the Supervisor proxy with bearer token", async () => {
    const { notify } = await import("@/server/integrations/notify");
    const res = await notify({ title: "Test", message: "hello" });
    expect(res.sent).toEqual(["ha"]); // smtp disabled by default
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("http://supervisor/core/api/services/notify/notify");
    expect(sent[0].auth).toBe("Bearer test-supervisor-token");
    expect(sent[0].body).toEqual({ title: "Test", message: "hello" });
  });

  it("smtp transport reports not-configured (deferred creds), never breaks flow", async () => {
    // Enable smtp with no creds -> send fails -> notify() reports failure, no throw.
    const patch = await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ notifications: { smtp: { enabled: true } } }),
    });
    expect(patch.status).toBe(200);

    const { notify } = await import("@/server/integrations/notify");
    const res = await notify({ title: "T", message: "m" });
    expect(res.sent).toContain("ha");
    expect(res.failed).toContain("smtp");

    await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ notifications: { smtp: { enabled: false } } }),
    });
  });

  it("auto-clockout closes stale entries, flags + audits + notifies; idempotent", async () => {
    // 20h-old open entry (default limit 14h).
    await admin.query(
      `INSERT INTO time_entries (employee_id, clock_in) VALUES ($1, now() - interval '20 hours')`,
      [w.employeeId],
    );
    const before = sent.length;

    const { runAutoClockout } = await import("@/server/jobs/auto-clockout");
    const closed = await runAutoClockout();
    expect(closed).toBe(1);

    const entry = await admin.query(
      "SELECT clock_out, edited FROM time_entries WHERE clock_out IS NOT NULL",
    );
    expect(entry.rowCount).toBe(1);
    expect(entry.rows[0].edited).toBe(true);

    const audit = await admin.query(
      "SELECT count(*)::int n FROM audit_log WHERE action='auto_clockout'",
    );
    expect(audit.rows[0].n).toBe(1);
    expect(sent.length).toBe(before + 1);
    expect((sent.at(-1)!.body as { message: string }).message).toContain("auto-clocked-out");

    // Second sweep: nothing left to close.
    expect(await runAutoClockout()).toBe(0);
  });

  it("audit chain intact after cron mutations", async () => {
    const v = await admin.query("SELECT * FROM verify_audit_chain()");
    expect(v.rows[0].ok).toBe(true);
  });
});
