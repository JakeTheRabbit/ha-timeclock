import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { employees, devices, jobs, auditLog } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole, ROLES } from "@/server/auth/rbac";
import { hashPin } from "@/server/auth/pin";
import { registerDevice, hashDeviceToken, DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE } from "@/server/auth/device";
import { appendAudit } from "@/server/domain/audit/writer";
import { getSettings, updateSettings, zodIssues } from "@/server/domain/settings";
import {
  buildPackageYaml,
  installIntegration,
  integrationStatus,
  refreshIntegrationIfInstalled,
} from "@/server/integrations/ha/install";
import { schedulePush } from "@/server/integrations/ha/state-push";
import { notify } from "@/server/integrations/notify";
import { serverT } from "@/server/i18n";

// Optional string that clears to NULL when blank (unset a mapping from the UI).
const optClearable = z
  .union([z.string().max(200), z.null()])
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

// HA card-reader entities for the door-access cross-check.
const accessEntitiesSchema = z.array(z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/)).max(10);

const createEmployeeSchema = z.object({
  displayName: z.string().min(1).max(100),
  role: z.enum(ROLES).default("employee"),
  haUsername: z.string().min(1).max(200).nullish(),
  pin: z.string().min(4).max(12).optional(),
  notifyService: optClearable,
  presenceEntity: optClearable,
  accessEntities: accessEntitiesSchema.optional(),
});

const updateEmployeeSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  haUsername: z.string().min(1).max(200).nullable().optional(),
  // "" clears the mapping -> stored as NULL.
  notifyService: z.union([z.string().max(200), z.null()]).optional().transform((v) => (v === "" ? null : v)),
  presenceEntity: z.union([z.string().max(200), z.null()]).optional().transform((v) => (v === "" ? null : v)),
  accessEntities: accessEntitiesSchema.optional(),
  hourlyRateCents: z.number().int().min(0).max(10_000_00).nullable().optional(),
  payTracking: z.boolean().optional(),
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
        notifyService: employees.notifyService,
        presenceEntity: employees.presenceEntity,
        accessEntities: employees.accessEntities,
        hourlyRateCents: employees.hourlyRateCents,
        payTracking: employees.payTracking,
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
        notifyService: fields.notifyService ?? null,
        presenceEntity: fields.presenceEntity ?? null,
        accessEntities: fields.accessEntities ?? [],
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
        accessEntities: before.accessEntities,
        hourlyRateCents: before.hourlyRateCents,
        payTracking: before.payTracking,
      },
      newValue: {
        displayName: after.displayName,
        role: after.role,
        active: after.active,
        haUsername: after.haUsername,
        accessEntities: after.accessEntities,
        hourlyRateCents: after.hourlyRateCents,
        payTracking: after.payTracking,
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
    } catch (e) {
      // issues: [{ path: "overtime.multiplier1", message }] so the UI can mark the field.
      return c.json({ error: "invalid_settings", issues: e instanceof z.ZodError ? zodIssues(e) : [] }, 400);
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
    // "Bound by" comes from the bind audit row (devices has no actor column).
    const binds = rows.length
      ? await getDb()
          .select({ entityId: auditLog.entityId, actorName: employees.displayName })
          .from(auditLog)
          .leftJoin(employees, eq(auditLog.actorId, employees.id))
          .where(
            and(
              eq(auditLog.entityType, "device"),
              inArray(auditLog.action, ["bind", "auto_bind_first_device"]),
            ),
          )
      : [];
    const boundBy = new Map(binds.map((b) => [b.entityId, b.actorName]));
    const cookie = getCookie(c, DEVICE_COOKIE);
    const current = cookie
      ? ((
          await getDb()
            .select({ id: devices.id })
            .from(devices)
            .where(eq(devices.tokenHash, hashDeviceToken(cookie)))
            .limit(1)
        )[0]?.id ?? null)
      : null;
    return c.json({
      devices: rows.map((d) => ({ ...d, boundBy: boundBy.get(d.id) ?? null })),
      currentDeviceId: current,
    });
  })

  .patch("/devices/:id", async (c) => {
    const id = c.req.param("id");
    const body = bindDeviceSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!;
    const db = getDb();
    const before = await db.query.devices.findFirst({ where: (d, { eq: eq_ }) => eq_(d.id, id) });
    if (!before) return c.json({ error: "not_found" }, 404);
    await db.update(devices).set({ name: body.data.name }).where(eq(devices.id, id));
    await appendAudit({
      entityType: "device",
      entityId: id,
      action: "rename",
      actorId: actor.employee.id,
      oldValue: { name: before.name },
      newValue: { name: body.data.name },
    });
    return c.json({ ok: true });
  })

  // Revoke = deactivate: the kiosk's cookie stops working; the row stays for the audit trail.
  .post("/devices/:id/revoke", async (c) => {
    const id = c.req.param("id");
    const actor = c.get("auth")!;
    const db = getDb();
    const before = await db.query.devices.findFirst({ where: (d, { eq: eq_ }) => eq_(d.id, id) });
    if (!before) return c.json({ error: "not_found" }, 404);
    if (!before.active) return c.json({ ok: true });
    await db.update(devices).set({ active: false }).where(eq(devices.id, id));
    await appendAudit({
      entityType: "device",
      entityId: id,
      action: "revoke",
      actorId: actor.employee.id,
      oldValue: { active: true, name: before.name },
      newValue: { active: false },
    });
    return c.json({ ok: true });
  })

  // Bind THIS browser/tablet as a kiosk device (admin walks to the kiosk).
  // Fire a test message through every enabled channel (HA notify, email).
  .post("/notify/test", async (c) => {
    const me = c.get("auth")!.employee;
    const { t } = await serverT();
    return c.json(
      await notify({
        title: t("push.testTitle"),
        message: t("push.testBody", { name: me.displayName }),
      }),
    );
  })

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
    // Rotation changes the rest_command file; if HA can't reload it, the new
    // key won't reach HA until a restart — tell the admin so punches don't
    // silently start failing.
    const reload = await refreshIntegrationIfInstalled();
    return c.json({
      apiKey,
      // null = not installed (nothing to reload); otherwise did rest_command reload?
      haReloaded: reload === null ? null : reload.restCommandOk,
    });
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
  })

  // Discovery for the presence-reminder pickers: candidate presence entities
  // (device_tracker / person / connectivity binary_sensor / wifi-SSID sensor)
  // and available notify.* services, read live from HA. Empty when not running
  // under HA (no SUPERVISOR_TOKEN) — the UI falls back to free-text.
  .get("/ha-entities", async (c) => {
    const token = process.env.SUPERVISOR_TOKEN;
    if (!token) return c.json({ available: false, presence: [], notify: [] });
    const auth = { headers: { authorization: `Bearer ${token}` } };
    try {
      const [statesRes, servicesRes] = await Promise.all([
        fetch("http://supervisor/core/api/states", auth),
        fetch("http://supervisor/core/api/services", auth),
      ]);
      const states = (await statesRes.json()) as {
        entity_id: string;
        state: string;
        attributes?: { friendly_name?: string; device_class?: string };
      }[];
      const services = (await servicesRes.json()) as {
        domain: string;
        services: Record<string, unknown>;
      }[];

      const presence = states
        .filter((s) => {
          const d = s.entity_id.split(".")[0];
          if (d === "device_tracker" || d === "person") return true;
          if (d === "binary_sensor") {
            const dc = s.attributes?.device_class;
            return dc === "connectivity" || dc === "presence" || dc === "occupancy";
          }
          if (d === "sensor") return /wifi|ssid|connection|network/i.test(s.entity_id);
          return false;
        })
        .map((s) => ({
          entity_id: s.entity_id,
          name: s.attributes?.friendly_name ?? s.entity_id,
          state: s.state,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const notify = (services.find((s) => s.domain === "notify")?.services
        ? Object.keys(services.find((s) => s.domain === "notify")!.services)
        : []
      )
        .map((k) => `notify.${k}`)
        .sort();

      return c.json({ available: true, presence, notify });
    } catch (e) {
      return c.json({ available: false, presence: [], notify: [], error: String(e) });
    }
  });
