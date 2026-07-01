import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { employees } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { verifyPin, pinRateCheck, pinRateFail, pinRateReset } from "@/server/auth/pin";
import {
  createSession,
  revokeSession,
  encodeSessionCookie,
  SESSION_COOKIE,
} from "@/server/auth/session";
import {
  loadDevice,
  registerDevice,
  countDevices,
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
} from "@/server/auth/device";
import { appendAudit } from "@/server/domain/audit/writer";

const pinLoginSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().min(4).max(12),
});

export const auth = new Hono<AppEnv>()

  // Kiosk PIN-pad grid: active employees who can log in. Names only — reachable
  // by anyone who can open the panel (HA-authenticated LAN users).
  .get("/kiosk-employees", async (c) => {
    const rows = await getDb()
      .select({ id: employees.id, displayName: employees.displayName, pinHash: employees.pinHash })
      .from(employees)
      .where(eq(employees.active, true))
      .orderBy(employees.displayName);
    return c.json({
      employees: rows.filter((r) => r.pinHash != null).map(({ id, displayName }) => ({ id, displayName })),
    });
  })

  // Who opened the panel (HA identity) + whether they map to an employee.
  .get("/whoami", async (c) => {
    const ha = c.get("haIdentity");
    let mapped = null;
    if (ha) {
      const rows = await getDb()
        .select({ id: employees.id, displayName: employees.displayName, role: employees.role })
        .from(employees)
        .where(and(eq(employees.haUsername, ha.haUserId), eq(employees.active, true)))
        .limit(1);
      mapped = rows[0] ?? null;
    }
    return c.json({ ha, employee: mapped });
  })

  // Current employee session (kiosk PIN login), for use-session.
  .get("/session", (c) => {
    const auth = c.get("auth");
    if (!auth) return c.json({ session: null }, 200);
    const { employee, session } = auth;
    return c.json({
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        employee: { id: employee.id, displayName: employee.displayName, role: employee.role },
      },
    });
  })

  // First-boot bootstrap: the first HA user to open the panel claims the seeded
  // Admin employee. Only possible while NO employee is mapped to any HA user.
  .post("/claim-admin", async (c) => {
    const ha = c.get("haIdentity");
    if (!ha) return c.json({ error: "no_ha_identity" }, 401);
    const db = getDb();

    const anyMapped = await db.query.employees.findFirst({
      where: (e, { isNotNull: notNull }) => notNull(e.haUsername),
    });
    if (anyMapped) return c.json({ error: "already_bootstrapped" }, 409);

    const admin = await db.query.employees.findFirst({
      where: (e, { eq: eq_, and: and_, isNull: isNull_ }) =>
        and_(eq_(e.role, "admin"), eq_(e.active, true), isNull_(e.haUsername)),
    });
    if (!admin) return c.json({ error: "no_claimable_admin" }, 409);

    const [updated] = await db
      .update(employees)
      .set({ haUsername: ha.haUserId, displayName: ha.displayName ?? admin.displayName })
      .where(and(eq(employees.id, admin.id), isNull(employees.haUsername)))
      .returning();
    if (!updated) return c.json({ error: "already_bootstrapped" }, 409);

    await appendAudit({
      entityType: "employee",
      entityId: updated.id,
      action: "claim_admin",
      actorId: updated.id,
      reason: "first-boot bootstrap",
      oldValue: { haUsername: null, displayName: admin.displayName },
      newValue: { haUsername: updated.haUsername, displayName: updated.displayName },
    });

    // Issue a session directly (they have no PIN yet — first job is to set one).
    const session = await createSession({
      employeeId: updated.id,
      haUserId: ha.haUserId,
      haUserName: ha.haUserName,
    });
    setCookie(c, SESSION_COOKIE, encodeSessionCookie(session.id), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    return c.json({ claimed: true, employee: { id: updated.id, role: updated.role } });
  })

  // Kiosk PIN login. Requires a bound device; the very first login on a fresh
  // install auto-binds the device (zero-devices bootstrap), audited.
  .post("/pin-login", async (c) => {
    const body = pinLoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const { employeeId, pin } = body.data;
    const db = getDb();

    let device = await loadDevice(getCookie(c, DEVICE_COOKIE));
    if (!device) {
      if ((await countDevices()) === 0) {
        const reg = await registerDevice("Kiosk 1 (auto-bound)");
        device = reg.device;
        setCookie(c, DEVICE_COOKIE, reg.token, {
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          maxAge: DEVICE_COOKIE_MAX_AGE,
        });
        await appendAudit({
          entityType: "device",
          entityId: device.id,
          action: "auto_bind_first_device",
          reason: "zero-devices bootstrap",
          newValue: { name: device.name },
        });
      } else {
        return c.json({ error: "device_not_bound" }, 403);
      }
    }

    const rateKey = `${employeeId}:${device.id}`;
    const rate = pinRateCheck(rateKey);
    if (!rate.allowed) {
      return c.json({ error: "rate_limited", retryInMs: rate.retryInMs }, 429);
    }

    const employee = await db.query.employees.findFirst({
      where: (e, { eq: eq_, and: and_ }) => and_(eq_(e.id, employeeId), eq_(e.active, true)),
    });
    if (!employee?.pinHash || !verifyPin(pin, employee.pinHash)) {
      pinRateFail(rateKey);
      // Same response for unknown employee / no PIN / wrong PIN.
      return c.json({ error: "invalid_credentials" }, 401);
    }
    pinRateReset(rateKey);

    const ha = c.get("haIdentity");
    const session = await createSession({
      employeeId: employee.id,
      deviceId: device.id,
      haUserId: ha?.haUserId ?? null,
      haUserName: ha?.haUserName ?? null,
    });
    setCookie(c, SESSION_COOKIE, encodeSessionCookie(session.id), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    return c.json({
      ok: true,
      employee: { id: employee.id, displayName: employee.displayName, role: employee.role },
    });
  })

  .post("/logout", async (c) => {
    const auth = c.get("auth");
    if (auth) await revokeSession(auth.session.id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
