import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { employees } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { verifyPin, pinRateCheck, pinRateFail, pinRateReset } from "@/server/auth/pin";
import { findEmployeeForHaIdentity } from "@/server/auth/employee-link";
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
import { getSettings } from "@/server/domain/settings";

const pinLoginSchema = z.object({
  employeeId: z.string().uuid(),
  pin: z.string().min(4).max(12),
});

// Set on explicit sign-out so HA SSO doesn't immediately log the same person
// back in — a shared kiosk must be able to switch users via PIN. Cleared by
// the next PIN login; expires on its own after 12h.
export const SSO_OPTOUT_COOKIE = "tc_sso_off";

export const auth = new Hono<AppEnv>()

  // Kiosk PIN-pad grid: active employees. Names only — reachable by anyone who
  // can open the panel (HA-authenticated LAN users). Employees without a PIN
  // are included (shown disabled) so a missing PIN reads as "ask the admin",
  // not "my account vanished".
  .get("/kiosk-employees", async (c) => {
    const rows = await getDb()
      .select({ id: employees.id, displayName: employees.displayName, pinHash: employees.pinHash })
      .from(employees)
      .where(eq(employees.active, true))
      .orderBy(employees.displayName);
    return c.json({
      employees: rows.map(({ id, displayName, pinHash }) => ({ id, displayName, hasPin: pinHash != null })),
    });
  })

  // Who opened the panel (HA identity) + whether they map to an employee.
  // `bootstrapped` = some employee is already linked to an HA account, i.e.
  // first-boot claim-admin has happened.
  .get("/whoami", async (c) => {
    const ha = c.get("haIdentity");
    const mapped = ha ? await findEmployeeForHaIdentity(ha) : null;
    const anyMapped = await getDb().query.employees.findFirst({
      where: (e, { isNotNull: notNull }) => notNull(e.haUsername),
    });
    return c.json({
      ha,
      employee: mapped
        ? { id: mapped.id, displayName: mapped.displayName, role: mapped.role }
        : null,
      bootstrapped: anyMapped != null,
    });
  })

  // Current employee session, for use-session. HA SSO lives here: when there
  // is no cookie session but the panel opener's HA account maps to an active
  // employee, sign them in silently — an employee's session follows whatever
  // HA account they're logged into, on any device. Suppressed after an
  // explicit sign-out (opt-out cookie) so kiosks can switch users via PIN.
  .get("/session", async (c) => {
    let auth = c.get("auth");
    if (!auth) {
      const ha = c.get("haIdentity");
      if (ha && !getCookie(c, SSO_OPTOUT_COOKIE)) {
        const employee = await findEmployeeForHaIdentity(ha);
        if (employee) {
          const session = await createSession({
            employeeId: employee.id,
            haUserId: ha.haUserId,
            haUserName: ha.haUserName,
          });
          setCookie(c, SESSION_COOKIE, encodeSessionCookie(session.id), {
            httpOnly: true,
            sameSite: "Lax",
            path: "/",
          });
          auth = { session, employee };
        }
      }
    }
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

  // Kiosk PIN login. Device binding is an optional antifraud control
  // (settings.kiosk.requireDeviceBinding, default off — every request already
  // rode in through HA auth). When required, the very first login on a fresh
  // install auto-binds the device (zero-devices bootstrap), audited.
  .post("/pin-login", async (c) => {
    const body = pinLoginSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const { employeeId, pin } = body.data;
    const db = getDb();

    let device = await loadDevice(getCookie(c, DEVICE_COOKIE));
    if (!device && (await getSettings()).kiosk.requireDeviceBinding) {
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

    const rateKey = `${employeeId}:${device?.id ?? "unbound"}`;
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
      deviceId: device?.id ?? null,
      haUserId: ha?.haUserId ?? null,
      haUserName: ha?.haUserName ?? null,
    });
    setCookie(c, SESSION_COOKIE, encodeSessionCookie(session.id), {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    deleteCookie(c, SSO_OPTOUT_COOKIE, { path: "/" });
    return c.json({
      ok: true,
      employee: { id: employee.id, displayName: employee.displayName, role: employee.role },
    });
  })

  .post("/logout", async (c) => {
    const auth = c.get("auth");
    if (auth) await revokeSession(auth.session.id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    setCookie(c, SSO_OPTOUT_COOKIE, "1", {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 12 * 3600,
    });
    return c.json({ ok: true });
  });
