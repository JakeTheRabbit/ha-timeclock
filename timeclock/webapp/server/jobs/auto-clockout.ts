import { and, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, breaks, employees } from "@/db/schema";
import { getSettings } from "@/server/domain/settings";
import { appendAudit } from "@/server/domain/audit/writer";
import { notify } from "@/server/integrations/notify";

/**
 * Safety net: force-close entries left open past maxShiftHours. The closed
 * entry is flagged (edited + audit action auto_clockout) so payroll reviews it,
 * and a notification goes out so the employee can request a correction.
 */
export async function runAutoClockout(now = new Date()): Promise<number> {
  const settings = await getSettings();
  if (!settings.autoClockout.enabled) return 0;
  const db = getDb();

  const cutoff = new Date(now.getTime() - settings.autoClockout.maxShiftHours * 3600_000);
  const stale = await db
    .select({
      entry: timeEntries,
      employeeName: employees.displayName,
    })
    .from(timeEntries)
    .innerJoin(employees, eq(timeEntries.employeeId, employees.id))
    .where(and(isNull(timeEntries.clockOut), lt(timeEntries.clockIn, cutoff)));

  for (const { entry, employeeName } of stale) {
    // Close any open break at the same moment.
    await db
      .update(breaks)
      .set({ endAt: now })
      .where(and(eq(breaks.timeEntryId, entry.id), isNull(breaks.endAt)));

    await db
      .update(timeEntries)
      .set({ clockOut: now, edited: true, updatedAt: now })
      .where(eq(timeEntries.id, entry.id));

    await appendAudit({
      entityType: "time_entry",
      entityId: entry.id,
      action: "auto_clockout",
      actorId: null,
      reason: `open past ${settings.autoClockout.maxShiftHours}h safety limit`,
      oldValue: { clockOut: null },
      newValue: { clockOut: now.toISOString() },
    });

    await notify({
      title: "Time clock: auto clock-out",
      message: `${employeeName} was auto-clocked-out after ${settings.autoClockout.maxShiftHours}h (clocked in ${entry.clockIn.toISOString()}). If this is wrong, fix the times in My Hours.`,
    });
  }
  return stale.length;
}
