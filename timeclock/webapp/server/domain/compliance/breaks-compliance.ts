import type { Break } from "@/db/schema";

/**
 * NZ Employment Relations Act rest/meal break entitlements (standard pattern):
 *   2h-4h   worked: one 10-min paid rest break
 *   4h-6h   worked: one 10-min paid rest + one 30-min meal break
 *   6h-10h  worked: two 10-min paid rests + one 30-min meal break
 *   >10h    worked: pattern repeats (pro-rated here as: +1 rest per extra 4h)
 * Returns human-readable flags for entries that fall short. Flags, not blocks —
 * compliance is surfaced to managers, never enforced retroactively.
 */
export interface BreakComplianceFlag {
  code: "missing_rest_break" | "missing_meal_break";
  detail: string;
}

export function breakComplianceFlags(
  workedMin: number,
  entryBreaks: Pick<Break, "paid" | "startAt" | "endAt">[],
): BreakComplianceFlag[] {
  const flags: BreakComplianceFlag[] = [];
  if (workedMin < 120) return flags; // under 2h: no entitlement

  const restTaken = entryBreaks.filter((b) => b.paid && b.endAt).length;
  const mealMin = entryBreaks
    .filter((b) => !b.paid && b.endAt)
    .reduce((a, b) => a + (b.endAt!.getTime() - b.startAt.getTime()) / 60_000, 0);

  let restDue = 1;
  let mealDue = 0;
  if (workedMin > 4 * 60) mealDue = 1;
  if (workedMin > 6 * 60) restDue = 2;
  if (workedMin > 10 * 60) restDue = 2 + Math.floor((workedMin - 10 * 60) / (4 * 60)) + 1;

  if (restTaken < restDue) {
    flags.push({
      code: "missing_rest_break",
      detail: `${restTaken}/${restDue} paid 10-min rest breaks taken`,
    });
  }
  if (mealDue > 0 && mealMin < 30) {
    flags.push({
      code: "missing_meal_break",
      detail: `${Math.round(mealMin)}min unpaid meal break taken (30min due)`,
    });
  }
  return flags;
}
