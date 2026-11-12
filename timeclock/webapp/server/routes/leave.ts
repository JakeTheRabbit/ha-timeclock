import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { leaveRequests, leaveLedger, leaveAccrualMarks, employees, rosters } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { runAccrual, leaveBalances, ANNUAL_ACCRUAL_RATE } from "@/server/domain/leave/accrual";
import { notifyEmployee } from "@/server/integrations/notify/personal";

const dateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const LEDGER_TYPES = ["annual", "sick", "bereavement", "alt_holiday"] as const;

const requestSchema = z
  .object({
    type: z.enum(["annual", "sick", "bereavement", "alt_holiday", "unpaid"]),
    startDate: dateISO,
    endDate: dateISO,
    hours: z.number().positive().max(400),
    note: z.string().max(300).nullish(),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "end_before_start" });

/** Push the decision (and any reviewer note) to the requester's phone. */
async function notifyLeaveDecision(
  row: { employeeId: string; type: string; startDate: string; endDate: string; hours: string },
  reviewerName: string,
  decision: "approved" | "declined",
  note: string | null,
) {
  const emp = await getDb().query.employees.findFirst({ where: (e, { eq: eq_ }) => eq_(e.id, row.employeeId) });
  if (!emp) return;
  const range = row.startDate === row.endDate ? row.startDate : `${row.startDate} to ${row.endDate}`;
  await notifyEmployee(emp, {
    title: `Time Clock: leave ${decision}`,
    message:
      `${reviewerName} ${decision} your ${row.type.replace("_", " ")} leave ${range} (${Number(row.hours)}h)` +
      (note ? `: ${note}` : "."),
  });
}

export const leave = new Hono<AppEnv>()
  .use(requireRole("employee"))

  .get("/mine", async (c) => {
    const me = c.get("auth")!.employee;
    const rows = await getDb()
      .select()
      .from(leaveRequests)
      .where(eq(leaveRequests.employeeId, me.id))
      .orderBy(desc(leaveRequests.createdAt));
    return c.json({ requests: rows, balances: await leaveBalances(me.id) });
  })

  .post("/", async (c) => {
    const body = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const me = c.get("auth")!.employee;

    // Balance check for balance-tracked types (unpaid is always allowed).
    // Pending requests of the same type count against it, so two pending
    // requests can't overbook the balance between them.
    if (body.data.type !== "unpaid") {
      const balance = (await leaveBalances(me.id))[body.data.type] ?? 0;
      const [p] = await getDb()
        .select({ total: sql<string>`coalesce(sum(${leaveRequests.hours}), 0)` })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.employeeId, me.id),
            eq(leaveRequests.type, body.data.type),
            eq(leaveRequests.status, "pending"),
          ),
        );
      const pending = Number(p?.total ?? 0);
      const available = Math.max(0, balance - pending);
      if (available < body.data.hours) {
        return c.json(
          {
            error: balance < body.data.hours ? "insufficient_balance" : "insufficient_balance_pending",
            available,
            pending,
          },
          409,
        );
      }
    }

    const [row] = await getDb()
      .insert(leaveRequests)
      .values({
        employeeId: me.id,
        type: body.data.type,
        startDate: body.data.startDate,
        endDate: body.data.endDate,
        hours: String(body.data.hours),
        note: body.data.note ?? null,
      })
      .returning();

    await appendAudit({
      entityType: "leave_request",
      entityId: row.id,
      action: "request",
      actorId: me.id,
      newValue: { type: row.type, startDate: row.startDate, endDate: row.endDate, hours: row.hours },
    });
    return c.json({ ok: true, requestId: row.id }, 201);
  })

  // Withdraw your own request while it's still pending.
  .post("/:id/cancel", async (c) => {
    const id = c.req.param("id")!;
    const me = c.get("auth")!.employee;
    const db = getDb();
    const row = await db.query.leaveRequests.findFirst({
      where: (x, { eq: eq_, and: and_ }) =>
        and_(eq_(x.id, id), eq_(x.employeeId, me.id), eq_(x.status, "pending")),
    });
    if (!row) return c.json({ error: "not_found_or_reviewed" }, 404);

    await db
      .update(leaveRequests)
      .set({ status: "cancelled" })
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.status, "pending")));
    await appendAudit({
      entityType: "leave_request",
      entityId: id,
      action: "cancel",
      actorId: me.id,
      oldValue: { status: "pending" },
      newValue: { status: "cancelled" },
    });
    return c.json({ ok: true });
  })

  // Pending queue with decision context: balance before/after, who else is
  // off (approved leave overlapping) and who is rostered on those days.
  .get("/pending", requireRole("lead"), async (c) => {
    const db = getDb();
    const rows = await db
      .select({ request: leaveRequests, employeeName: employees.displayName })
      .from(leaveRequests)
      .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
      .where(eq(leaveRequests.status, "pending"))
      .orderBy(leaveRequests.createdAt);
    if (rows.length === 0) return c.json({ requests: [] });

    const from = rows.reduce((m, r) => (r.request.startDate < m ? r.request.startDate : m), rows[0].request.startDate);
    const to = rows.reduce((m, r) => (r.request.endDate > m ? r.request.endDate : m), rows[0].request.endDate);
    const approved = await db
      .select({
        employeeId: leaveRequests.employeeId,
        employeeName: employees.displayName,
        type: leaveRequests.type,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
      })
      .from(leaveRequests)
      .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
      .where(
        and(eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)),
      );
    const shifts = await db
      .select({ employeeId: rosters.employeeId, employeeName: employees.displayName, shiftDate: rosters.shiftDate })
      .from(rosters)
      .innerJoin(employees, eq(rosters.employeeId, employees.id))
      .where(and(eq(rosters.cancelled, false), gte(rosters.shiftDate, from), lte(rosters.shiftDate, to)));

    const balances = new Map<string, Record<string, number>>();
    for (const { request: r } of rows) {
      if (!balances.has(r.employeeId)) balances.set(r.employeeId, await leaveBalances(r.employeeId));
    }

    return c.json({
      requests: rows.map(({ request: r, employeeName }) => {
        const balance = r.type === "unpaid" ? null : (balances.get(r.employeeId)?.[r.type] ?? 0);
        return {
          ...r,
          employeeName,
          balance,
          balanceAfter: balance === null ? null : balance - Number(r.hours),
          alsoOff: approved
            .filter((a) => a.employeeId !== r.employeeId && a.startDate <= r.endDate && a.endDate >= r.startDate)
            .map(({ employeeName: n, type, startDate, endDate }) => ({ employeeName: n, type, startDate, endDate })),
          rostered: [
            ...new Set(
              shifts
                .filter((s) => s.employeeId !== r.employeeId && s.shiftDate >= r.startDate && s.shiftDate <= r.endDate)
                .map((s) => s.employeeName),
            ),
          ],
        };
      }),
    });
  })

  .post("/:id/approve", requireRole("lead"), async (c) => {
    const id = c.req.param("id")!;
    const reviewer = c.get("auth")!.employee;
    const db = getDb();
    const row = await db.query.leaveRequests.findFirst({
      where: (x, { eq: eq_, and: and_ }) => and_(eq_(x.id, id), eq_(x.status, "pending")),
    });
    if (!row) return c.json({ error: "not_found_or_reviewed" }, 404);

    await db
      .update(leaveRequests)
      .set({ status: "approved", reviewerId: reviewer.id, reviewedAt: new Date() })
      .where(eq(leaveRequests.id, id));

    // Deduct from the ledger (unpaid leave has no ledger effect).
    if (row.type !== "unpaid") {
      await db.insert(leaveLedger).values({
        employeeId: row.employeeId,
        type: row.type,
        deltaHours: String(-Number(row.hours)),
        source: "request",
        refId: row.id,
        note: `approved leave ${row.startDate}..${row.endDate}`,
      });
    }
    await appendAudit({
      entityType: "leave_request",
      entityId: id,
      action: "approve",
      actorId: reviewer.id,
      newValue: { hours: row.hours, type: row.type },
    });
    void notifyLeaveDecision(row, reviewer.displayName, "approved", null);
    return c.json({ ok: true });
  })

  .post("/:id/reject", requireRole("lead"), async (c) => {
    const id = c.req.param("id")!;
    const body = z
      .object({ note: z.string().max(300).optional() })
      .safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const reviewer = c.get("auth")!.employee;
    const db = getDb();
    const row = await db.query.leaveRequests.findFirst({
      where: (x, { eq: eq_, and: and_ }) => and_(eq_(x.id, id), eq_(x.status, "pending")),
    });
    if (!row) return c.json({ error: "not_found_or_reviewed" }, 404);

    await db
      .update(leaveRequests)
      .set({
        status: "rejected",
        reviewerId: reviewer.id,
        reviewedAt: new Date(),
        reviewNote: body.data.note ?? null,
      })
      .where(eq(leaveRequests.id, id));
    await appendAudit({
      entityType: "leave_request",
      entityId: id,
      action: "reject",
      actorId: reviewer.id,
      reason: body.data.note ?? null,
    });
    void notifyLeaveDecision(row, reviewer.displayName, "declined", body.data.note ?? null);
    return c.json({ ok: true });
  })

  // Everyone's balances per ledger type, with pending hours and the accrual
  // bookmark — the Leave balances screen.
  .get("/balances", requireRole("manager"), async (c) => {
    const db = getDb();
    const [staff, sums, pending, marks] = await Promise.all([
      db
        .select({ id: employees.id, displayName: employees.displayName })
        .from(employees)
        .where(eq(employees.active, true))
        .orderBy(employees.displayName),
      db
        .select({
          employeeId: leaveLedger.employeeId,
          type: leaveLedger.type,
          total: sql<string>`coalesce(sum(${leaveLedger.deltaHours}), 0)`,
        })
        .from(leaveLedger)
        .groupBy(leaveLedger.employeeId, leaveLedger.type),
      db
        .select({
          employeeId: leaveRequests.employeeId,
          type: leaveRequests.type,
          total: sql<string>`coalesce(sum(${leaveRequests.hours}), 0)`,
        })
        .from(leaveRequests)
        .where(eq(leaveRequests.status, "pending"))
        .groupBy(leaveRequests.employeeId, leaveRequests.type),
      db.select().from(leaveAccrualMarks),
    ]);
    const zero = () => Object.fromEntries(LEDGER_TYPES.map((t) => [t, 0])) as Record<string, number>;
    return c.json({
      types: LEDGER_TYPES,
      annualAccrualRate: ANNUAL_ACCRUAL_RATE,
      employees: staff.map((e) => {
        const balances = zero();
        const pend = zero();
        for (const s of sums) if (s.employeeId === e.id) balances[s.type] = Number(s.total);
        for (const p of pending) if (p.employeeId === e.id && p.type in pend) pend[p.type] = Number(p.total);
        return {
          ...e,
          balances,
          pending: pend,
          accruedThrough: marks.find((m) => m.employeeId === e.id)?.accruedThrough ?? null,
        };
      }),
    });
  })

  // One person's ledger history (newest first) for the balances screen.
  .get("/ledger/:employeeId", requireRole("manager"), async (c) => {
    const id = z.string().uuid().safeParse(c.req.param("employeeId"));
    if (!id.success) return c.json({ error: "bad_request" }, 400);
    const rows = await getDb()
      .select()
      .from(leaveLedger)
      .where(eq(leaveLedger.employeeId, id.data))
      .orderBy(desc(leaveLedger.createdAt))
      .limit(50);
    return c.json({ entries: rows });
  })

  // Run the accrual engine now (manager+; also cron-callable in P10).
  .post("/accrue", requireRole("manager"), async (c) => {
    const actor = c.get("auth")!.employee;
    const results = await runAccrual(actor.id);
    return c.json({ ok: true, results });
  })

  // Manual balance adjustment (sick leave grants, migration seeds, fixes).
  .post("/adjust", requireRole("manager"), async (c) => {
    const body = z
      .object({
        employeeId: z.string().uuid(),
        type: z.enum(LEDGER_TYPES),
        deltaHours: z.number().refine((n) => n !== 0, "zero_delta"),
        note: z.string().min(3).max(300),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!.employee;

    await getDb().insert(leaveLedger).values({
      employeeId: body.data.employeeId,
      type: body.data.type,
      deltaHours: String(body.data.deltaHours),
      source: "adjustment",
      note: body.data.note,
    });
    await appendAudit({
      entityType: "leave_ledger",
      entityId: body.data.employeeId,
      action: "adjust",
      actorId: actor.id,
      reason: body.data.note,
      newValue: { type: body.data.type, deltaHours: body.data.deltaHours },
    });
    return c.json({ ok: true });
  });
