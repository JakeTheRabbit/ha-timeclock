import type { TimeEntry } from "@/db/schema";
import { EditGuardError } from "./errors";
import { findPeriodContaining } from "./periods";

/**
 * Throws when the entry's pay period has been signed off + locked (P8).
 * Locked periods are immutable: no self-edits, no correction approvals.
 */
export async function assertEntryEditable(entry: TimeEntry): Promise<void> {
  const period = await findPeriodContaining(entry.clockIn);
  if (period?.lockedAt) throw new EditGuardError("pay_period_locked");
}
