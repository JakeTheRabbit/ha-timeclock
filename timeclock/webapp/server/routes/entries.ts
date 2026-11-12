import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq, gte, lt, desc, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, breaks, jobs, type Employee, type TimeEntry } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole, roleAtLeast } from "@/server/auth/rbac";
import {
  applyBreakEdit,
  applyBreakRemove,
  applyEntryCreate,
  applyEntryEdit,
  applyEntryRemove,
  EditError,
  type EditSource,
} from "@/server/domain/time/edit";
import { EditGuardError } from "@/server/domain/payperiod/errors";
import { workedMinutes } from "@/server/domain/time/breaks";
import { approvedDayKeys, dayOf, isDayApproved } from "@/server/domain/time/day-review";

const rangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

const editSchema = z
  .object({
    clockIn: z.coerce.date().optional(),
    clockOut: z.coerce.date().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    jobId: z.string().uuid().nullable().optional(),
    reason: z.string().min(3).max(500), // MANDATORY
  })
  .refine((v) => v.clockIn || v.clockOut !== undefined || v.note !== undefined || v.jobId !== undefined, {
    message: "no_changes",
  });

/** Entries + breaks + computed worked minutes for a set of entries. */
export async function hydrateEntries(entryRows: (typeof timeEntries.$inferSelect)[]) {
  const db = getDb();
  const ids = entryRows.map((e) => e.id);
  const allBreaks = ids.length
    ? await db.select().from(breaks).where(inArray(breaks.timeEntryId, ids))
    : [];
  const jobIds = [...new Set(entryRows.map((e) => e.jobId).filter((x): x is string => !!x))];
  const jobRows = jobIds.length
    ? await db.select().from(jobs).where(inArray(jobs.id, jobIds))
    : [];
  const jobById = new Map(jobRows.map((j) => [j.id, j]));
  const approved = await approvedDayKeys(
    [...new Set(entryRows.map((e) => e.employeeId))],
    [...new Set(entryRows.map((e) => dayOf(e.clockIn)))],
  );

  return entryRows.map((e) => {
    const bs = allBreaks.filter((b) => b.timeEntryId === e.id);
    const day = dayOf(e.clockIn);
    const dayApproved = approved.has(`${e.employeeId}|${day}`);
    return {
      id: e.id,
      day,
      dayApproved,
      clockIn: e.clockIn,
      clockOut: e.clockOut,
      edited: e.edited,
      note: e.note,
      job: e.jobId ? { id: e.jobId, name: jobById.get(e.jobId)?.name ?? "?" } : null,
      breaks: bs.map((b) => ({
        id: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
        paid: b.paid,
        autoDeducted: b.autoDeducted,
      })),
      workedMinutes: e.clockOut ? workedMinutes(e.clockIn, e.clockOut, bs) : null,
      // Staff edit freely until a manager approves the day; paid time is
      // settled too. A manager can still change either.
      selfEditable: !dayApproved && e.paidAt == null,
      paidAt: e.paidAt,
      fraudFlags: e.fraudFlags,
    };
  });
}

export const entries = new Hono<AppEnv>()
  .use(requireRole("employee"))

  // My hours across a date range (kiosk/my-hours page groups client-side).
  .get("/mine", async (c) => {
    const q = rangeSchema.safeParse({
      from: c.req.query("from"),
      to: c.req.query("to"),
    });
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;

    const rows = await getDb()
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, me.id),
          gte(timeEntries.clockIn, q.data.from),
          lt(timeEntries.clockIn, q.data.to),
        ),
      )
      .orderBy(desc(timeEntries.clockIn));

    return c.json({ entries: await hydrateEntries(rows) });
  })

  // Add an entry after the fact: a forgotten clock-in, or another start/finish
  // pair on a day the person left site. Staff: own, unapproved days only.
  // Leads+ may add for anyone (employeeId).
  .post("/", async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const me = c.get("auth")!.employee;
    const isLead = roleAtLeast(me.role, "lead");
    const employeeId = body.data.employeeId ?? me.id;
    if (employeeId !== me.id && !isLead) return c.json({ error: "not_your_entry" }, 403);
    if (!isLead && (await isDayApproved(me.id, dayOf(body.data.clockIn))))
      return c.json({ error: "day_approved" }, 423);

    const { reason, employeeId: _ignored, ...rest } = body.data;
    return guarded(c, async () => {
      const row = await applyEntryCreate({
        employeeId,
        clockIn: rest.clockIn,
        clockOut: rest.clockOut ?? null,
        note: rest.note ?? null,
        jobId: rest.jobId ?? null,
        actorId: me.id,
        reason,
        source: isLead ? "manager_edit" : "self_edit",
      });
      return c.json({ ok: true, entryId: row.id }, 201);
    });
  })

  // Remove an entry (and its breaks). Reason required; audited.
  .delete("/:id", async (c) => {
    const body = reasonSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "reason_required" }, 400);
    const me = c.get("auth")!.employee;
    const entry = await getDb().query.timeEntries.findFirst({
      where: (t, { eq: eq_ }) => eq_(t.id, c.req.param("id")),
    });
    if (!entry) return c.json({ error: "not_found" }, 404);
    const access = await editAccess(me, entry);
    if ("error" in access) return c.json({ error: access.error }, access.status);

    return guarded(c, async () => {
      await applyEntryRemove({ entry, actorId: me.id, reason: body.data.reason, source: access.source });
      return c.json({ ok: true });
    });
  })

  // Edit an entry (open or closed). Every change requires a reason and writes
  // an audit row; the entry is flagged `edited` forever. Locked pay periods
  // reject. Owners edit until the day is approved; leads+ edit anyone's.
  .patch("/:id", async (c) => {
    const body = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const me = c.get("auth")!.employee;

    const entry = await getDb().query.timeEntries.findFirst({
      where: (t, { eq: eq_ }) => eq_(t.id, c.req.param("id")),
    });
    if (!entry) return c.json({ error: "not_found" }, 404);
    const access = await editAccess(me, entry, body.data.clockIn);
    if ("error" in access) return c.json({ error: access.error }, access.status);

    const { reason, ...edit } = body.data;
    return guarded(c, async () => {
      const after = await applyEntryEdit({ entry, edit, actorId: me.id, reason, source: access.source });
      return c.json({ ok: true, entry: { id: after.id, edited: after.edited } });
    });
  })

  // Add a missed break to an entry.
  .post("/:id/breaks", async (c) => {
    const body = breakSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const me = c.get("auth")!.employee;
    const entry = await getDb().query.timeEntries.findFirst({
      where: (t, { eq: eq_ }) => eq_(t.id, c.req.param("id")),
    });
    if (!entry) return c.json({ error: "not_found" }, 404);
    const access = await editAccess(me, entry);
    if ("error" in access) return c.json({ error: access.error }, access.status);

    const { reason, ...edit } = body.data;
    return guarded(c, async () => {
      const b = await applyBreakEdit({ entry, brk: null, edit, actorId: me.id, reason, source: access.source });
      return c.json({ ok: true, breakId: b.id }, 201);
    });
  })

  // Fix a break's start/end/paid.
  .patch("/:id/breaks/:breakId", async (c) => {
    const body = breakSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const me = c.get("auth")!.employee;
    const db = getDb();
    const entry = await db.query.timeEntries.findFirst({
      where: (t, { eq: eq_ }) => eq_(t.id, c.req.param("id")),
    });
    const brk = await db.query.breaks.findFirst({
      where: (b, { eq: eq_ }) => eq_(b.id, c.req.param("breakId")),
    });
    if (!entry || !brk || brk.timeEntryId !== entry.id) return c.json({ error: "not_found" }, 404);
    const access = await editAccess(me, entry);
    if ("error" in access) return c.json({ error: access.error }, access.status);

    const { reason, ...edit } = body.data;
    return guarded(c, async () => {
      await applyBreakEdit({ entry, brk, edit, actorId: me.id, reason, source: access.source });
      return c.json({ ok: true });
    });
  })

  // Remove a break (taken in error, or a wrong auto-deduction).
  .delete("/:id/breaks/:breakId", async (c) => {
    const body = reasonSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "reason_required" }, 400);
    const me = c.get("auth")!.employee;
    const db = getDb();
    const entry = await db.query.timeEntries.findFirst({
      where: (t, { eq: eq_ }) => eq_(t.id, c.req.param("id")),
    });
    const brk = await db.query.breaks.findFirst({
      where: (b, { eq: eq_ }) => eq_(b.id, c.req.param("breakId")),
    });
    if (!entry || !brk || brk.timeEntryId !== entry.id) return c.json({ error: "not_found" }, 404);
    const access = await editAccess(me, entry);
    if ("error" in access) return c.json({ error: access.error }, access.status);

    return guarded(c, async () => {
      await applyBreakRemove({ entry, brk, actorId: me.id, reason: body.data.reason, source: access.source });
      return c.json({ ok: true });
    });
  });

const reasonSchema = z.object({ reason: z.string().min(3).max(500) });

const createSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    clockIn: z.coerce.date(),
    clockOut: z.coerce.date().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    jobId: z.string().uuid().nullable().optional(),
    reason: z.string().min(3).max(500), // MANDATORY
  });

const breakSchema = z.object({
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().nullable().optional(),
  paid: z.boolean().optional(),
  reason: z.string().min(3).max(500), // MANDATORY
});

/**
 * Who may edit this entry, and how it is audited: leads+ edit anyone's at any
 * time (manager_edit); owners until a manager approves the day and while it
 * isn't paid. A moved start time may not land on an approved day either.
 */
async function editAccess(
  me: Employee,
  entry: TimeEntry,
  newClockIn?: Date,
): Promise<{ source: EditSource } | { error: string; status: 403 | 423 }> {
  if (roleAtLeast(me.role, "lead")) return { source: "manager_edit" };
  if (entry.employeeId !== me.id) return { error: "not_your_entry", status: 403 };
  if (entry.paidAt) return { error: "entry_paid", status: 423 };
  if (await isDayApproved(me.id, dayOf(entry.clockIn))) return { error: "day_approved", status: 423 };
  if (newClockIn && (await isDayApproved(me.id, dayOf(newClockIn)))) return { error: "day_approved", status: 423 };
  return { source: "self_edit" };
}

/** Map domain edit errors to HTTP: locked period 423, bad times 400. */
async function guarded(c: Context<AppEnv>, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EditGuardError) return c.json({ error: e.code }, 423);
    if (e instanceof EditError) return c.json({ error: e.code }, e.code === "entry_paid" ? 423 : 400);
    throw e;
  }
}
