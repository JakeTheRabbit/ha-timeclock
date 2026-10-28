import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bonuses, employees } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { markPaid, paySummary, PayError } from "@/server/domain/pay/pay";

// Pay figures are manager+ (leads run the floor, they don't see rates).
export const pay = new Hono<AppEnv>()
  .use(requireRole("manager"))

  // People with pay tracking on, for the Pay screen picker.
  .get("/employees", async (c) => {
    const rows = await getDb()
      .select({
        id: employees.id,
        displayName: employees.displayName,
        hourlyRateCents: employees.hourlyRateCents,
      })
      .from(employees)
      .where(eq(employees.payTracking, true))
      .orderBy(employees.displayName);
    return c.json({ employees: rows });
  })

  .get("/:employeeId", async (c) => {
    const q = z
      .object({ from: z.coerce.date(), to: z.coerce.date() })
      .safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const emp = await getDb().query.employees.findFirst({
      where: (e, { eq: eq_ }) => eq_(e.id, c.req.param("employeeId")),
    });
    if (!emp) return c.json({ error: "not_found" }, 404);
    if (!emp.payTracking) return c.json({ error: "pay_tracking_off" }, 409);
    return c.json(await paySummary(emp, q.data.from, q.data.to));
  })

  // Mark entries and/or bonuses paid or unpaid.
  .post("/mark", async (c) => {
    const body = z
      .object({
        entryIds: z.array(z.string().uuid()).max(500).default([]),
        bonusIds: z.array(z.string().uuid()).max(500).default([]),
        paid: z.boolean(),
        note: z.string().max(300).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    try {
      const changed = await markPaid({ ...body.data, actorId: c.get("auth")!.employee.id });
      return c.json({ ok: true, changed });
    } catch (e) {
      if (e instanceof PayError) return c.json({ error: e.code }, 409);
      throw e;
    }
  })

  .post("/bonuses", async (c) => {
    const body = z
      .object({
        employeeId: z.string().uuid(),
        amountCents: z.number().int().positive().max(100_000_000),
        reason: z.string().min(3).max(300),
        awardedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const actor = c.get("auth")!.employee;
    const emp = await getDb().query.employees.findFirst({
      where: (e, { eq: eq_ }) => eq_(e.id, body.data.employeeId),
    });
    if (!emp) return c.json({ error: "not_found" }, 404);
    if (!emp.payTracking) return c.json({ error: "pay_tracking_off" }, 409);

    const [row] = await getDb()
      .insert(bonuses)
      .values({ ...body.data, createdBy: actor.id })
      .returning();
    await appendAudit({
      entityType: "bonus",
      entityId: row.id,
      action: "create",
      actorId: actor.id,
      reason: row.reason,
      newValue: { employeeId: row.employeeId, amountCents: row.amountCents, awardedOn: row.awardedOn },
    });
    return c.json({ ok: true, bonusId: row.id }, 201);
  })

  // Bonuses are never deleted — a wrong one is voided with a reason.
  .post("/bonuses/:id/void", async (c) => {
    const body = z.object({ reason: z.string().min(3).max(300) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "reason_required" }, 400);
    const actor = c.get("auth")!.employee;
    const db = getDb();
    const b = await db.query.bonuses.findFirst({ where: (x, { eq: eq_ }) => eq_(x.id, c.req.param("id")) });
    if (!b) return c.json({ error: "not_found" }, 404);
    if (b.voidedAt) return c.json({ error: "already_voided" }, 409);
    if (b.paidAt) return c.json({ error: "bonus_paid" }, 409);

    await db
      .update(bonuses)
      .set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: body.data.reason })
      .where(eq(bonuses.id, b.id));
    await appendAudit({
      entityType: "bonus",
      entityId: b.id,
      action: "void",
      actorId: actor.id,
      reason: body.data.reason,
      oldValue: { amountCents: b.amountCents, reason: b.reason },
    });
    return c.json({ ok: true });
  });
