import { Hono } from "hono";
import { z } from "zod";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { rosters, timeEntries, employees } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { compareShift, nzWallToInstant } from "@/server/domain/roster/compare";

const dateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const createSchema = z.object({
  employeeId: z.string().uuid(),
  shiftDate: dateISO,
  startMin: z.number().int().min(0).max(1439),
  endMin: z.number().int().min(1).max(1440),
  jobId: z.string().uuid().nullish(),
  note: z.string().max(300).nullish(),
}).refine((v) => v.endMin > v.startMin, { message: "end_before_start" });

export const roster = new Hono<AppEnv>()
  .use(requireRole("employee"))

  // My rostered shifts in a date range.
  .get("/mine", async (c) => {
    const q = z
      .object({ from: dateISO, to: dateISO })
      .safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const me = c.get("auth")!.employee;

    const rows = await getDb()
      .select()
      .from(rosters)
      .where(
        and(
          eq(rosters.employeeId, me.id),
          eq(rosters.cancelled, false),
          gte(rosters.shiftDate, q.data.from),
          lte(rosters.shiftDate, q.data.to),
        ),
      )
      .orderBy(rosters.shiftDate, rosters.startMin);
    return c.json({ shifts: rows });
  })

  // ---- Lead+ : build the roster ----
  .post("/", requireRole("lead"), async (c) => {
    const body = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "bad_request", detail: body.error.flatten() }, 400);
    const actor = c.get("auth")!.employee;

    const [row] = await getDb().insert(rosters).values({
      employeeId: body.data.employeeId,
      shiftDate: body.data.shiftDate,
      startMin: body.data.startMin,
      endMin: body.data.endMin,
      jobId: body.data.jobId ?? null,
      note: body.data.note ?? null,
      createdBy: actor.id,
    }).returning();

    await appendAudit({
      entityType: "roster",
      entityId: row.id,
      action: "create",
      actorId: actor.id,
      newValue: {
        employeeId: row.employeeId,
        shiftDate: row.shiftDate,
        startMin: row.startMin,
        endMin: row.endMin,
      },
    });
    return c.json({ shift: row }, 201);
  })

  .post("/:id/cancel", requireRole("lead"), async (c) => {
    const id = c.req.param("id")!;
    const actor = c.get("auth")!.employee;
    const db = getDb();
    const row = await db.query.rosters.findFirst({ where: (r, { eq: eq_ }) => eq_(r.id, id) });
    if (!row || row.cancelled) return c.json({ error: "not_found" }, 404);

    await db.update(rosters).set({ cancelled: true }).where(eq(rosters.id, id));
    await appendAudit({
      entityType: "roster",
      entityId: id,
      action: "cancel",
      actorId: actor.id,
      oldValue: { cancelled: false },
      newValue: { cancelled: true },
    });
    return c.json({ ok: true });
  })

  // All shifts in range (lead+), for the roster builder grid.
  .get("/", requireRole("lead"), async (c) => {
    const q = z
      .object({ from: dateISO, to: dateISO })
      .safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!q.success) return c.json({ error: "bad_request" }, 400);

    const rows = await getDb()
      .select({ roster: rosters, employeeName: employees.displayName })
      .from(rosters)
      .innerJoin(employees, eq(rosters.employeeId, employees.id))
      .where(
        and(
          eq(rosters.cancelled, false),
          gte(rosters.shiftDate, q.data.from),
          lte(rosters.shiftDate, q.data.to),
        ),
      )
      .orderBy(rosters.shiftDate, rosters.startMin);
    return c.json({ shifts: rows.map((r) => ({ ...r.roster, employeeName: r.employeeName })) });
  })

  // Scheduled-vs-actual for one day (lead+): late / no-show / in-progress / ok.
  .get("/compare", requireRole("lead"), async (c) => {
    const q = z.object({ date: dateISO }).safeParse({ date: c.req.query("date") });
    if (!q.success) return c.json({ error: "bad_request" }, 400);
    const db = getDb();

    const dayShifts = await db
      .select({ roster: rosters, employeeName: employees.displayName })
      .from(rosters)
      .innerJoin(employees, eq(rosters.employeeId, employees.id))
      .where(and(eq(rosters.shiftDate, q.data.date), eq(rosters.cancelled, false)));

    if (dayShifts.length === 0) return c.json({ date: q.data.date, shifts: [] });

    // Entries overlapping the day (±1 day window covers overnight shifts).
    const dayStart = nzWallToInstant(q.data.date, 0);
    const windowFrom = new Date(dayStart.getTime() - 24 * 3600_000);
    const windowTo = new Date(dayStart.getTime() + 48 * 3600_000);
    const empIds = [...new Set(dayShifts.map((s) => s.roster.employeeId))];
    const dayEntries = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          inArray(timeEntries.employeeId, empIds),
          gte(timeEntries.clockIn, windowFrom),
          lte(timeEntries.clockIn, windowTo),
        ),
      );

    const now = new Date();
    const shifts = dayShifts.map((s) => ({
      ...compareShift(
        s.roster,
        dayEntries.filter((e) => e.employeeId === s.roster.employeeId),
        now,
      ),
      employeeName: s.employeeName,
      startMin: s.roster.startMin,
      endMin: s.roster.endMin,
    }));
    return c.json({ date: q.data.date, shifts });
  });
