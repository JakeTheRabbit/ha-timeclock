import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { breaks, timeEntries, type Break, type ModificationKind, type TimeEntry } from "@/db/schema";
import { appendAudit } from "@/server/domain/audit/writer";
import { assertEntryEditable } from "@/server/domain/payperiod/guard";
import { findPeriodContaining } from "@/server/domain/payperiod/periods";
import { EditGuardError } from "@/server/domain/payperiod/errors";
import { doorAccessFlag, withDoorFlag } from "@/server/domain/antifraud/door-access";
import {
  breaksOverlap,
  breakView,
  dayOf,
  entryView,
  overlapsOtherEntry,
  recordModification,
} from "./day-review";

export interface EntryEdit {
  clockIn?: Date;
  clockOut?: Date | null;
  note?: string | null;
  jobId?: string | null;
}

export type EditSource = "self_edit" | "manager_edit" | "correction_approved";

// Small allowance for device clock skew on "now"-ish edits.
const FUTURE_SKEW_MS = 60_000;

/** Staff self-edits go on the manager's modifications list. */
async function logIfSelf(
  source: EditSource,
  m: {
    employeeId: string;
    actorId: string;
    day: string;
    timeEntryId: string | null;
    kind: ModificationKind;
    before: unknown;
    after: unknown;
    reason: string;
  },
) {
  if (source === "self_edit") await recordModification(m);
}

async function doorFlags(employeeId: string, at: Date, current: string[]): Promise<string[]> {
  const emp = await getDb().query.employees.findFirst({
    where: (e, { eq: eq_ }) => eq_(e.id, employeeId),
  });
  return withDoorFlag(current, await doorAccessFlag(emp?.accessEntities ?? [], at));
}

function assertTimes(clockIn: Date, clockOut: Date | null) {
  const limit = Date.now() + FUTURE_SKEW_MS;
  if (clockIn.getTime() > limit) throw new EditError("clock_in_in_future");
  if (clockOut && clockOut.getTime() > limit) throw new EditError("clock_out_in_future");
  if (clockOut && clockOut <= clockIn) throw new EditError("clock_out_before_in");
}

/**
 * THE single mutation path for changing a time entry after the fact — used by
 * self-edits, manager edits and approved corrections. Writes the new value,
 * marks the entry `edited` (manager reports flag it), re-runs the door-access
 * check when the start time moves, and appends the mandatory audit row
 * (old -> new + reason). Shifts of one person may not overlap.
 */
export async function applyEntryEdit(input: {
  entry: TimeEntry;
  edit: EntryEdit;
  actorId: string;
  reason: string;
  source: EditSource;
}): Promise<TimeEntry> {
  const { entry, edit } = input;
  await assertEntryEditable(entry);
  if (edit.clockIn) await assertInstantEditable(edit.clockIn);

  const newIn = edit.clockIn ?? entry.clockIn;
  const newOut = edit.clockOut === undefined ? entry.clockOut : edit.clockOut;
  if (edit.clockIn || edit.clockOut !== undefined) {
    const limit = Date.now() + FUTURE_SKEW_MS;
    if (edit.clockIn && edit.clockIn.getTime() > limit) throw new EditError("clock_in_in_future");
    if (edit.clockOut && edit.clockOut.getTime() > limit) throw new EditError("clock_out_in_future");
    if (newOut && newOut <= newIn) throw new EditError("clock_out_before_in");
    if (await overlapsOtherEntry(entry.employeeId, newIn, newOut, entry.id)) throw new EditError("overlaps_other_entry");
    // Breaks must still sit inside the (possibly shorter) shift.
    const bs = await getDb().query.breaks.findMany({ where: (b, { eq: eq_ }) => eq_(b.timeEntryId, entry.id) });
    const shiftEnd = newOut ?? new Date(Date.now() + FUTURE_SKEW_MS);
    if (bs.some((b) => b.startAt < newIn || (b.endAt ?? b.startAt) > shiftEnd)) throw new EditError("break_outside_shift");
  }

  // A moved start time must still line up with a card swipe.
  let fraudFlags: string[] | undefined;
  if (edit.clockIn && edit.clockIn.getTime() !== entry.clockIn.getTime()) {
    fraudFlags = await doorFlags(entry.employeeId, edit.clockIn, entry.fraudFlags);
  }

  const [after] = await getDb()
    .update(timeEntries)
    .set({
      ...(edit.clockIn && { clockIn: edit.clockIn }),
      ...(edit.clockOut !== undefined && { clockOut: edit.clockOut }),
      ...(edit.note !== undefined && { note: edit.note }),
      ...(edit.jobId !== undefined && { jobId: edit.jobId }),
      ...(fraudFlags && { fraudFlags }),
      edited: true,
      updatedAt: new Date(),
    })
    .where(eq(timeEntries.id, entry.id))
    .returning();

  await appendAudit({
    entityType: "time_entry",
    entityId: entry.id,
    action: input.source,
    actorId: input.actorId,
    reason: input.reason,
    oldValue: entryView(entry),
    newValue: { ...entryView(after), ...(fraudFlags && { fraudFlags }) },
  });
  await logIfSelf(input.source, {
    employeeId: entry.employeeId,
    actorId: input.actorId,
    day: dayOf(after.clockIn),
    timeEntryId: entry.id,
    kind: "entry_edit",
    before: entryView(entry),
    after: entryView(after),
    reason: input.reason,
  });
  return after;
}

/** Throws when `at` falls in a signed-off (locked) pay period. */
async function assertInstantEditable(at: Date) {
  const period = await findPeriodContaining(at);
  if (period?.lockedAt) throw new EditGuardError("pay_period_locked");
}

/**
 * Add a time entry after the fact: a forgotten clock-in, or a second
 * start/finish pair on a day the person left site and came back. A missing
 * clock-out makes it an open (still working) shift — only one may be open.
 */
export async function applyEntryCreate(input: {
  employeeId: string;
  clockIn: Date;
  clockOut: Date | null;
  note?: string | null;
  jobId?: string | null;
  actorId: string;
  reason: string;
  source: EditSource;
}): Promise<TimeEntry> {
  await assertInstantEditable(input.clockIn);
  assertTimes(input.clockIn, input.clockOut);
  if (await overlapsOtherEntry(input.employeeId, input.clockIn, input.clockOut)) {
    throw new EditError(input.clockOut ? "overlaps_other_entry" : "already_clocked_in");
  }
  const fraudFlags = await doorFlags(input.employeeId, input.clockIn, []);

  const [row] = await getDb()
    .insert(timeEntries)
    .values({
      employeeId: input.employeeId,
      clockIn: input.clockIn,
      clockOut: input.clockOut,
      note: input.note ?? null,
      jobId: input.jobId ?? null,
      fraudFlags,
      edited: true,
    })
    .returning();

  await appendAudit({
    entityType: "time_entry",
    entityId: row.id,
    action: `${input.source}_add`,
    actorId: input.actorId,
    reason: input.reason,
    oldValue: null,
    newValue: { employeeId: row.employeeId, ...entryView(row), fraudFlags },
  });
  await logIfSelf(input.source, {
    employeeId: row.employeeId,
    actorId: input.actorId,
    day: dayOf(row.clockIn),
    timeEntryId: row.id,
    kind: "entry_add",
    before: null,
    after: entryView(row),
    reason: input.reason,
  });
  return row;
}

/**
 * Remove a time entry (and its breaks). Paid entries can't be removed — unmark
 * them first. The full entry + breaks are kept in the audit log.
 */
export async function applyEntryRemove(input: {
  entry: TimeEntry;
  actorId: string;
  reason: string;
  source: EditSource;
}): Promise<void> {
  const { entry } = input;
  await assertEntryEditable(entry);
  if (entry.paidAt) throw new EditError("entry_paid");
  const db = getDb();
  const bs = await db.query.breaks.findMany({ where: (b, { eq: eq_ }) => eq_(b.timeEntryId, entry.id) });
  await db.delete(timeEntries).where(eq(timeEntries.id, entry.id)); // breaks cascade

  const before = { ...entryView(entry), breaks: bs.map(breakView) };
  await appendAudit({
    entityType: "time_entry",
    entityId: entry.id,
    action: `${input.source}_remove`,
    actorId: input.actorId,
    reason: input.reason,
    oldValue: { employeeId: entry.employeeId, ...before, fraudFlags: entry.fraudFlags },
    newValue: null,
  });
  await logIfSelf(input.source, {
    employeeId: entry.employeeId,
    actorId: input.actorId,
    day: dayOf(entry.clockIn),
    timeEntryId: entry.id,
    kind: "entry_remove",
    before,
    after: null,
    reason: input.reason,
  });
}

export interface BreakEdit {
  startAt?: Date;
  endAt?: Date | null;
  paid?: boolean;
}

/**
 * Edit an existing break, or add a missed one (`brk` null). The break must sit
 * inside its shift (an open shift runs to "now") and not overlap another
 * break. Same audit + lock rules as entry edits; the parent entry is flagged
 * `edited`.
 */
export async function applyBreakEdit(input: {
  entry: TimeEntry;
  brk: Break | null;
  edit: BreakEdit;
  actorId: string;
  reason: string;
  source: EditSource;
}): Promise<Break> {
  const { entry, brk, edit } = input;
  await assertEntryEditable(entry);

  const startAt = edit.startAt ?? brk?.startAt;
  const endAt = edit.endAt === undefined ? (brk?.endAt ?? null) : edit.endAt;
  if (!startAt) throw new EditError("break_start_required");
  if (!brk && !endAt) throw new EditError("break_end_required");
  const shiftEnd = entry.clockOut ?? new Date(Date.now() + FUTURE_SKEW_MS);
  if (startAt < entry.clockIn || (endAt ?? startAt) > shiftEnd) throw new EditError("break_outside_shift");
  if (endAt && endAt <= startAt) throw new EditError("break_end_before_start");

  const db = getDb();
  const others = await db.query.breaks.findMany({ where: (b, { eq: eq_ }) => eq_(b.timeEntryId, entry.id) });
  if (breaksOverlap([...others.filter((o) => o.id !== brk?.id), { startAt, endAt }])) {
    throw new EditError("breaks_overlap");
  }

  const values = { startAt, endAt, paid: edit.paid ?? brk?.paid ?? false, autoDeducted: false };
  const [after] = brk
    ? await db.update(breaks).set(values).where(eq(breaks.id, brk.id)).returning()
    : await db.insert(breaks).values({ timeEntryId: entry.id, ...values }).returning();
  await db.update(timeEntries).set({ edited: true, updatedAt: new Date() }).where(eq(timeEntries.id, entry.id));

  await appendAudit({
    entityType: "break",
    entityId: after.id,
    action: brk ? `${input.source}_break` : `${input.source}_break_add`,
    actorId: input.actorId,
    reason: input.reason,
    oldValue: brk ? breakView(brk) : null,
    newValue: breakView(after),
  });
  await logIfSelf(input.source, {
    employeeId: entry.employeeId,
    actorId: input.actorId,
    day: dayOf(entry.clockIn),
    timeEntryId: entry.id,
    kind: brk ? "break_edit" : "break_add",
    before: brk ? breakView(brk) : null,
    after: breakView(after),
    reason: input.reason,
  });
  return after;
}

/** Remove a break (incl. an auto-deducted one). Audited like every edit. */
export async function applyBreakRemove(input: {
  entry: TimeEntry;
  brk: Break;
  actorId: string;
  reason: string;
  source: EditSource;
}): Promise<void> {
  const { entry, brk } = input;
  await assertEntryEditable(entry);
  const db = getDb();
  await db.delete(breaks).where(eq(breaks.id, brk.id));
  await db.update(timeEntries).set({ edited: true, updatedAt: new Date() }).where(eq(timeEntries.id, entry.id));

  await appendAudit({
    entityType: "break",
    entityId: brk.id,
    action: `${input.source}_break_remove`,
    actorId: input.actorId,
    reason: input.reason,
    oldValue: { ...breakView(brk), autoDeducted: brk.autoDeducted },
    newValue: null,
  });
  await logIfSelf(input.source, {
    employeeId: entry.employeeId,
    actorId: input.actorId,
    day: dayOf(entry.clockIn),
    timeEntryId: entry.id,
    kind: "break_remove",
    before: breakView(brk),
    after: null,
    reason: input.reason,
  });
}

export class EditError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
