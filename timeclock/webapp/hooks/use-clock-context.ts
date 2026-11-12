"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api-client";
import { useLocale } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { liveMinutes } from "@/components/entries/month-calendar";
import { localDay, typicalFrom, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { nextShift, usualWeekMin, weekStartDay, type ShiftLike } from "@/lib/clock-context";

export interface ClockBreak {
  startAt: string;
  endAt: string | null;
  paid: boolean;
  autoDeducted: boolean;
}
export interface ClockStatus {
  open: {
    entryId: string;
    clockIn: string;
    /** First clock-in of the current back-to-back run (survives job switches). */
    shiftStart?: string;
    job: { id: string; name: string } | null;
    onBreak: { breakId: string; startAt: string; paid: boolean } | null;
    unpaidBreakMin: number;
    breaks?: ClockBreak[];
  } | null;
  /** What a clock-in must carry (geofence / photo-on-punch settings). */
  requires?: { geo: boolean; photo: boolean };
  breakRule?: { autoDeductAfterMin: number; autoDeductMin: number };
  /** Worked minutes today (closed entries + the running one) at fetch time. */
  todayWorkedMin?: number;
}

export function useClockStatus(enabled: boolean) {
  return useQuery({
    queryKey: ["clock-status"],
    queryFn: () => apiGet<ClockStatus>("/clock/status"),
    enabled,
    refetchInterval: 30_000,
  });
}

/** Today's total ticking on from the last fetch (paused on an unpaid break). */
export function liveTodayMin(s: ClockStatus | undefined, fetchedAt: number): number {
  const base = s?.todayWorkedMin ?? 0;
  if (!s?.open || (s.open.onBreak && !s.open.onBreak.paid)) return base;
  return base + Math.max(0, Math.floor((Date.now() - fetchedAt) / 60_000));
}

type TFn = ReturnType<typeof useT>;
type Loc = ReturnType<typeof useLocale>;

/** "7h 30m" */
export const fmtHm = (t: TFn, min: number) => t("clock.hm", { h: Math.floor(min / 60), m: Math.round(min % 60) });
/** "31.5h" */
export const fmtH = (t: TFn, loc: Loc, min: number) =>
  t("clock.hoursShort", { h: loc.number(min / 60, { maximumFractionDigits: 1 }) });

/** "rostered until 16:30" / "today 08:00" / "Tue 08:00" */
export function shiftWhen(t: TFn, loc: Loc, next: NonNullable<ReturnType<typeof nextShift>>) {
  const hm = { hour: "2-digit", minute: "2-digit" } as const;
  if (next.current) return t("clock.rosteredUntil", { time: loc.time(next.end, hm) });
  if (localDay(next.start) === localDay()) return t("clock.todayAt", { time: loc.time(next.start, hm) });
  return `${loc.weekday(next.start.getDay())} ${loc.time(next.start, hm)}`;
}

interface Shift extends ShiftLike {
  id: string;
}

/** Last out, this week vs usual, next rostered shift, likely job. */
export function useClockContext(enabled: boolean) {
  const { weekStart } = useLocale();
  const today = localDay();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 28);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 14);

  const entries = useQuery({
    queryKey: ["clock-context-entries", today],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(
        `/entries/mine?from=${from.toISOString()}&to=${new Date(Date.now() + 86400_000).toISOString()}`,
      ),
    enabled,
    refetchInterval: 60_000,
  });
  const roster = useQuery({
    queryKey: ["clock-context-roster", today],
    queryFn: () => apiGet<{ shifts: Shift[] }>(`/roster/mine?from=${today}&to=${localDay(horizon)}`),
    enabled,
  });

  const rows = entries.data?.entries ?? [];
  const week = weekStartDay(new Date(), weekStart);
  const past = rows.filter((e) => e.day < today && e.workedMinutes != null);
  const lastClosed = rows
    .filter((e) => e.clockOut)
    .sort((a, b) => +new Date(b.clockOut!) - +new Date(a.clockOut!))[0];
  const latest = [...rows].sort((a, b) => +new Date(b.clockIn) - +new Date(a.clockIn))[0];
  const next = nextShift(roster.data?.shifts ?? []);
  const pastDays = past.map((e) => ({ day: e.day, minutes: e.workedMinutes! }));

  return {
    ready: entries.isSuccess,
    lastOut: lastClosed?.clockOut ?? null,
    weekMin: rows.filter((e) => e.day >= week).reduce((s, e) => s + liveMinutes(e), 0),
    usualWeekMin: usualWeekMin(pastDays, typicalFrom(past).weekdays.length),
    /** Average worked minutes on a day worked (last 28 days). */
    usualDayMin: usualWeekMin(pastDays, 1),
    next,
    /** Rostered shift's job (current/next), else the last entry's job. */
    likelyJobId: next?.shift.jobId ?? latest?.job?.id ?? null,
  };
}
