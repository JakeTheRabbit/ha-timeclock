import { and, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, breaks, leaveLedger, leaveAccrualMarks, employees } from "@/db/schema";
import { workedMinutes } from "@/server/domain/time/breaks";
import { appendAudit } from "@/server/domain/audit/writer";

/**
 * NZ annual leave: 4 weeks per year of service. For hourly staff we accrue
 * continuously at 4/52 of hours actually worked (the common payroll
 * approximation). Runs idempotently: each employee has an accrued-through
 * bookmark; only entries closed after it are accrued.
 */
export const ANNUAL_ACCRUAL_RATE = 4 / 52;

export async function runAccrual(actorId: string | null): Promise<
  { employeeId: string; hoursWorked: number; accruedHours: number }[]
> {
  const db = getDb();
  const results: { employeeId: string; hoursWorked: number; accruedHours: number }[] = [];
  const staff = await db.select().from(employees).where(eq(employees.active, true));
  const now = new Date();

  for (const emp of staff) {
    const mark = await db.query.leaveAccrualMarks.findFirst({
      where: (m, { eq: eq_ }) => eq_(m.employeeId, emp.id),
    });
    const since = mark?.accruedThrough ?? new Date(0);

    const entryRows = await db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.employeeId, emp.id),
          isNotNull(timeEntries.clockOut),
          gt(timeEntries.clockOut, since),
          lte(timeEntries.clockOut, now),
        ),
      );
    if (entryRows.length === 0) continue;

    let workedMin = 0;
    for (const e of entryRows) {
      const bs = await db.query.breaks.findMany({
        where: (b, { eq: eq_ }) => eq_(b.timeEntryId, e.id),
      });
      workedMin += workedMinutes(e.clockIn, e.clockOut!, bs);
    }
    const hoursWorked = workedMin / 60;
    const accruedHours = Math.round(hoursWorked * ANNUAL_ACCRUAL_RATE * 100) / 100;
    if (accruedHours <= 0) continue;

    await db.insert(leaveLedger).values({
      employeeId: emp.id,
      type: "annual",
      deltaHours: String(accruedHours),
      source: "accrual",
      note: `${hoursWorked.toFixed(2)}h worked -> ${accruedHours}h accrued`,
    });
    await db
      .insert(leaveAccrualMarks)
      .values({ employeeId: emp.id, accruedThrough: now })
      .onConflictDoUpdate({
        target: leaveAccrualMarks.employeeId,
        set: { accruedThrough: now },
      });
    await appendAudit({
      entityType: "leave_ledger",
      entityId: emp.id,
      action: "accrual",
      actorId,
      newValue: { hoursWorked, accruedHours },
    });
    results.push({ employeeId: emp.id, hoursWorked, accruedHours });
  }
  return results;
}

/** Balances per leave type for one employee (sum of ledger deltas). */
export async function leaveBalances(employeeId: string): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({
      type: leaveLedger.type,
      total: sql<string>`coalesce(sum(${leaveLedger.deltaHours}), 0)`,
    })
    .from(leaveLedger)
    .where(eq(leaveLedger.employeeId, employeeId))
    .groupBy(leaveLedger.type);
  const out: Record<string, number> = { annual: 0, sick: 0, bereavement: 0, alt_holiday: 0 };
  for (const r of rows) out[r.type] = Number(r.total);
  return out;
}
