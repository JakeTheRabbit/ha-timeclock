import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, breaks, employees, payPeriods, auditLog } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { ensurePeriodContaining } from "@/server/domain/payperiod/periods";
import { buildTimesheet } from "@/server/domain/payperiod/timesheet";
import { nzDateOf } from "@/server/domain/holidays/stat-pay";

export const manager = new Hono<AppEnv>()
  .use(requireRole("lead"))

  // Live board: everyone currently clocked in (+ break state) and today's total.
  .get("/board", async (c) => {
    const db = getDb();
    const open = await db
      .select({
        entryId: timeEntries.id,
        employeeId: timeEntries.employeeId,
        employeeName: employees.displayName,
        clockIn: timeEntries.clockIn,
      })
      .from(timeEntries)
      .innerJoin(employees, eq(timeEntries.employeeId, employees.id))
      .where(isNull(timeEntries.clockOut))
      .orderBy(timeEntries.clockIn);

    const withBreaks = await Promise.all(
      open.map(async (o) => {
        const ob = await db.query.breaks.findFirst({
          where: (b, { eq: eq_, and: and_, isNull: isNull_ }) =>
            and_(eq_(b.timeEntryId, o.entryId), isNull_(b.endAt)),
        });
        return { ...o, onBreak: !!ob, breakSince: ob?.startAt ?? null };
      }),
    );

    // Today's closed minutes per employee (NZ day) for the board footer.
    const todayNZ = nzDateOf(new Date());
    const closedToday = await db
      .select()
      .from(timeEntries)
      .where(and(gte(timeEntries.clockIn, new Date(Date.now() - 36 * 3600_000))));
    const todayMin = new Map<string, number>();
    for (const e of closedToday) {
      if (!e.clockOut || nzDateOf(e.clockIn) !== todayNZ) continue;
      todayMin.set(
        e.employeeId,
        (todayMin.get(e.employeeId) ?? 0) +
          Math.round((e.clockOut.getTime() - e.clockIn.getTime()) / 60_000),
      );
    }

    return c.json({
      now: new Date().toISOString(),
      clockedIn: withBreaks,
      todayClosedMin: Object.fromEntries(todayMin),
    });
  })

  // ---- Pay periods ----
  .get("/pay-periods", async (c) => {
    // Materialize the current period, then list recent.
    await ensurePeriodContaining(new Date());
    const rows = await getDb()
      .select()
      .from(payPeriods)
      .orderBy(desc(payPeriods.startAt))
      .limit(12);
    return c.json({ periods: rows });
  })

  .get("/pay-periods/:id/timesheet", async (c) => {
    const id = c.req.param("id")!;
    const period = await getDb().query.payPeriods.findFirst({
      where: (p, { eq: eq_ }) => eq_(p.id, id),
    });
    if (!period) return c.json({ error: "not_found" }, 404);
    return c.json({ period, rows: await buildTimesheet(period) });
  })

  // Sign-off + LOCK (manager+). Locked periods are immutable (guard on edits).
  .post("/pay-periods/:id/lock", requireRole("manager"), async (c) => {
    const id = c.req.param("id")!;
    const actor = c.get("auth")!.employee;
    const db = getDb();
    const period = await db.query.payPeriods.findFirst({ where: (p, { eq: eq_ }) => eq_(p.id, id) });
    if (!period) return c.json({ error: "not_found" }, 404);
    if (period.lockedAt) return c.json({ error: "already_locked" }, 409);
    if (period.endAt > new Date()) return c.json({ error: "period_not_finished" }, 409);

    // Open entries inside the period block the lock (must be resolved first).
    const openInPeriod = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(timeEntries)
      .where(
        and(
          gte(timeEntries.clockIn, period.startAt),
          lt(timeEntries.clockIn, period.endAt),
          isNull(timeEntries.clockOut),
        ),
      );
    if (openInPeriod[0].n > 0) {
      return c.json({ error: "open_entries_in_period", count: openInPeriod[0].n }, 409);
    }

    const now = new Date();
    await db
      .update(payPeriods)
      .set({ lockedAt: now, lockedBy: actor.id })
      .where(eq(payPeriods.id, id));
    await appendAudit({
      entityType: "pay_period",
      entityId: id,
      action: "lock",
      actorId: actor.id,
      newValue: { lockedAt: now.toISOString(), startAt: period.startAt, endAt: period.endAt },
    });
    return c.json({ ok: true });
  })

  // Admin-only escape hatch; loudly audited.
  .post("/pay-periods/:id/unlock", requireRole("admin"), async (c) => {
    const id = c.req.param("id")!;
    const body = z
      .object({ reason: z.string().min(5).max(300) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "reason_required" }, 400);
    const actor = c.get("auth")!.employee;
    const db = getDb();
    const period = await db.query.payPeriods.findFirst({ where: (p, { eq: eq_ }) => eq_(p.id, id) });
    if (!period?.lockedAt) return c.json({ error: "not_locked" }, 409);

    await db.update(payPeriods).set({ lockedAt: null, lockedBy: null }).where(eq(payPeriods.id, id));
    await appendAudit({
      entityType: "pay_period",
      entityId: id,
      action: "unlock",
      actorId: actor.id,
      reason: body.data.reason,
      oldValue: { lockedAt: period.lockedAt.toISOString() },
      newValue: { lockedAt: null },
    });
    return c.json({ ok: true });
  })

  // ---- Compliance audit viewer ----
  .get("/audit", async (c) => {
    const q = z
      .object({
        entityType: z.string().optional(),
        entityId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse({
        entityType: c.req.query("entityType"),
        entityId: c.req.query("entityId"),
        limit: c.req.query("limit"),
      });

    const conds = [];
    if (q.entityType) conds.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) conds.push(eq(auditLog.entityId, q.entityId));

    const rows = await getDb()
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        action: auditLog.action,
        actorId: auditLog.actorId,
        reason: auditLog.reason,
        oldValue: auditLog.oldValue,
        newValue: auditLog.newValue,
        hash: auditLog.hash,
      })
      .from(auditLog)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(q.limit);
    return c.json({ rows });
  })

  // Chain integrity, on demand (surfaced in the audit viewer header).
  .get("/audit/verify", async (c) => {
    const res = await getDb().execute(sql`SELECT ok, broken_at, detail FROM verify_audit_chain()`);
    return c.json(res.rows[0]);
  });
