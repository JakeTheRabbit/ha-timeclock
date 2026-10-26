import { APP_TZ } from "@/lib/tz";

// Employees may fix their own times on the shift's day and the day after
// (facility timezone). After that the entry locks: only a manager-approved
// correction can change it. Every edit is still audited either way.

/** Facility-local calendar day as YYYY-MM-DD. */
function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(d);
}

/** The local days on which a self-edit is still open: today and yesterday. */
function openDays(now: Date): string[] {
  const today = dayKey(now);
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return [today, yesterday];
}

/** True while an entry clocked in at `clockIn` may still be self-edited. */
export function isSelfEditable(clockIn: Date, now: Date = new Date()): boolean {
  return openDays(now).includes(dayKey(clockIn));
}
