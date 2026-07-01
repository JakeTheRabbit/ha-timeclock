/**
 * Overtime attribution. Input: worked minutes per day for ONE week (Mon-Sun)
 * for one employee. Output: ordinary / OT1 / OT2 minutes, no double counting:
 * daily OT is carved out first; weekly OT applies to the remaining ordinary
 * minutes above the weekly threshold.
 */
export interface OvertimeRules {
  dailyThresholdMin: number; // e.g. 480 (8h)
  weeklyThresholdMin: number; // e.g. 2400 (40h)
  multiplier1: number; // e.g. 1.5
  multiplier2: number; // e.g. 2.0
  daily2ThresholdMin: number | null; // e.g. 720 (12h) -> OT2 beyond this; null = off
}

export interface OvertimeResult {
  ordinaryMin: number;
  ot1Min: number;
  ot2Min: number;
  perDay: { workedMin: number; ordinaryMin: number; ot1Min: number; ot2Min: number }[];
}

export function computeWeekOvertime(dailyWorkedMin: number[], rules: OvertimeRules): OvertimeResult {
  const perDay = dailyWorkedMin.map((worked) => {
    let ordinary = Math.min(worked, rules.dailyThresholdMin);
    let ot1 = Math.max(0, worked - rules.dailyThresholdMin);
    let ot2 = 0;
    if (rules.daily2ThresholdMin != null && worked > rules.daily2ThresholdMin) {
      ot2 = worked - rules.daily2ThresholdMin;
      ot1 = Math.max(0, ot1 - ot2);
    }
    return { workedMin: worked, ordinaryMin: ordinary, ot1Min: ot1, ot2Min: ot2 };
  });

  // Weekly threshold applies to ordinary minutes only (daily OT already extra).
  const ordinaryTotal = perDay.reduce((a, d) => a + d.ordinaryMin, 0);
  const weeklyOt = Math.max(0, ordinaryTotal - rules.weeklyThresholdMin);

  // Reassign weekly OT from the END of the week backwards (latest hours worked
  // beyond 40 are the overtime ones).
  let toReassign = weeklyOt;
  for (let i = perDay.length - 1; i >= 0 && toReassign > 0; i--) {
    const take = Math.min(perDay[i].ordinaryMin, toReassign);
    perDay[i].ordinaryMin -= take;
    perDay[i].ot1Min += take;
    toReassign -= take;
  }

  return {
    ordinaryMin: perDay.reduce((a, d) => a + d.ordinaryMin, 0),
    ot1Min: perDay.reduce((a, d) => a + d.ot1Min, 0),
    ot2Min: perDay.reduce((a, d) => a + d.ot2Min, 0),
    perDay,
  };
}

/** Weighted pay-minutes: ordinary*1 + ot1*m1 + ot2*m2 (for cost reporting). */
export function payWeightedMinutes(r: OvertimeResult, rules: OvertimeRules): number {
  return Math.round(r.ordinaryMin + r.ot1Min * rules.multiplier1 + r.ot2Min * rules.multiplier2);
}
