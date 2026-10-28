import { APP_TZ } from "@/lib/tz";

// Employees may fix their own times on the shift's day and the day after
// (facility timezone). After that the entry locks: only a manager-approved
// correction can change it. Every edit is still audited either way.

/** Facility-local calendar day as YYYY-MM-DD. */
function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(d);
}

/** Yesterday's local day — the oldest day a self-edit is still open for. */
function oldestOpenDay(now: Date): string {
  const [y, m, d] = dayKey(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * True while an entry clocked in at `clockIn` may still be self-edited:
 * today or yesterday. (Later days pass here so a future time gets the
 * clearer clock_in_in_future error from the edit itself.)
 */
export function isSelfEditable(clockIn: Date, now: Date = new Date()): boolean {
  return dayKey(clockIn) >= oldestOpenDay(now); // YYYY-MM-DD sorts as dates
}
