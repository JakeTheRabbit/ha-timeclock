import type { Roster, TimeEntry } from "@/db/schema";
import { APP_TZ } from "@/lib/tz";

export type ShiftStatus = "ok" | "late" | "no_show" | "in_progress" | "upcoming";

export interface ShiftComparison {
  rosterId: string;
  employeeId: string;
  scheduledStart: Date; // instant of shift_date+start_min in NZ time
  scheduledEnd: Date;
  actualIn: Date | null;
  actualOut: Date | null;
  lateMin: number; // 0 when on time
  status: ShiftStatus;
}

const LATE_GRACE_MIN = 5;

/** NZ wall-clock (date + minutes-from-midnight) -> UTC instant, DST-correct. */
export function nzWallToInstant(dateISO: string, minOfDay: number): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const hh = Math.floor(minOfDay / 60);
  const mm = minOfDay % 60;
  // Guess UTC, then correct by the zone offset Intl reports for that guess.
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TZ,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(guess);
    const p = (t: string) => Number(parts.find((x) => x.type === t)?.value);
    const shown = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour") % 24, p("minute"));
    const want = Date.UTC(y, m - 1, d, hh, mm);
    const diff = want - shown;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess;
}

/**
 * Compare one rostered shift against the employee's entries. `now` decides
 * whether a missing punch is "upcoming", "late", or a full "no_show" (no punch
 * by shift end).
 */
export function compareShift(
  roster: Roster,
  entries: Pick<TimeEntry, "clockIn" | "clockOut">[],
  now: Date,
): ShiftComparison {
  const scheduledStart = nzWallToInstant(roster.shiftDate, roster.startMin);
  const scheduledEnd = nzWallToInstant(roster.shiftDate, roster.endMin);

  // First entry that overlaps the scheduled window (±4h slack for early starts).
  const slack = 4 * 3600_000;
  const match = entries
    .filter(
      (e) =>
        e.clockIn.getTime() > scheduledStart.getTime() - slack &&
        e.clockIn.getTime() < scheduledEnd.getTime() + slack,
    )
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime())[0];

  const base = {
    rosterId: roster.id,
    employeeId: roster.employeeId,
    scheduledStart,
    scheduledEnd,
    actualIn: match?.clockIn ?? null,
    actualOut: match?.clockOut ?? null,
  };

  if (!match) {
    if (now < scheduledStart) return { ...base, lateMin: 0, status: "upcoming" };
    if (now >= scheduledEnd) return { ...base, lateMin: 0, status: "no_show" };
    const lateMin = Math.floor((now.getTime() - scheduledStart.getTime()) / 60_000);
    return { ...base, lateMin, status: lateMin > LATE_GRACE_MIN ? "late" : "upcoming" };
  }

  const lateMin = Math.max(
    0,
    Math.floor((match.clockIn.getTime() - scheduledStart.getTime()) / 60_000),
  );
  return {
    ...base,
    lateMin: lateMin > LATE_GRACE_MIN ? lateMin : 0,
    status: match.clockOut == null && now < scheduledEnd
      ? "in_progress"
      : lateMin > LATE_GRACE_MIN
        ? "late"
        : "ok",
  };
}
