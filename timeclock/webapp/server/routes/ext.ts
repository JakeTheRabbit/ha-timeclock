import { Hono } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { eq, ilike, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { employees, type Employee } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { getSettings } from "@/server/domain/settings";
import { createSession, revokeSession, encodeSessionCookie, SESSION_COOKIE } from "@/server/auth/session";
import { buildTimeclockSummary, slugify } from "@/server/integrations/ha/summary";

/**
 * External clock API for the dashboard card and Android companion widgets,
 * called from HA Core via rest_command (add-on hostname, ingress port).
 * Authenticated by the API key in settings.integration.apiKey — empty key =
 * API disabled. Punches dispatch through the real /api/clock routes with a
 * one-shot session, so auto-deduct, break handling, and audit are identical
 * to a kiosk punch.
 */

const keyOf = (s: string) => createHash("sha256").update(s, "utf8").digest();

async function checkKey(provided: string | undefined): Promise<boolean> {
  const { integration } = await getSettings();
  if (!integration.apiKey || !provided) return false;
  return timingSafeEqual(keyOf(integration.apiKey), keyOf(provided));
}

/** id (uuid) | ha username | display-name slug | display name — active only. */
async function resolveEmployee(ref: string): Promise<Employee | null> {
  const db = getDb();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
  const rows = await db
    .select()
    .from(employees)
    .where(
      isUuid
        ? eq(employees.id, ref)
        : or(ilike(employees.haUsername, ref), ilike(employees.displayName, ref)),
    );
  const active = rows.filter((r) => r.active);
  if (active.length === 1) return active[0];
  if (isUuid) return null;
  // Fall back to the display-name slug (what the generated scripts use).
  const all = await db.select().from(employees).where(eq(employees.active, true));
  const bySlug = all.filter((e) => slugify(e.displayName) === ref.toLowerCase());
  return bySlug.length === 1 ? bySlug[0] : null;
}

/** Run one request against the app's own clock routes as the given employee. */
async function asEmployee(
  employee: Employee,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const { app } = await import("@/server/hono"); // lazy: avoids import cycle
  const session = await createSession({ employeeId: employee.id });
  try {
    const res = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${encodeSessionCookie(session.id)}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    await revokeSession(session.id);
  }
}

const punchSchema = z.object({
  employee: z.string().min(1),
  action: z.enum(["in", "out", "toggle"]),
  jobId: z.string().uuid().nullish(),
});

export const ext = new Hono<AppEnv>()

  .use(async (c, next) => {
    const provided = c.req.header("x-timeclock-key") ?? c.req.query("key");
    if (!(await checkKey(provided))) return c.json({ error: "invalid_api_key" }, 401);
    await next();
  })

  // Full summary (same payload as sensor.timeclock_summary attributes).
  .get("/summary", async (c) => c.json(await buildTimeclockSummary()))

  .get("/status/:employee", async (c) => {
    const employee = await resolveEmployee(c.req.param("employee"));
    if (!employee) return c.json({ error: "employee_not_found" }, 404);
    const summary = await buildTimeclockSummary();
    const mine = summary.employees.find((e) => e.id === employee.id)!;
    const { daily, weekly, punches, ...light } = mine;
    void daily, weekly, punches;
    return c.json(light);
  })

  .post("/punch", async (c) => {
    const body = punchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const employee = await resolveEmployee(body.data.employee);
    if (!employee) return c.json({ error: "employee_not_found" }, 404);

    let action: "in" | "out" = body.data.action === "toggle" ? "in" : body.data.action;
    if (body.data.action === "toggle") {
      const open = await getDb().query.timeEntries.findFirst({
        where: (t, { eq: eq_, and: and_, isNull: isNull_ }) =>
          and_(eq_(t.employeeId, employee.id), isNull_(t.clockOut)),
      });
      action = open ? "out" : "in";
    }

    const res = await asEmployee(
      employee,
      `/api/clock/${action}`,
      action === "in" ? { jobId: body.data.jobId ?? null } : {},
    );
    if (res.status >= 400) return c.json({ error: "punch_failed", detail: res.body }, 409);
    return c.json({
      ok: true,
      action,
      employee: { id: employee.id, displayName: employee.displayName },
      result: res.body,
    });
  });
