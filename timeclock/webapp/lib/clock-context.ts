/**
 * Pure helpers behind the clock screen + home status card (batch 2, #15–17).
 * No UI or DB imports: used by the Hono route, the demo backend and the pages.
 */

type When = Date | string;
const ms = (v: When) => new Date(v).getTime();

export interface SegLike {
  id: string;
  clockIn: When;
  clockOut: When | null;
}
export interface BreakLike {
  startAt: When;
  endAt: When | null;
  paid: boolean;
}

/** Job switches close one entry and open the next at the same instant. */
const CHAIN_GAP_MS = 60_000;

/**
 * Today's worked minutes (closed entries + the running one, unpaid breaks
 * off) and the run of back-to-back entries ending at the open one, so the day
 * total and "since" time survive a job switch.
 */
export function todayWork(
  entries: SegLike[],
  breaksOf: (entryId: string) => BreakLike[],
  openId: string | null,
  today: string,
  dayOf: (at: Date) => string,
  now: Date = new Date(),
): { todayWorkedMin: number; shiftStart: string | null; chainIds: string[] } {
  let worked = 0;
  for (const e of entries) {
    if (dayOf(new Date(e.clockIn)) !== today) continue;
    const end = e.clockOut ? ms(e.clockOut) : now.getTime();
    const unpaid = breaksOf(e.id)
      .filter((b) => !b.paid)
      .reduce((s, b) => s + Math.max(0, (b.endAt ? ms(b.endAt) : now.getTime()) - ms(b.startAt)), 0);
    worked += Math.max(0, Math.round((end - ms(e.clockIn) - unpaid) / 60_000));
  }

  const chain: SegLike[] = [];
  let cur = openId ? entries.find((e) => e.id === openId) : undefined;
  while (cur && !chain.includes(cur)) {
    chain.unshift(cur);
    const at = ms(cur.clockIn);
    cur = entries.find((e) => e.clockOut && e !== cur && Math.abs(ms(e.clockOut) - at) <= CHAIN_GAP_MS);
  }
  const first = chain[0];
  return {
    todayWorkedMin: worked,
    shiftStart: first ? new Date(first.clockIn).toISOString() : null,
    chainIds: chain.map((e) => e.id),
  };
}

/**
 * Rest/meal entitlement for a shift of `expectedMin` (same thresholds as
 * server/domain/compliance/breaks-compliance.ts) vs breaks taken so far.
 */
export function breakProgress(expectedMin: number, taken: BreakLike[]) {
  const restTaken = taken.filter((b) => b.paid && b.endAt).length;
  const mealMin = taken
    .filter((b) => !b.paid && b.endAt)
    .reduce((s, b) => s + (ms(b.endAt!) - ms(b.startAt)) / 60_000, 0);
  let restDue = expectedMin >= 120 ? 1 : 0;
  if (expectedMin > 6 * 60) restDue = 2;
  if (expectedMin > 10 * 60) restDue = 3 + Math.floor((expectedMin - 10 * 60) / (4 * 60));
  return { restTaken, restDue, mealDue: expectedMin > 4 * 60, mealTaken: mealMin >= 30 };
}

/** Rest breaks are 10 min; the meal break is the configured unpaid length. */
export const breakLengthMin = (paid: boolean, mealMin: number) => (paid ? 10 : mealMin > 0 ? mealMin : 30);

export interface ShiftLike {
  shiftDate: string; // facility-local YYYY-MM-DD
  startMin: number;
  endMin: number;
  jobId: string | null;
}

/** Browser-local instant of `min` minutes into `day`. */
export const shiftInstant = (day: string, min: number) => new Date(new Date(`${day}T00:00:00`).getTime() + min * 60_000);

/** The rostered shift running now, else the next one to start. */
export function nextShift<S extends ShiftLike>(shifts: S[], now: Date = new Date()) {
  const rows = shifts
    .map((s) => ({ shift: s, start: shiftInstant(s.shiftDate, s.startMin), end: shiftInstant(s.shiftDate, s.endMin) }))
    .filter((r) => r.end > now)
    .sort((a, b) => +a.start - +b.start);
  const r = rows[0];
  return r ? { ...r, current: r.start <= now } : null;
}

/** Usual week = average worked minutes per worked day × usual workdays. */
export function usualWeekMin(days: { day: string; minutes: number }[], workdays: number): number | null {
  const byDay = new Map<string, number>();
  for (const d of days) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.minutes);
  if (byDay.size === 0) return null;
  const total = [...byDay.values()].reduce((a, b) => a + b, 0);
  return Math.round((total / byDay.size) * workdays);
}

/** Local YYYY-MM-DD the week containing `d` starts on (0 = Sun, 1 = Mon). */
export function weekStartDay(d: Date, weekStart: 0 | 1): string {
  const s = new Date(d);
  s.setDate(s.getDate() - ((s.getDay() - weekStart + 7) % 7));
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`;
}
