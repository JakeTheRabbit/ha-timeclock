import { and, eq, inArray, ne, isNull, gt, lt, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  dayApprovals,
  modifications,
  timeEntries,
  type Break,
  type ModificationKind,
  type TimeEntry,
} from "@/db/schema";
import { nzDateOf } from "@/server/domain/holidays/stat-pay";

// Day review (0.10.0). Staff may change ANY of their own days — times, breaks,
// extra start/finish pairs, whole missed shifts — until a manager approves
// that day. After approval only a manager (or an approved correction) can
// change it. Each staff change is recorded as a modification for a manager
// to acknowledge or dispute.

/** Facility-local calendar day (YYYY-MM-DD) a shift belongs to: its start. */
export function dayOf(at: Date): string {
  return nzDateOf(at);
}

/** Set of "employeeId|YYYY-MM-DD" keys that are approved. */
export async function approvedDayKeys(employeeIds: string[], days?: string[]): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const conds = [inArray(dayApprovals.employeeId, employeeIds)];
  if (days) {
    if (days.length === 0) return new Set();
    conds.push(inArray(dayApprovals.day, days));
  }
  const rows = await getDb()
    .select({ employeeId: dayApprovals.employeeId, day: dayApprovals.day })
    .from(dayApprovals)
    .where(and(...conds));
  return new Set(rows.map((r) => `${r.employeeId}|${r.day}`));
}

export async function isDayApproved(employeeId: string, day: string): Promise<boolean> {
  return (await approvedDayKeys([employeeId], [day])).size > 0;
}

/**
 * A person can only be in one place at a time: the span [clockIn, clockOut)
 * must not overlap another of their entries. An open entry runs to "now".
 * Returns true when it overlaps.
 */
export async function overlapsOtherEntry(
  employeeId: string,
  clockIn: Date,
  clockOut: Date | null,
  excludeEntryId?: string,
): Promise<boolean> {
  const conds = [
    eq(timeEntries.employeeId, employeeId),
    or(isNull(timeEntries.clockOut), gt(timeEntries.clockOut, clockIn))!,
  ];
  if (clockOut) conds.push(lt(timeEntries.clockIn, clockOut)); // open = unbounded
  if (excludeEntryId) conds.push(ne(timeEntries.id, excludeEntryId));
  const hit = await getDb()
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(...conds))
    .limit(1);
  return hit.length > 0;
}

/** True when two breaks of one shift overlap. */
export function breaksOverlap(list: { id?: string | null; startAt: Date; endAt: Date | null }[]): boolean {
  const sorted = [...list].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].endAt ?? new Date(8.64e15);
    if (sorted[i].startAt < prevEnd) return true;
  }
  return false;
}

export const entryView = (e: TimeEntry) => ({
  clockIn: e.clockIn.toISOString(),
  clockOut: e.clockOut?.toISOString() ?? null,
  note: e.note,
  jobId: e.jobId,
});

export const breakView = (b: Break) => ({
  timeEntryId: b.timeEntryId,
  startAt: b.startAt.toISOString(),
  endAt: b.endAt?.toISOString() ?? null,
  paid: b.paid,
});

/** Log one staff self-edit for manager review. */
export async function recordModification(input: {
  employeeId: string;
  actorId: string;
  day: string;
  timeEntryId: string | null;
  kind: ModificationKind;
  before: unknown;
  after: unknown;
  reason: string;
}) {
  const [row] = await getDb()
    .insert(modifications)
    .values({
      employeeId: input.employeeId,
      actorId: input.actorId,
      day: input.day,
      timeEntryId: input.timeEntryId,
      kind: input.kind,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason,
    })
    .returning();
  return row;
}
