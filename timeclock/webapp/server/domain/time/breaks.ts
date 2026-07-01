import type { Break } from "@/db/schema";

// Defaults; live values come from settings (P5) via the optional rule param.
export const AUTO_DEDUCT_AFTER_MIN = 6 * 60; // shifts longer than this...
export const AUTO_DEDUCT_MIN = 30; // ...get this much unpaid break deducted

export interface AutoDeductRule {
  autoDeductAfterMin: number;
  autoDeductMin: number;
}

/** Minutes of unpaid break actually taken (open breaks count up to `at`). */
export function unpaidBreakMinutes(list: Break[], at: Date): number {
  let total = 0;
  for (const b of list) {
    if (b.paid) continue;
    const end = b.endAt ?? at;
    total += Math.max(0, (end.getTime() - b.startAt.getTime()) / 60_000);
  }
  return Math.round(total);
}

/**
 * NZ practice: a meal break on longer shifts is unpaid. If the worker never
 * punched one, deduct the standard 30min at clock-out (recorded as an
 * auto_deducted break row so it is visible and auditable, never silent).
 * Returns minutes to deduct (0 = nothing to do).
 */
export function autoDeductMinutes(
  shiftMinutes: number,
  unpaidTakenMin: number,
  rule: AutoDeductRule = { autoDeductAfterMin: AUTO_DEDUCT_AFTER_MIN, autoDeductMin: AUTO_DEDUCT_MIN },
): number {
  if (rule.autoDeductMin <= 0) return 0; // feature off
  if (shiftMinutes <= rule.autoDeductAfterMin) return 0;
  if (unpaidTakenMin >= rule.autoDeductMin) return 0;
  return rule.autoDeductMin - unpaidTakenMin;
}

/** Worked minutes = span minus unpaid breaks. */
export function workedMinutes(clockIn: Date, clockOut: Date, list: Break[]): number {
  const span = (clockOut.getTime() - clockIn.getTime()) / 60_000;
  return Math.max(0, Math.round(span - unpaidBreakMinutes(list, clockOut)));
}
