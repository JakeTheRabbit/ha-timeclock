import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bonuses, breaks, employees, timeEntries, type Employee } from "@/db/schema";
import { appendAudit } from "@/server/domain/audit/writer";
import { workedMinutes } from "@/server/domain/time/breaks";

/** Straight-time pay for a closed entry: worked minutes × hourly rate. */
export function entryAmountCents(workedMin: number, rateCents: number): number {
  return Math.round((workedMin * rateCents) / 60);
}

export class PayError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/**
 * One person's pay picture for a range: each entry with hours, amount (the
 * snapshot if paid, else hours × current rate) and paid state; their bonuses
 * (voided ones included, excluded from totals); and owed/paid totals.
 */
export async function paySummary(employee: Employee, from: Date, to: Date) {
  const db = getDb();
  const rate = employee.hourlyRateCents;
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.employeeId, employee.id), gte(timeEntries.clockIn, from), lt(timeEntries.clockIn, to)))
    .orderBy(desc(timeEntries.clockIn));
  const allBreaks = rows.length
    ? await db.select().from(breaks).where(inArray(breaks.timeEntryId, rows.map((r) => r.id)))
    : [];

  const entries = rows.map((e) => {
    const worked = e.clockOut
      ? workedMinutes(e.clockIn, e.clockOut, allBreaks.filter((b) => b.timeEntryId === e.id))
      : null;
    const amountCents =
      e.paidAt != null ? e.paidAmountCents : worked != null && rate != null ? entryAmountCents(worked, rate) : null;
    return {
      id: e.id,
      clockIn: e.clockIn,
      clockOut: e.clockOut,
      workedMinutes: worked,
      edited: e.edited,
      fraudFlags: e.fraudFlags,
      paidAt: e.paidAt,
      paidRateCents: e.paidRateCents,
      amountCents,
    };
  });

  const bonusRows = await db
    .select()
    .from(bonuses)
    .where(eq(bonuses.employeeId, employee.id))
    .orderBy(desc(bonuses.awardedOn), desc(bonuses.createdAt))
    .limit(100);

  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
  const live = bonusRows.filter((b) => !b.voidedAt);
  const closed = entries.filter((e) => e.clockOut);
  return {
    employee: {
      id: employee.id,
      displayName: employee.displayName,
      hourlyRateCents: rate,
      payTracking: employee.payTracking,
    },
    entries,
    bonuses: bonusRows,
    totals: {
      unpaidCents:
        sum(closed.filter((e) => !e.paidAt).map((e) => e.amountCents)) +
        sum(live.filter((b) => !b.paidAt).map((b) => b.amountCents)),
      paidCents:
        sum(closed.filter((e) => e.paidAt).map((e) => e.amountCents)) +
        sum(live.filter((b) => b.paidAt).map((b) => b.amountCents)),
      unpaidMinutes: sum(closed.filter((e) => !e.paidAt).map((e) => e.workedMinutes)),
    },
  };
}

/**
 * Mark entries and/or bonuses paid (snapshotting rate + amount on entries) or
 * back to unpaid. Only closed entries of pay-tracked staff with a rate set;
 * every change is audited. Returns how many rows changed.
 */
export async function markPaid(input: {
  entryIds: string[];
  bonusIds: string[];
  paid: boolean;
  actorId: string;
  note?: string;
}): Promise<{ entries: number; bonuses: number }> {
  const db = getDb();
  const now = new Date();
  let entryCount = 0;
  let bonusCount = 0;

  if (input.entryIds.length) {
    const rows = await db.select().from(timeEntries).where(inArray(timeEntries.id, input.entryIds));
    if (rows.length !== input.entryIds.length) throw new PayError("entry_not_found");
    const people = await db
      .select()
      .from(employees)
      .where(inArray(employees.id, [...new Set(rows.map((r) => r.employeeId))]));
    const byId = new Map(people.map((p) => [p.id, p]));
    const allBreaks = await db.select().from(breaks).where(inArray(breaks.timeEntryId, input.entryIds));

    for (const e of rows) {
      const emp = byId.get(e.employeeId)!;
      if (!emp.payTracking) throw new PayError("pay_tracking_off");
      if (!e.clockOut) throw new PayError("entry_still_open");
      if (input.paid === (e.paidAt != null)) continue; // already in that state
      if (input.paid) {
        if (emp.hourlyRateCents == null) throw new PayError("no_hourly_rate");
        const worked = workedMinutes(e.clockIn, e.clockOut, allBreaks.filter((b) => b.timeEntryId === e.id));
        const amount = entryAmountCents(worked, emp.hourlyRateCents);
        await db
          .update(timeEntries)
          .set({ paidAt: now, paidBy: input.actorId, paidRateCents: emp.hourlyRateCents, paidAmountCents: amount })
          .where(eq(timeEntries.id, e.id));
        await appendAudit({
          entityType: "time_entry",
          entityId: e.id,
          action: "mark_paid",
          actorId: input.actorId,
          reason: input.note ?? null,
          newValue: { workedMinutes: worked, rateCents: emp.hourlyRateCents, amountCents: amount },
        });
      } else {
        await db
          .update(timeEntries)
          .set({ paidAt: null, paidBy: null, paidRateCents: null, paidAmountCents: null })
          .where(eq(timeEntries.id, e.id));
        await appendAudit({
          entityType: "time_entry",
          entityId: e.id,
          action: "mark_unpaid",
          actorId: input.actorId,
          reason: input.note ?? null,
          oldValue: { paidAt: e.paidAt!.toISOString(), rateCents: e.paidRateCents, amountCents: e.paidAmountCents },
        });
      }
      entryCount++;
    }
  }

  if (input.bonusIds.length) {
    const rows = await db.select().from(bonuses).where(inArray(bonuses.id, input.bonusIds));
    if (rows.length !== input.bonusIds.length) throw new PayError("bonus_not_found");
    for (const b of rows) {
      if (b.voidedAt) throw new PayError("bonus_voided");
      if (input.paid === (b.paidAt != null)) continue;
      await db
        .update(bonuses)
        .set(input.paid ? { paidAt: now, paidBy: input.actorId } : { paidAt: null, paidBy: null })
        .where(eq(bonuses.id, b.id));
      await appendAudit({
        entityType: "bonus",
        entityId: b.id,
        action: input.paid ? "mark_paid" : "mark_unpaid",
        actorId: input.actorId,
        reason: input.note ?? null,
        newValue: { amountCents: b.amountCents },
      });
      bonusCount++;
    }
  }
  return { entries: entryCount, bonuses: bonusCount };
}
