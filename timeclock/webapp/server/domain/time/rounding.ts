export interface RoundingRule {
  incrementMin: 1 | 5 | 10 | 15;
  mode: "nearest" | "up" | "down";
}

/**
 * Round a punch instant per policy. Applied at REPORT time only — raw punches
 * in time_entries are never mutated (audit truth stays exact).
 */
export function roundInstant(at: Date, rule: RoundingRule): Date {
  if (rule.incrementMin === 1) return at;
  const inc = rule.incrementMin * 60_000;
  const t = at.getTime();
  const rounded =
    rule.mode === "up" ? Math.ceil(t / inc) * inc :
    rule.mode === "down" ? Math.floor(t / inc) * inc :
    Math.round(t / inc) * inc;
  return new Date(rounded);
}

/** Rounded worked minutes for an in/out pair (breaks subtracted separately). */
export function roundedSpanMinutes(clockIn: Date, clockOut: Date, rule: RoundingRule): number {
  const rin = roundInstant(clockIn, rule);
  const rout = roundInstant(clockOut, rule);
  return Math.max(0, Math.round((rout.getTime() - rin.getTime()) / 60_000));
}
