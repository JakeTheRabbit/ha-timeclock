import { Hono } from "hono";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { leaveRequests, leaveLedger, employees } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { runAccrual, leaveBalances } from "@/server/domain/leave/accrual";

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
    if (body.data.type !== "unpaid") {
      const balances = await leaveBalances(me.id);
      if ((balances[body.data.type] ?? 0) < body.data.hours) {
        return c.json(
          { error: "insufficient_balance", available: balances[body.data.type] ?? 0 },
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

  .get("/pending", requireRole("lead"), async (c) => {
    const rows = await getDb()
      .select({ request: leaveRequests, employeeName: employees.displayName })
      .from(leaveRequests)
      .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
      .where(eq(leaveRequests.status, "pending"))
      .orderBy(leaveRequests.createdAt);
    return c.json({ requests: rows.map((r) => ({ ...r.request, employeeName: r.employeeName })) });
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
    return c.json({ ok: true });
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
