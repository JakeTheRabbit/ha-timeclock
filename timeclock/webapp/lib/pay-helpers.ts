// Pure helpers for the Pay and Pay periods screens (no React, no fetch).

/** Local calendar day (YYYY-MM-DD) of an instant, in the browser's zone. */
export const localDayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Every local day in [startAt, endAt) — the 7/14-day strip of a pay period. */
export function periodDays(startAt: string | Date, endAt: string | Date): string[] {
  const end = +new Date(endAt);
  const d = new Date(startAt);
  const out: string[] = [];
  while (+d < end && out.length < 62) {
    out.push(localDayOf(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** Human name for a timesheet compliance flag code. */
export function flagLabel(code: string): string {
  const known: Record<string, string> = {
    missing_rest_break: "No rest break",
    missing_meal_break: "No meal break",
  };
  if (known[code]) return known[code];
  const s = code.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The period to pay by default: newest one that has finished (list is newest first). */
export function lastFinishedPeriod<P extends { endAt: string }>(periods: P[], now = Date.now()): P | undefined {
  return periods.find((p) => +new Date(p.endAt) <= now);
}

/** Person to open the Pay screen on: the one owed the most (else the first). */
export function mostOwed<E extends { id: string; unpaidCents?: number }>(people: E[]): E | undefined {
  let best: E | undefined;
  for (const p of people) if (!best || (p.unpaidCents ?? 0) > (best.unpaidCents ?? 0)) best = p;
  return best;
}

/** Local day the week containing `at` starts on (weekStart 0=Sun, 1=Mon). */
export function weekStartDay(at: string | Date, weekStart: 0 | 1 = 1): string {
  const d = new Date(at);
  d.setHours(12, 0, 0, 0); // mid-day: DST-safe day stepping
  d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7));
  return localDayOf(d);
}

/** Group items (any order) into weeks, newest week first, keeping item order within a week. */
export function groupByWeek<T>(items: T[], at: (t: T) => string, weekStart: 0 | 1 = 1) {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = weekStartDay(at(it), weekStart);
    map.set(k, [...(map.get(k) ?? []), it]);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([week, rows]) => ({ week, rows }));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Payment note prefill: the last note used, with its date swapped for today's
 * ("paid 28 Oct bank transfer" -> "paid 13 Nov bank transfer"). A note with no
 * date gets today's appended; no history -> "Paid <today>".
 * `fmt` formats today the way the screen shows dates; `locale` adds that
 * language's month names to the English ones when spotting a date.
 */
export function nextPaymentNote(last: string | null | undefined, today: Date, fmt: (d: Date) => string, locale = "en"): string {
  const t = fmt(today);
  const prev = last?.trim();
  if (!prev) return `Paid ${t}`;
  const iso = /\b\d{4}-\d{2}-\d{2}\b/;
  if (iso.test(prev)) return prev.replace(iso, localDayOf(today));
  const months = new Set<string>();
  for (const loc of ["en", locale]) {
    for (let m = 0; m < 12; m++) {
      for (const month of ["short", "long"] as const) {
        try {
          months.add(new Date(2024, m, 15).toLocaleDateString(loc, { month }).replace(/\.$/, ""));
        } catch {
          /* bad locale tag: English only */
        }
      }
    }
  }
  const mon = `(?:${[...months].sort((a, b) => b.length - a.length).map(esc).join("|")})\\.?`;
  const patterns = [
    new RegExp(`\\d{1,2}(?:st|nd|rd|th|\\.)?\\s+${mon}(?:\\s+\\d{4})?`, "i"), // 28 Oct [2026] / 28. okt.
    new RegExp(`${mon}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`, "i"), // Oct 28[, 2026]
    /\b\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?\b/, // 28/10[/2026]
  ];
  for (const re of patterns) if (re.test(prev)) return prev.replace(re, t);
  return `${prev} ${t}`;
}
