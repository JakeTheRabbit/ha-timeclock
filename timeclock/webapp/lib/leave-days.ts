/**
 * Pure helpers for the leave request form and list: usual workdays, day
 * counts that skip non-workdays + public holidays, and request grouping.
 * Days are calendar YYYY-MM-DD strings (facility-local, no zone maths).
 */

/** YYYY-MM-DD → Date at local noon (safe across DST edges). */
const at = (day: string) => new Date(`${day}T12:00:00`);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function addDays(day: string, n: number): string {
  const d = at(day);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function isWorkday(day: string, weekdays: number[], holidays: ReadonlySet<string>): boolean {
  return weekdays.includes(at(day).getDay()) && !holidays.has(day);
}

/** First usual workday strictly after `after` (looks 60 days ahead). */
export function nextWorkday(after: string, weekdays: number[], holidays: ReadonlySet<string>): string {
  for (let i = 1; i <= 60; i++) {
    const d = addDays(after, i);
    if (isWorkday(d, weekdays, holidays)) return d;
  }
  return addDays(after, 1);
}

/** Usual workdays in [start, end] inclusive; 0 when end < start. */
export function workdaysBetween(
  start: string,
  end: string,
  weekdays: number[],
  holidays: ReadonlySet<string>,
): number {
  let n = 0;
  for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) {
    if (isWorkday(d, weekdays, holidays)) n++;
  }
  return n;
}

/** Calendar days in [start, end] inclusive. */
export function calendarDays(start: string, end: string): number {
  return Math.max(0, Math.round((at(end).getTime() - at(start).getTime()) / 86_400_000) + 1);
}

/** Median worked hours per worked day (8 when there's no history). */
export function usualDailyHours(entries: { day: string; workedMinutes: number | null }[]): number {
  const perDay = new Map<string, number>();
  for (const e of entries) {
    if (e.workedMinutes != null) perDay.set(e.day, (perDay.get(e.day) ?? 0) + e.workedMinutes);
  }
  const days = [...perDay.values()].filter((m) => m > 0).sort((a, b) => a - b);
  if (!days.length) return 8;
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return Math.round((median / 60) * 100) / 100;
}

/** Hours of PENDING requests per leave type. */
export function pendingHoursByType(requests: { type: string; hours: string | number; status: string }[]) {
  const out: Record<string, number> = {};
  for (const r of requests) if (r.status === "pending") out[r.type] = (out[r.type] ?? 0) + Number(r.hours);
  return out;
}

export interface Groupable {
  status: string;
  startDate: string;
  endDate: string;
}

/** Pending (soonest first) / Upcoming approved (soonest first) / Past (latest first). */
export function groupRequests<T extends Groupable>(requests: T[], today: string) {
  const pending = requests.filter((r) => r.status === "pending");
  const upcoming = requests.filter((r) => r.status === "approved" && r.endDate >= today);
  const past = requests.filter((r) => !pending.includes(r) && !upcoming.includes(r));
  const asc = (a: T, b: T) => a.startDate.localeCompare(b.startDate);
  return {
    pending: pending.sort(asc),
    upcoming: upcoming.sort(asc),
    past: past.sort((a, b) => -asc(a, b)),
  };
}

/** "Mon 3 – Wed 5 Dec" (same month), "Fri 28 Nov – Tue 2 Dec", "Mon 3 Dec". */
export function formatLeaveRange(start: string, end: string, locale: string): string {
  const fmt = (day: string, o: Intl.DateTimeFormatOptions) => {
    try {
      return at(day).toLocaleDateString(locale, o);
    } catch {
      return day;
    }
  };
  const full: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (start === end) return fmt(start, full);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const first = sameMonth ? fmt(start, { weekday: "short", day: "numeric" }) : fmt(start, full);
  return `${first} – ${fmt(end, full)}`;
}
