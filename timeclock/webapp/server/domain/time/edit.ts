import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, type TimeEntry } from "@/db/schema";
import { appendAudit } from "@/server/domain/audit/writer";
import { assertEntryEditable } from "@/server/domain/payperiod/guard";

export interface EntryEdit {
  clockIn?: Date;
  clockOut?: Date | null;
  note?: string | null;
  jobId?: string | null;
}

/**
 * THE single mutation path for changing a time entry after the fact — used by
 * both self-edits and approved corrections. Writes the new value, marks the
 * entry `edited` (manager reports flag it), and appends the mandatory audit
 * row (old -> new + reason). Deletion does not exist anywhere.
 */
export async function applyEntryEdit(input: {
  entry: TimeEntry;
  edit: EntryEdit;
  actorId: string;
  reason: string;
  source: "self_edit" | "correction_approved";
}): Promise<TimeEntry> {
  const { entry, edit } = input;
  await assertEntryEditable(entry);

  if (edit.clockIn || edit.clockOut !== undefined) {
    const newIn = edit.clockIn ?? entry.clockIn;
    const newOut = edit.clockOut === undefined ? entry.clockOut : edit.clockOut;
    if (newOut && newOut <= newIn) throw new EditError("clock_out_before_in");
  }

  const [after] = await getDb()
    .update(timeEntries)
    .set({
      ...(edit.clockIn && { clockIn: edit.clockIn }),
      ...(edit.clockOut !== undefined && { clockOut: edit.clockOut }),
      ...(edit.note !== undefined && { note: edit.note }),
      ...(edit.jobId !== undefined && { jobId: edit.jobId }),
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
    },
  });
  return after;
}

export class EditError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
