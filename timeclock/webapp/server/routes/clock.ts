import { Hono } from "hono";
import { z } from "zod";
import { and, eq, isNull, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, breaks, jobs } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { autoDeductMinutes, unpaidBreakMinutes, workedMinutes } from "@/server/domain/time/breaks";
import { getSettings } from "@/server/domain/settings";
import { geofenceFlag } from "@/server/domain/antifraud/geofence";
import { ipFlag } from "@/server/domain/antifraud/ip-lock";
import { decodePunchPhoto, savePunchPhoto, PhotoError } from "@/server/domain/antifraud/photo";

const clockInSchema = z.object({
  jobId: z.string().uuid().nullish(),
  geo: z.object({ lat: z.number(), lng: z.number() }).nullish(),
  photo: z.string().max(3_000_000).nullish(), // base64 JPEG (photo-on-punch)
  // Offline kiosk queue (P12): punch happened while the tablet was offline.
  // Bounded to the last 24h; the entry is flagged for manager review.
  clientQueuedAt: z.string().datetime({ offset: true }).nullish(),
});

/** Validate an offline-queued timestamp: within the last 24h, not in future. */
function queuedInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const at = new Date(iso);
  const age = Date.now() - at.getTime();
  if (age < 0 || age > 24 * 3600_000) return null;
  return at;
}
const breakStartSchema = z.object({ paid: z.boolean().default(false) });

async function openEntryFor(employeeId: string) {
  return getDb().query.timeEntries.findFirst({
    where: (t, { eq: eq_, and: and_, isNull: isNull_ }) =>
      and_(eq_(t.employeeId, employeeId), isNull_(t.clockOut)),
    orderBy: (t, { desc: desc_ }) => desc_(t.clockIn),
  });
}

async function openBreakFor(entryId: string) {
  return getDb().query.breaks.findFirst({
    where: (b, { eq: eq_, and: and_, isNull: isNull_ }) =>
      and_(eq_(b.timeEntryId, entryId), isNull_(b.endAt)),
  });
}

export const clock = new Hono<AppEnv>()
  .use(requireRole("employee"))

  // Current punch state for the signed-in employee (drives the kiosk screen).
  .get("/status", async (c) => {
    const me = c.get("auth")!.employee;
    const entry = await openEntryFor(me.id);
    if (!entry) return c.json({ open: null });

    const db = getDb();
    const entryBreaks = await db.query.breaks.findMany({
      where: (b, { eq: eq_ }) => eq_(b.timeEntryId, entry.id),
    });
    const job = entry.jobId
      ? await db.query.jobs.findFirst({ where: (j, { eq: eq_ }) => eq_(j.id, entry.jobId!) })
      : null;
    const onBreak = entryBreaks.find((b) => b.endAt == null) ?? null;

    return c.json({
      open: {
        entryId: entry.id,
        clockIn: entry.clockIn,
        job: job ? { id: job.id, name: job.name } : null,
        onBreak: onBreak
          ? { breakId: onBreak.id, startAt: onBreak.startAt, paid: onBreak.paid }
          : null,
        unpaidBreakMin: unpaidBreakMinutes(entryBreaks, new Date()),
      },
    });
  })

  .post("/in", async (c) => {
    const body = clockInSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;

    if (await openEntryFor(me.id)) return c.json({ error: "already_clocked_in" }, 409);

    // ---- Anti-fraud checks (P11): flag always; block only when enforced. ----
    const { antifraud } = await getSettings();
    const flags: string[] = [];

    const gf = geofenceFlag(antifraud.geofence, body.data.geo ?? null);
    if (gf) {
      if (antifraud.geofence.enforce) return c.json({ error: "geofence_rejected", flag: gf }, 403);
      flags.push(gf);
    }

    const punchIp =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
      c.req.header("x-real-ip") ??
      null;
    const ipf = ipFlag(antifraud.ipAllowlist, punchIp);
    if (ipf) {
      if (antifraud.ipEnforce) return c.json({ error: "ip_rejected", flag: ipf }, 403);
      flags.push(ipf);
    }

    if (antifraud.photoOnPunch && !body.data.photo) {
      return c.json({ error: "photo_required" }, 400);
    }
    if (antifraud.photoOnPunch && body.data.photo) {
      try {
        decodePunchPhoto(body.data.photo);
      } catch (e) {
        if (e instanceof PhotoError) return c.json({ error: e.code }, 400);
        throw e;
      }
    }

    const queued = queuedInstant(body.data.clientQueuedAt);
    if (queued) flags.push("offline_queued");

    const [entry] = await getDb()
      .insert(timeEntries)
      .values({
        employeeId: me.id,
        clockIn: queued ?? new Date(),
        jobId: body.data.jobId ?? null,
        geoLat: body.data.geo?.lat ?? null,
        geoLng: body.data.geo?.lng ?? null,
        punchIp,
        fraudFlags: flags,
      })
      .returning();

    // Photo persists after the entry exists (path is keyed by entry id).
    let photoPath: string | null = null;
    if (body.data.photo) {
      try {
        photoPath = savePunchPhoto(entry.id, body.data.photo);
        await getDb().update(timeEntries).set({ photoPath }).where(eq(timeEntries.id, entry.id));
      } catch (e) {
        if (e instanceof PhotoError && antifraud.photoOnPunch) {
          // Final guard only. Enforced photo validation happens before insert.
          flags.push(e.code);
          await getDb().update(timeEntries).set({ fraudFlags: flags }).where(eq(timeEntries.id, entry.id));
        }
      }
    }

    await appendAudit({
      entityType: "time_entry",
      entityId: entry.id,
      action: "clock_in",
      actorId: me.id,
      newValue: {
        clockIn: entry.clockIn.toISOString(),
        jobId: entry.jobId,
        ip: punchIp,
        geo: body.data.geo ?? null,
        photo: photoPath != null,
        fraudFlags: flags,
      },
    });
    return c.json({ ok: true, entryId: entry.id, clockIn: entry.clockIn, fraudFlags: flags }, 201);
  })

  .post("/out", async (c) => {
    const me = c.get("auth")!.employee;
    const entry = await openEntryFor(me.id);
    if (!entry) return c.json({ error: "not_clocked_in" }, 409);
    const db = getDb();
    const outBody = z
      .object({ clientQueuedAt: z.string().datetime({ offset: true }).nullish() })
      .safeParse(await c.req.json().catch(() => ({})));
    const queuedOut = outBody.success ? queuedInstant(outBody.data.clientQueuedAt) : null;
    const now = queuedOut && queuedOut > entry.clockIn ? queuedOut : new Date();

    // Close any open break at the same instant.
    const open = await openBreakFor(entry.id);
    if (open) {
      await db.update(breaks).set({ endAt: now }).where(eq(breaks.id, open.id));
      await appendAudit({
        entityType: "break",
        entityId: open.id,
        action: "break_end",
        actorId: me.id,
        reason: "auto-closed at clock-out",
        newValue: { endAt: now.toISOString() },
      });
    }

    // Auto-deduct a meal break if none was taken on a long shift.
    const entryBreaks = await db.query.breaks.findMany({
      where: (b, { eq: eq_ }) => eq_(b.timeEntryId, entry.id),
    });
    const shiftMin = (now.getTime() - entry.clockIn.getTime()) / 60_000;
    const { breaks: breakRule } = await getSettings();
    const deduct = autoDeductMinutes(shiftMin, unpaidBreakMinutes(entryBreaks, now), breakRule);
    if (deduct > 0) {
      const [b] = await db
        .insert(breaks)
        .values({
          timeEntryId: entry.id,
          startAt: new Date(now.getTime() - deduct * 60_000),
          endAt: now,
          paid: false,
          autoDeducted: true,
        })
        .returning();
      entryBreaks.push(b);
      await appendAudit({
        entityType: "break",
        entityId: b.id,
        action: "auto_deduct",
        actorId: me.id,
        reason: `no unpaid break taken on ${Math.round(shiftMin)}min shift`,
        newValue: { minutes: deduct },
      });
    }

    const [closed] = await db
      .update(timeEntries)
      .set({ clockOut: now, updatedAt: now })
      .where(eq(timeEntries.id, entry.id))
      .returning();

    const worked = workedMinutes(closed.clockIn, now, entryBreaks);
    await appendAudit({
      entityType: "time_entry",
      entityId: entry.id,
      action: "clock_out",
      actorId: me.id,
      newValue: { clockOut: now.toISOString(), workedMinutes: worked, autoDeductedMin: deduct },
    });
    return c.json({ ok: true, workedMinutes: worked, autoDeductedMin: deduct });
  })

  .post("/break/start", async (c) => {
    const body = breakStartSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;
    const entry = await openEntryFor(me.id);
    if (!entry) return c.json({ error: "not_clocked_in" }, 409);
    if (await openBreakFor(entry.id)) return c.json({ error: "already_on_break" }, 409);

    const [b] = await getDb()
      .insert(breaks)
      .values({ timeEntryId: entry.id, startAt: new Date(), paid: body.data.paid })
      .returning();
    await appendAudit({
      entityType: "break",
      entityId: b.id,
      action: "break_start",
      actorId: me.id,
      newValue: { paid: b.paid, startAt: b.startAt.toISOString() },
    });
    return c.json({ ok: true, breakId: b.id }, 201);
  })

  .post("/break/end", async (c) => {
    const me = c.get("auth")!.employee;
    const entry = await openEntryFor(me.id);
    if (!entry) return c.json({ error: "not_clocked_in" }, 409);
    const open = await openBreakFor(entry.id);
    if (!open) return c.json({ error: "not_on_break" }, 409);

    const now = new Date();
    await getDb().update(breaks).set({ endAt: now }).where(eq(breaks.id, open.id));
    await appendAudit({
      entityType: "break",
      entityId: open.id,
      action: "break_end",
      actorId: me.id,
      newValue: { endAt: now.toISOString() },
    });
    return c.json({ ok: true });
  })

  // Job costing: close the current entry and immediately open one on a new job.
  .post("/switch-job", async (c) => {
    const body = z.object({ jobId: z.string().uuid() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;
    const entry = await openEntryFor(me.id);
    if (!entry) return c.json({ error: "not_clocked_in" }, 409);
    if (await openBreakFor(entry.id)) return c.json({ error: "on_break" }, 409);
    const db = getDb();
    const now = new Date();

    await db.update(timeEntries).set({ clockOut: now, updatedAt: now }).where(eq(timeEntries.id, entry.id));
    const [next] = await db
      .insert(timeEntries)
      .values({ employeeId: me.id, clockIn: now, jobId: body.data.jobId })
      .returning();

    await appendAudit({
      entityType: "time_entry",
      entityId: entry.id,
      action: "switch_job_close",
      actorId: me.id,
      newValue: { clockOut: now.toISOString(), nextEntryId: next.id },
    });
    await appendAudit({
      entityType: "time_entry",
      entityId: next.id,
      action: "switch_job_open",
      actorId: me.id,
      newValue: { clockIn: now.toISOString(), jobId: body.data.jobId, prevEntryId: entry.id },
    });
    return c.json({ ok: true, entryId: next.id });
  })

  .get("/jobs", async (c) => {
    const rows = await getDb()
      .select({ id: jobs.id, name: jobs.name, code: jobs.code })
      .from(jobs)
      .where(eq(jobs.active, true))
      .orderBy(jobs.name);
    return c.json({ jobs: rows });
  });
