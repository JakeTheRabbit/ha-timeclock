import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { employees, devices, jobs } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole, ROLES } from "@/server/auth/rbac";
import { hashPin } from "@/server/auth/pin";
import { registerDevice, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE } from "@/server/auth/device";
import { appendAudit } from "@/server/domain/audit/writer";
import { getSettings, updateSettings } from "@/server/domain/settings";
import {
  buildPackageYaml,
  installIntegration,
  integrationStatus,
  refreshIntegrationIfInstalled,
} from "@/server/integrations/ha/install";
import { schedulePush } from "@/server/integrations/ha/state-push";

const createEmployeeSchema = z.object({
  displayName: z.string().min(1).max(100),
  role: z.enum(ROLES).default("employee"),
  haUsername: z.string().min(1).max(200).nullish(),
  pin: z.string().min(4).max(12).optional(),
});

const updateEmployeeSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  haUsername: z.string().min(1).max(200).nullable().optional(),
});

const setPinSchema = z.object({ pin: z.string().min(4).max(12) });
const bindDeviceSchema = z.object({ name: z.string().min(1).max(100) });

export const admin = new Hono<AppEnv>()
  .use(requireRole("admin"))

  .get("/employees", async (c) => {
    const rows = await getDb()
      .select({
        id: employees.id,
        displayName: employees.displayName,
        role: employees.role,
        active: employees.active,
        haUsername: employees.haUsername,
        hasPin: employees.pinHash,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .orderBy(employees.displayName);
    return c.json({
      employees: rows.map((r) => ({ ...r, hasPin: r.hasPin != null })),
    });
  })

  .post("/employees", async (c) => {
    const body = createEmployeeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const actor = c.get("auth")!;
    const { pin, ...fields } = body.data;

    const [row] = await getDb()
      .insert(employees)
      .values({
        displayName: fields.displayName,
        role: fields.role,
        haUsername: fields.haUsername ?? null,
        pinHash: pin ? hashPin(pin) : null,
      })
      .returning();

    await appendAudit({
      entityType: "employee",
      entityId: row.id,
      action: "create",
      actorId: actor.employee.id,
      newValue: { displayName: row.displayName, role: row.role, hasPin: !!pin },
    });
    void refreshIntegrationIfInstalled(); // keep generated HA scripts in sync
    schedulePush();
    return c.json({ employee: { id: row.id, displayName: row.displayName, role: row.role } }, 201);
  })

  .patch("/employees/:id", async (c) => {
    const id = c.req.param("id");
    const body = updateEmployeeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const actor = c.get("auth")!;
    const db = getDb();

    const before = await db.query.employees.findFirst({
      where: (e, { eq: eq_ }) => eq_(e.id, id),
    });
    if (!before) return c.json({ error: "not_found" }, 404);

    const [after] = await db.update(employees).set(body.data).where(eq(employees.id, id)).returning();

    await appendAudit({
      entityType: "employee",
      entityId: id,
      action: "update",
      actorId: actor.employee.id,
      oldValue: {
        displayName: before.displayName,
        role: before.role,
        active: before.active,
        haUsername: before.haUsername,
      },
      newValue: {
        displayName: after.displayName,
        role: after.role,
        active: after.active,
        haUsername: after.haUsername,
      },
    });
    void refreshIntegrationIfInstalled();
    schedulePush();
    return c.json({ ok: true });
  })

  .post("/employees/:id/pin", async (c) => {
    const id = c.req.param("id");
    const body = setPinSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!;
    const db = getDb();

    const before = await db.query.employees.findFirst({
      where: (e, { eq: eq_ }) => eq_(e.id, id),
    });
    if (!before) return c.json({ error: "not_found" }, 404);

    await db.update(employees).set({ pinHash: hashPin(body.data.pin) }).where(eq(employees.id, id));

    // The PIN itself never enters the audit payload — only the fact of change.
    await appendAudit({
      entityType: "employee",
      entityId: id,
      action: "pin_set",
      actorId: actor.employee.id,
      oldValue: { hadPin: before.pinHash != null },
      newValue: { hadPin: true },
    });
    return c.json({ ok: true });
  })

  .get("/jobs", async (c) => {
    const rows = await getDb().select().from(jobs).orderBy(jobs.name);
    return c.json({ jobs: rows });
  })

  .post("/jobs", async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(120), code: z.string().min(1).max(40).nullish() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!;
    const [row] = await getDb()
      .insert(jobs)
      .values({ name: body.data.name, code: body.data.code ?? null })
      .returning();
    await appendAudit({
      entityType: "job",
      entityId: row.id,
      action: "create",
      actorId: actor.employee.id,
      newValue: { name: row.name, code: row.code },
    });
    return c.json({ job: row }, 201);
  })

  .patch("/jobs/:id", async (c) => {
    const id = c.req.param("id");
    const body = z
      .object({
        name: z.string().min(1).max(120).optional(),
        code: z.string().min(1).max(40).nullable().optional(),
        active: z.boolean().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!;
    const db = getDb();
    const before = await db.query.jobs.findFirst({ where: (j, { eq: eq_ }) => eq_(j.id, id) });
    if (!before) return c.json({ error: "not_found" }, 404);
    const [after] = await db.update(jobs).set(body.data).where(eq(jobs.id, id)).returning();
    await appendAudit({
      entityType: "job",
      entityId: id,
      action: "update",
      actorId: actor.employee.id,
      oldValue: { name: before.name, code: before.code, active: before.active },
      newValue: { name: after.name, code: after.code, active: after.active },
    });
    return c.json({ ok: true });
  })

  .get("/settings", async (c) => c.json({ settings: await getSettings() }))

  .patch("/settings", async (c) => {
    const patch = await c.req.json().catch(() => null);
    if (!patch || typeof patch !== "object") return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!;
    try {
      const merged = await updateSettings(patch, actor.employee.id);
      return c.json({ settings: merged });
    } catch {
      return c.json({ error: "invalid_settings" }, 400);
    }
  })

  .get("/devices", async (c) => {
    const rows = await getDb()
      .select({
        id: devices.id,
        name: devices.name,
        active: devices.active,
        createdAt: devices.createdAt,
        lastSeenAt: devices.lastSeenAt,
      })
      .from(devices)
      .orderBy(devices.createdAt);
    return c.json({ devices: rows });
  })

  // Bind THIS browser/tablet as a kiosk device (admin walks to the kiosk).
  .post("/devices/bind", async (c) => {
    const body = bindDeviceSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!;

    const { device, token } = await registerDevice(body.data.name);
    setCookie(c, DEVICE_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE,
    });
    await appendAudit({
      entityType: "device",
      entityId: device.id,
      action: "bind",
      actorId: actor.employee.id,
      newValue: { name: device.name },
    });
    return c.json({ device: { id: device.id, name: device.name } }, 201);
  })

  // ---- HA integration: dashboard card + companion-app widgets ----

  .get("/integration", async (c) => {
    const { integration } = await getSettings();
    const status = await integrationStatus();
    return c.json({
      apiKey: integration.apiKey, // admin-only route; shown for manual setup
      status,
      packageYaml: integration.apiKey ? await buildPackageYaml() : null,
    });
  })

  // Generate / rotate the external API key (rotation invalidates old widgets
  // until the package regenerates — which happens right here).
  .post("/integration/key", async (c) => {
    const actor = c.get("auth")!;
    const apiKey = randomBytes(24).toString("hex");
    await updateSettings({ integration: { apiKey } }, actor.employee.id);
    await refreshIntegrationIfInstalled();
    return c.json({ apiKey });
  })

  // Write packages/timeclock.yaml + www/timeclock-card.js into HA config and
  // ask HA to reload YAML. Idempotent.
  .post("/integration/install", async (c) => {
    const actor = c.get("auth")!;
    let { integration } = await getSettings();
    if (!integration.apiKey) {
      integration = (
        await updateSettings(
          { integration: { apiKey: randomBytes(24).toString("hex") } },
          actor.employee.id,
        )
      ).integration;
    }
    try {
      const status = await installIntegration();
      await appendAudit({
        entityType: "settings",
        entityId: "1",
        action: "integration_install",
        actorId: actor.employee.id,
        newValue: { package: status.packageInstalled, card: status.cardInstalled },
      });
      return c.json({ ok: true, status });
    } catch (e) {
      return c.json({ error: "install_failed", detail: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
