import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

function pgDumpAvailable(): boolean {
  try {
    execSync("pg_dump --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

run("P12 offline queue (server side, real Postgres)", () => {
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

  it("queued punch uses the client wall-clock and is flagged offline_queued", async () => {
    const queuedAt = new Date(Date.now() - 2 * 3600_000).toISOString(); // 2h ago
    const res = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ clientQueuedAt: queuedAt }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fraudFlags).toContain("offline_queued");
    expect(Math.abs(new Date(body.clockIn).getTime() - new Date(queuedAt).getTime())).toBeLessThan(1000);

    // Queued clock-out too.
    const outAt = new Date(Date.now() - 3600_000).toISOString();
    const out = await app.request("/api/clock/out", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ clientQueuedAt: outAt }),
    });
    expect(out.status).toBe(200);
    expect((await out.json()).workedMinutes).toBeCloseTo(60, -1); // ~1h
  });

  it("stale queued timestamps (>24h) are ignored, not honoured", async () => {
    const ancient = new Date(Date.now() - 48 * 3600_000).toISOString();
    const res = await app.request("/api/clock/in", {
      method: "POST",
      headers: jsonHeaders(w.employeeCookie),
      body: JSON.stringify({ clientQueuedAt: ancient }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.fraudFlags).not.toContain("offline_queued");
    // clockIn = server now, not the 48h-old claim.
    expect(Date.now() - new Date(body.clockIn).getTime()).toBeLessThan(10_000);
    await app.request("/api/clock/out", { method: "POST", headers: jsonHeaders(w.employeeCookie) });
  });
});

const backupRun = URL && pgDumpAvailable() ? describe : describe.skip;

backupRun("P12 backup + verify (needs pg_dump on PATH)", () => {
  it("pg_dump -Fc archive verifies via pg_restore --list", async () => {
    process.env.DATABASE_URL = URL;
    process.env.BACKUP_DIR = process.env.RUNNER_TEMP ?? process.env.TEMP ?? "/tmp";
    const { runDbBackup } = await import("@/server/jobs/db-backup");
    const file = await runDbBackup();
    expect(file).toContain("timeclock_");
  });
});
