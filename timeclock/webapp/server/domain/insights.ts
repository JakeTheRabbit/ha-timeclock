import { and, asc, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLog, breaks, employees, rosters, timeEntries } from "@/db/schema";
import { workedMinutes } from "@/server/domain/time/breaks";
import { entryAmountCents } from "@/server/domain/pay/pay";
import { nzDateOf } from "@/server/domain/holidays/stat-pay";

/**
 * The raw slice behind the manager dashboard: every entry starting in
 * [from, to) with worked + break minutes, the rosters for those days, and the
 * latest audit activity. Aggregation happens client-side (lib/insights.ts) so
 * every chart, table and calendar reads the same numbers. Pay figures are
 * only attached when `withPay` (manager+).
 */
export async function insightsSlice(from: Date, to: Date, withPay: boolean) {
  const db = getDb();

  // Stable colour slot per person: creation order over ALL employees, so a
  // person keeps their colour whatever the range or filter (entity, not rank).
  const people = await db.select().from(employees).orderBy(asc(employees.createdAt));

  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(gte(timeEntries.clockIn, from), lt(timeEntries.clockIn, to)))
    .orderBy(asc(timeEntries.clockIn));
  const allBreaks = rows.length
    ? await db.select().from(breaks).where(inArray(breaks.timeEntryId, rows.map((r) => r.id)))
    : [];
  const rateOf = new Map(people.map((p) => [p.id, p.payTracking ? p.hourlyRateCents : null]));

  const entries = rows.map((e) => {
    const bs = allBreaks.filter((b) => b.timeEntryId === e.id);
    const end = e.clockOut ?? new Date();
    const breakMin = (paid: boolean) =>
      Math.round(
        bs
          .filter((b) => b.paid === paid)
          .reduce((a, b) => a + ((b.endAt ?? end).getTime() - b.startAt.getTime()) / 60_000, 0),
      );
    const worked = workedMinutes(e.clockIn, end, bs);
    const rate = rateOf.get(e.employeeId) ?? null;
    return {
      id: e.id,
      employeeId: e.employeeId,
      clockIn: e.clockIn,
      clockOut: e.clockOut,
      workedMinutes: worked,
      paidBreakMinutes: breakMin(true),
      unpaidBreakMinutes: breakMin(false),
      edited: e.edited,
      fraudFlags: e.fraudFlags,
      paid: e.paidAt != null,
      ...(withPay && {
        costCents: e.paidAt != null ? e.paidAmountCents : e.clockOut && rate != null ? entryAmountCents(worked, rate) : null,
      }),
    };
  });

  const roster = await db
    .select({
      employeeId: rosters.employeeId,
      shiftDate: rosters.shiftDate,
      startMin: rosters.startMin,
      endMin: rosters.endMin,
    })
    .from(rosters)
    .where(
      and(
        eq(rosters.cancelled, false),
        gte(rosters.shiftDate, nzDateOf(from)),
        lte(rosters.shiftDate, nzDateOf(new Date(to.getTime() - 1))),
      ),
    );

  const nameOf = new Map(people.map((p) => [p.id, p.displayName]));
  const activity = await db
    .select({
      at: auditLog.createdAt,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      actorId: auditLog.actorId,
      reason: auditLog.reason,
    })
    .from(auditLog)
    .where(and(gte(auditLog.createdAt, from), lt(auditLog.createdAt, to)))
    .orderBy(desc(auditLog.id))
    .limit(60);
  const entryOwner = new Map(rows.map((r) => [r.id, r.employeeId]));

  return {
    employees: people.map((p, i) => ({
      id: p.id,
      displayName: p.displayName,
      active: p.active,
      slot: i % 8,
      ...(withPay && { payTracking: p.payTracking, hourlyRateCents: p.hourlyRateCents }),
    })),
    entries,
    rosters: roster,
    activity: activity
      .filter((a) => withPay || !["mark_paid", "mark_unpaid"].includes(a.action) && a.entityType !== "bonus")
      .map((a) => ({
        at: a.at,
        action: a.action,
        entityType: a.entityType,
        actor: a.actorId ? (nameOf.get(a.actorId) ?? "?") : "system",
        subject: entryOwner.has(a.entityId) ? nameOf.get(entryOwner.get(a.entityId)!) ?? null : null,
        reason: a.reason,
      })),
    withPay,
  };
}
