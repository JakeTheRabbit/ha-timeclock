import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lt, lte, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  dayApprovals,
  employees,
  modificationMessages,
  modifications,
  timeEntries,
  type Employee,
  type Modification,
} from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole, roleAtLeast } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { dayOf } from "@/server/domain/time/day-review";
import { hydrateEntries } from "@/server/routes/entries";
import { notify } from "@/server/integrations/notify";
import { notifyEmployee } from "@/server/integrations/notify/personal";

// Day review (0.10.0): staff change their own days and give a reason; the
// manager sees each change on a list and either ACKNOWLEDGES it (read it, no
// approval needed) or DISPUTES it, which opens a conversation with the
// employee. Approving a day locks it against further staff edits.

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z.object({ body: z.string().trim().min(1).max(2000) });
const noteSchema = z.object({ note: z.string().max(500).optional() });

/** Day string (YYYY-MM-DD) -> instant window that safely covers it in any TZ. */
const coverFrom = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 36 * 3600_000);
const coverTo = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 60 * 3600_000);

async function withThreads(rows: Modification[]) {
  const db = getDb();
  const ids = rows.map((r) => r.id);
  const msgs = ids.length
    ? await db
        .select({ m: modificationMessages, authorName: employees.displayName })
        .from(modificationMessages)
        .innerJoin(employees, eq(modificationMessages.authorId, employees.id))
        .where(inArray(modificationMessages.modificationId, ids))
        .orderBy(asc(modificationMessages.createdAt))
    : [];
  const people = new Set<string>();
  for (const r of rows) {
    people.add(r.employeeId);
    for (const k of [r.acknowledgedBy, r.disputedBy, r.resolvedBy]) if (k) people.add(k);
  }
  const names = people.size
    ? new Map(
        (
          await db
            .select({ id: employees.id, name: employees.displayName })
            .from(employees)
            .where(inArray(employees.id, [...people]))
        ).map((p) => [p.id, p.name]),
      )
    : new Map<string, string>();
  return rows.map((r) => ({
    ...r,
    employeeName: names.get(r.employeeId) ?? "?",
    acknowledgedByName: r.acknowledgedBy ? (names.get(r.acknowledgedBy) ?? null) : null,
    disputedByName: r.disputedBy ? (names.get(r.disputedBy) ?? null) : null,
    resolvedByName: r.resolvedBy ? (names.get(r.resolvedBy) ?? null) : null,
    messages: msgs
      .filter((x) => x.m.modificationId === r.id)
      .map((x) => ({ id: x.m.id, authorId: x.m.authorId, authorName: x.authorName, body: x.m.body, createdAt: x.m.createdAt })),
  }));
}

async function findMod(id: string) {
  return getDb().query.modifications.findFirst({ where: (m, { eq: eq_ }) => eq_(m.id, id) });
}

async function employeeById(id: string): Promise<Employee | undefined> {
  return getDb().query.employees.findFirst({ where: (e, { eq: eq_ }) => eq_(e.id, id) });
}

async function postMessage(mod: Modification, author: Employee, body: string) {
  const [row] = await getDb()
    .insert(modificationMessages)
    .values({ modificationId: mod.id, authorId: author.id, body })
    .returning();
  await appendAudit({
    entityType: "modification",
    entityId: mod.id,
    action: "message",
    actorId: author.id,
    newValue: { messageId: row.id, body },
  });
  return row;
}

export const review = new Hono<AppEnv>()
  .use(requireRole("employee"))

  // ---- Staff side ----
  // My approved days + my modifications (with any dispute threads) in a range.
  .get("/mine", async (c) => {
    const q = z.object({ from: DAY, to: DAY }).safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;
    const db = getDb();
    const days = await db
      .select({ day: dayApprovals.day, approvedAt: dayApprovals.approvedAt })
      .from(dayApprovals)
      .where(and(eq(dayApprovals.employeeId, me.id), gte(dayApprovals.day, q.data.from), lte(dayApprovals.day, q.data.to)));
    const mods = await db
      .select()
      .from(modifications)
      .where(and(eq(modifications.employeeId, me.id), gte(modifications.day, q.data.from), lte(modifications.day, q.data.to)))
      .orderBy(desc(modifications.createdAt));
    return c.json({ approvedDays: days.map((d) => d.day), modifications: await withThreads(mods) });
  })

  // Open disputes for me, whatever the date (home banner / My hours badge).
  .get("/mine/disputes", async (c) => {
    const me = c.get("auth")!.employee;
    const mods = await getDb()
      .select()
      .from(modifications)
      .where(and(eq(modifications.employeeId, me.id), eq(modifications.status, "disputed")))
      .orderBy(desc(modifications.disputedAt));
    return c.json({ modifications: await withThreads(mods) });
  })

  // One modification + thread (owner or lead+).
  .get("/modifications/:id", async (c) => {
    const me = c.get("auth")!.employee;
    const mod = await findMod(c.req.param("id"));
    if (!mod) return c.json({ error: "not_found" }, 404);
    if (mod.employeeId !== me.id && !roleAtLeast(me.role, "lead")) return c.json({ error: "forbidden" }, 403);
    return c.json({ modification: (await withThreads([mod]))[0] });
  })

  // Reply in a dispute thread (owner or lead+).
  .post("/modifications/:id/messages", async (c) => {
    const body = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;
    const mod = await findMod(c.req.param("id"));
    if (!mod) return c.json({ error: "not_found" }, 404);
    const isOwner = mod.employeeId === me.id;
    if (!isOwner && !roleAtLeast(me.role, "lead")) return c.json({ error: "forbidden" }, 403);
    const row = await postMessage(mod, me, body.data.body);
    if (isOwner) {
      void notify({ title: "Time Clock: dispute reply", message: `${me.displayName}: ${body.data.body}` });
    } else {
      const emp = await employeeById(mod.employeeId);
      if (emp) void notifyEmployee(emp, { title: "Time Clock", message: `${me.displayName}: ${body.data.body}` });
    }
    return c.json({ ok: true, messageId: row.id }, 201);
  })

  // ---- Manager side (lead and above) ----
  // The modifications list. status=open (default): pending + disputed.
  .get("/modifications", requireRole("lead"), async (c) => {
    const q = z
      .object({
        status: z.enum(["open", "pending", "disputed", "acknowledged", "resolved", "all"]).default("open"),
        employeeId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .safeParse({ status: c.req.query("status"), employeeId: c.req.query("employeeId"), limit: c.req.query("limit") });
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const conds: SQL[] = [];
    if (q.data.status === "open") conds.push(inArray(modifications.status, ["pending", "disputed"]));
    else if (q.data.status !== "all") conds.push(eq(modifications.status, q.data.status));
    if (q.data.employeeId) conds.push(eq(modifications.employeeId, q.data.employeeId));
    const rows = await getDb()
      .select()
      .from(modifications)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(q.data.status === "open" ? asc(modifications.createdAt) : desc(modifications.createdAt))
      .limit(q.data.limit);
    return c.json({ modifications: await withThreads(rows) });
  })

  // "I have read it." No approval needed — just a tick.
  .post("/modifications/:id/acknowledge", requireRole("lead"), async (c) => {
    const me = c.get("auth")!.employee;
    const mod = await findMod(c.req.param("id")!);
    if (!mod) return c.json({ error: "not_found" }, 404);
    if (mod.status !== "pending") return c.json({ error: "not_pending", status: mod.status }, 409);
    const now = new Date();
    await getDb()
      .update(modifications)
      .set({ status: "acknowledged", acknowledgedBy: me.id, acknowledgedAt: now })
      .where(eq(modifications.id, mod.id));
    await appendAudit({
      entityType: "modification",
      entityId: mod.id,
      action: "acknowledge",
      actorId: me.id,
      oldValue: { status: mod.status },
      newValue: { status: "acknowledged" },
    });
    return c.json({ ok: true });
  })

  // Acknowledge many at once (the "tick all" button).
  .post("/modifications/acknowledge", requireRole("lead"), async (c) => {
    const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;
    const db = getDb();
    const rows = await db
      .select()
      .from(modifications)
      .where(and(inArray(modifications.id, body.data.ids), eq(modifications.status, "pending")));
    const now = new Date();
    for (const mod of rows) {
      await db
        .update(modifications)
        .set({ status: "acknowledged", acknowledgedBy: me.id, acknowledgedAt: now })
        .where(eq(modifications.id, mod.id));
      await appendAudit({
        entityType: "modification",
        entityId: mod.id,
        action: "acknowledge",
        actorId: me.id,
        oldValue: { status: "pending" },
        newValue: { status: "acknowledged" },
      });
    }
    return c.json({ ok: true, acknowledged: rows.length });
  })

  // "I don't agree" — opens a conversation with the employee.
  .post("/modifications/:id/dispute", requireRole("lead"), async (c) => {
    const body = z.object({ message: z.string().trim().min(3).max(2000) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "message_required" }, 400);
    const me = c.get("auth")!.employee;
    const mod = await findMod(c.req.param("id")!);
    if (!mod) return c.json({ error: "not_found" }, 404);
    if (mod.status === "disputed") return c.json({ error: "already_disputed" }, 409);
    const now = new Date();
    await getDb()
      .update(modifications)
      .set({ status: "disputed", disputedBy: me.id, disputedAt: now, resolvedBy: null, resolvedAt: null })
      .where(eq(modifications.id, mod.id));
    await appendAudit({
      entityType: "modification",
      entityId: mod.id,
      action: "dispute",
      actorId: me.id,
      reason: body.data.message,
      oldValue: { status: mod.status },
      newValue: { status: "disputed" },
    });
    await postMessage(mod, me, body.data.message);
    const emp = await employeeById(mod.employeeId);
    if (emp)
      void notifyEmployee(emp, {
        title: "Time Clock: please check your hours",
        message: `${me.displayName} has a question about your change on ${mod.day}: ${body.data.message}`,
      });
    return c.json({ ok: true });
  })

  // Close a dispute (after talking it through / fixing the times).
  .post("/modifications/:id/resolve", requireRole("lead"), async (c) => {
    const body = noteSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;
    const mod = await findMod(c.req.param("id")!);
    if (!mod) return c.json({ error: "not_found" }, 404);
    if (mod.status !== "disputed") return c.json({ error: "not_disputed" }, 409);
    await getDb()
      .update(modifications)
      .set({ status: "resolved", resolvedBy: me.id, resolvedAt: new Date() })
      .where(eq(modifications.id, mod.id));
    if (body.data.note) await postMessage(mod, me, body.data.note);
    await appendAudit({
      entityType: "modification",
      entityId: mod.id,
      action: "resolve",
      actorId: me.id,
      reason: body.data.note ?? null,
      oldValue: { status: "disputed" },
      newValue: { status: "resolved" },
    });
    return c.json({ ok: true });
  })

  // Per-day summary for one employee: hours, approval, open modifications.
  .get("/days", requireRole("lead"), async (c) => {
    const q = z
      .object({ employeeId: z.string().uuid(), from: DAY, to: DAY })
      .refine((v) => v.from <= v.to)
      .safeParse({ employeeId: c.req.query("employeeId"), from: c.req.query("from"), to: c.req.query("to") });
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const { employeeId, from, to } = q.data;
    const db = getDb();
    const rows = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, employeeId),
          gte(timeEntries.clockIn, coverFrom(from)),
          lt(timeEntries.clockIn, coverTo(to)),
        ),
      )
      .orderBy(asc(timeEntries.clockIn));
    const hydrated = (await hydrateEntries(rows)).filter((e) => e.day >= from && e.day <= to);
    const approvals = await db
      .select({ a: dayApprovals, by: employees.displayName })
      .from(dayApprovals)
      .innerJoin(employees, eq(dayApprovals.approvedBy, employees.id))
      .where(and(eq(dayApprovals.employeeId, employeeId), gte(dayApprovals.day, from), lte(dayApprovals.day, to)));
    const mods = await db
      .select({ day: modifications.day, status: modifications.status })
      .from(modifications)
      .where(and(eq(modifications.employeeId, employeeId), gte(modifications.day, from), lte(modifications.day, to)));

    const days = new Map<string, {
      day: string;
      entries: typeof hydrated;
      workedMinutes: number;
      hasOpen: boolean;
      approved: { at: Date; by: string } | null;
      pendingMods: number;
      disputedMods: number;
    }>();
    const get = (d: string) => {
      let v = days.get(d);
      if (!v) {
        v = { day: d, entries: [], workedMinutes: 0, hasOpen: false, approved: null, pendingMods: 0, disputedMods: 0 };
        days.set(d, v);
      }
      return v;
    };
    for (const e of hydrated) {
      const d = get(e.day);
      d.entries.push(e);
      d.workedMinutes += e.workedMinutes ?? 0;
      if (!e.clockOut) d.hasOpen = true;
    }
    for (const a of approvals) get(a.a.day).approved = { at: a.a.approvedAt, by: a.by };
    for (const m of mods) {
      if (m.status === "pending") get(m.day).pendingMods++;
      if (m.status === "disputed") get(m.day).disputedMods++;
    }
    return c.json({ days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)) });
  })

  // Approve day(s): staff can no longer edit them. Open shifts or an open
  // dispute on the day block approval.
  .post("/days/approve", requireRole("lead"), async (c) => {
    const body = z
      .object({ employeeId: z.string().uuid(), days: z.array(DAY).min(1).max(62) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;
    const { employeeId } = body.data;
    const daysWanted = [...new Set(body.data.days)].sort();
    const db = getDb();

    const open = await db.query.timeEntries.findMany({
      where: (t, { eq: eq_, and: and_, isNull: isNull_ }) => and_(eq_(t.employeeId, employeeId), isNull_(t.clockOut)),
    });
    const openDays = new Set(open.map((e) => dayOf(e.clockIn)));
    const disputed = await db
      .select({ day: modifications.day })
      .from(modifications)
      .where(
        and(
          eq(modifications.employeeId, employeeId),
          eq(modifications.status, "disputed"),
          inArray(modifications.day, daysWanted),
        ),
      );
    const disputedDays = new Set(disputed.map((d) => d.day));

    const approved: string[] = [];
    const skipped: { day: string; reason: string }[] = [];
    for (const day of daysWanted) {
      if (openDays.has(day)) {
        skipped.push({ day, reason: "open_entry" });
        continue;
      }
      if (disputedDays.has(day)) {
        skipped.push({ day, reason: "dispute_open" });
        continue;
      }
      const [row] = await db
        .insert(dayApprovals)
        .values({ employeeId, day, approvedBy: me.id })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        skipped.push({ day, reason: "already_approved" });
        continue;
      }
      approved.push(day);
      await appendAudit({
        entityType: "day",
        entityId: `${employeeId}:${day}`,
        action: "approve",
        actorId: me.id,
        newValue: { employeeId, day },
      });
    }
    return c.json({ ok: true, approved, skipped });
  })

  // Take an approval back (manager+, reason required) — reopens staff edits.
  .post("/days/unapprove", requireRole("manager"), async (c) => {
    const body = z
      .object({ employeeId: z.string().uuid(), day: DAY, reason: z.string().min(3).max(500) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "reason_required" }, 400);
    const me = c.get("auth")!.employee;
    const { employeeId, day, reason } = body.data;
    const [row] = await getDb()
      .delete(dayApprovals)
      .where(and(eq(dayApprovals.employeeId, employeeId), eq(dayApprovals.day, day)))
      .returning();
    if (!row) return c.json({ error: "not_approved" }, 404);
    await appendAudit({
      entityType: "day",
      entityId: `${employeeId}:${day}`,
      action: "unapprove",
      actorId: me.id,
      reason,
      oldValue: { approvedBy: row.approvedBy, approvedAt: row.approvedAt.toISOString() },
      newValue: null,
    });
    return c.json({ ok: true });
  });
