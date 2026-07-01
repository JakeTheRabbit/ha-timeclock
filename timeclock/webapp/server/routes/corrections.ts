import { Hono } from "hono";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { corrections, employees } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { applyEntryEdit, EditError } from "@/server/domain/time/edit";
import { EditGuardError } from "@/server/domain/payperiod/errors";

const requestSchema = z.object({
  timeEntryId: z.string().uuid(),
  requested: z
    .object({
      clockIn: z.string().datetime({ offset: true }).optional(),
      clockOut: z.string().datetime({ offset: true }).optional(),
      note: z.string().max(500).optional(),
    })
    .refine((r) => r.clockIn || r.clockOut || r.note !== undefined, { message: "empty" }),
  reason: z.string().min(3).max(500),
});

const reviewSchema = z.object({ note: z.string().max(500).optional() });

export const correctionsRoute = new Hono<AppEnv>()
  .use(requireRole("employee"))

  // Employee requests a correction on their own entry.
  .post("/", async (c) => {
    const body = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const me = c.get("auth")!.employee;
    const db = getDb();

    const entry = await db.query.timeEntries.findFirst({
      where: (t, { eq: eq_ }) => eq_(t.id, body.data.timeEntryId),
    });
    if (!entry) return c.json({ error: "entry_not_found" }, 404);
    if (entry.employeeId !== me.id) return c.json({ error: "not_your_entry" }, 403);

    const [row] = await db
      .insert(corrections)
      .values({
        timeEntryId: entry.id,
        employeeId: me.id,
        requested: body.data.requested,
        reason: body.data.reason,
      })
      .returning();

    await appendAudit({
      entityType: "correction",
      entityId: row.id,
      action: "request",
      actorId: me.id,
      reason: body.data.reason,
      newValue: { timeEntryId: entry.id, requested: body.data.requested },
    });
    return c.json({ ok: true, correctionId: row.id }, 201);
  })

  .get("/mine", async (c) => {
    const me = c.get("auth")!.employee;
    const rows = await getDb()
      .select()
      .from(corrections)
      .where(eq(corrections.employeeId, me.id))
      .orderBy(desc(corrections.createdAt));
    return c.json({ corrections: rows });
  })

  // ---- Review queue (lead and above) ----
  .get("/pending", requireRole("lead"), async (c) => {
    const rows = await getDb()
      .select({
        correction: corrections,
        employeeName: employees.displayName,
      })
      .from(corrections)
      .innerJoin(employees, eq(corrections.employeeId, employees.id))
      .where(eq(corrections.status, "pending"))
      .orderBy(corrections.createdAt);
    return c.json({ corrections: rows.map((r) => ({ ...r.correction, employeeName: r.employeeName })) });
  })

  .post("/:id/approve", requireRole("lead"), async (c) => {
    const id = c.req.param("id")!; // param inference lost when middleware precedes handler
    const body = reviewSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const reviewer = c.get("auth")!.employee;
    const db = getDb();

    const row = await db.query.corrections.findFirst({
      where: (x, { eq: eq_, and: and_ }) => and_(eq_(x.id, id), eq_(x.status, "pending")),
    });
    if (!row) return c.json({ error: "not_found_or_reviewed" }, 404);

    const entry = await db.query.timeEntries.findFirst({
      where: (t, { eq: eq_ }) => eq_(t.id, row.timeEntryId),
    });
    if (!entry) return c.json({ error: "entry_missing" }, 500);

    try {
      await applyEntryEdit({
        entry,
        edit: {
          ...(row.requested.clockIn && { clockIn: new Date(row.requested.clockIn) }),
          ...(row.requested.clockOut && { clockOut: new Date(row.requested.clockOut) }),
          ...(row.requested.note !== undefined && { note: row.requested.note }),
        },
        actorId: reviewer.id,
        reason: `correction approved: ${row.reason}`,
        source: "correction_approved",
      });
    } catch (e) {
      if (e instanceof EditGuardError) return c.json({ error: e.code }, 423);
      if (e instanceof EditError) return c.json({ error: e.code }, 400);
      throw e;
    }

    await db
      .update(corrections)
      .set({
        status: "approved",
        reviewerId: reviewer.id,
        reviewedAt: new Date(),
        reviewNote: body.data.note ?? null,
      })
      .where(eq(corrections.id, row.id));

    await appendAudit({
      entityType: "correction",
      entityId: row.id,
      action: "approve",
      actorId: reviewer.id,
      reason: body.data.note ?? null,
      newValue: { timeEntryId: row.timeEntryId },
    });
    return c.json({ ok: true });
  })

  .post("/:id/reject", requireRole("lead"), async (c) => {
    const id = c.req.param("id")!; // param inference lost when middleware precedes handler
    const body = reviewSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "bad_request" }, 400);
    const reviewer = c.get("auth")!.employee;
    const db = getDb();

    const row = await db.query.corrections.findFirst({
      where: (x, { eq: eq_, and: and_ }) => and_(eq_(x.id, id), eq_(x.status, "pending")),
    });
    if (!row) return c.json({ error: "not_found_or_reviewed" }, 404);

    await db
      .update(corrections)
      .set({
        status: "rejected",
        reviewerId: reviewer.id,
        reviewedAt: new Date(),
        reviewNote: body.data.note ?? null,
      })
      .where(eq(corrections.id, row.id));

    await appendAudit({
      entityType: "correction",
      entityId: row.id,
      action: "reject",
      actorId: reviewer.id,
      reason: body.data.note ?? null,
    });
    return c.json({ ok: true });
  });
