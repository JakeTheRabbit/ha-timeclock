import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { breaks, timeEntries, type Break, type TimeEntry } from "@/db/schema";
import { appendAudit } from "@/server/domain/audit/writer";
import { assertEntryEditable } from "@/server/domain/payperiod/guard";
import { doorAccessFlag, withDoorFlag } from "@/server/domain/antifraud/door-access";

export interface EntryEdit {
  clockIn?: Date;
  clockOut?: Date | null;
  note?: string | null;
  jobId?: string | null;
}

export type EditSource = "self_edit" | "manager_edit" | "correction_approved";

// Small allowance for device clock skew on "now"-ish edits.
const FUTURE_SKEW_MS = 60_000;

/**
 * THE single mutation path for changing a time entry after the fact — used by
 * self-edits, manager edits and approved corrections. Writes the new value,
 * marks the entry `edited` (manager reports flag it), re-runs the door-access
 * check when the start time moves, and appends the mandatory audit row
 * (old -> new + reason). Deletion does not exist anywhere.
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

  const limit = Date.now() + FUTURE_SKEW_MS;
  if (edit.clockIn && edit.clockIn.getTime() > limit) throw new EditError("clock_in_in_future");
  if (edit.clockOut && edit.clockOut.getTime() > limit) throw new EditError("clock_out_in_future");
  if (edit.clockIn || edit.clockOut !== undefined) {
    const newIn = edit.clockIn ?? entry.clockIn;
    const newOut = edit.clockOut === undefined ? entry.clockOut : edit.clockOut;
    if (newOut && newOut <= newIn) throw new EditError("clock_out_before_in");
  }

  // A moved start time must still line up with a card swipe.
  let fraudFlags: string[] | undefined;
  if (edit.clockIn && edit.clockIn.getTime() !== entry.clockIn.getTime()) {
    const emp = await getDb().query.employees.findFirst({
      where: (e, { eq: eq_ }) => eq_(e.id, entry.employeeId),
    });
    fraudFlags = withDoorFlag(entry.fraudFlags, await doorAccessFlag(emp?.accessEntities ?? [], edit.clockIn));
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
    oldValue: {
      clockIn: entry.clockIn.toISOString(),
      clockOut: entry.clockOut?.toISOString() ?? null,
      note: entry.note,
      jobId: entry.jobId,
    },
    newValue: {
      clockIn: after.clockIn.toISOString(),
      clockOut: after.clockOut?.toISOString() ?? null,
      note: after.note,
      jobId: after.jobId,
      ...(fraudFlags && { fraudFlags }),
    },
  });
  return after;
}

export interface BreakEdit {
  startAt?: Date;
  endAt?: Date | null;
  paid?: boolean;
}

/**
 * Edit an existing break, or add a missed one (`brk` null). The break must sit
 * inside its shift (an open shift runs to "now"). Same audit + lock rules as
 * entry edits; the parent entry is flagged `edited`.
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
  const values = { startAt, endAt, paid: edit.paid ?? brk?.paid ?? false, autoDeducted: false };
  const [after] = brk
    ? await db.update(breaks).set(values).where(eq(breaks.id, brk.id)).returning()
    : await db.insert(breaks).values({ timeEntryId: entry.id, ...values }).returning();
  await db.update(timeEntries).set({ edited: true, updatedAt: new Date() }).where(eq(timeEntries.id, entry.id));

  const view = (b: Break) => ({
    timeEntryId: b.timeEntryId,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt?.toISOString() ?? null,
    paid: b.paid,
  });
  await appendAudit({
    entityType: "break",
    entityId: after.id,
    action: brk ? `${input.source}_break` : `${input.source}_break_add`,
    actorId: input.actorId,
    reason: input.reason,
    oldValue: brk ? view(brk) : null,
    newValue: view(after),
  });
  return after;
}

export class EditError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
