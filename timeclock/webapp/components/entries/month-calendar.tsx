"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { localDay, type EntryRow } from "@/components/entries/edit-entry-dialog";

/** First day of the month containing `d`. */
export const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
/** Fetch window for a month view: whole weeks shown, from the site week start (0=Sun, 1=Mon). */
export function monthGrid(month: Date, weekStart: 0 | 1 = 1) {
  const first = monthStart(month);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() - weekStart + 7) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  return { start, end };
}

/** The 7 local days (YYYY-MM-DD) of the week containing `day`. */
export function weekDays(day: string, weekStart: 0 | 1 = 1): string[] {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return localDay(x);
  });
}

/** Minutes-into-day as a wall-clock time in the site locale (12h/24h). */
export function shiftTime(loc: Pick<ReturnType<typeof useLocale>, "time">, min: number): string {
  return loc.time(new Date(Date.UTC(2000, 0, 1, 0, min)), { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

/** A usual workday already gone by with nothing recorded (and not leave / a holiday). */
export function missedUsualDay(
  day: string,
  today: string,
  usualWeekdays: readonly number[],
  hasHours: boolean,
  skip?: ReadonlySet<string>,
): boolean {
  return (
    day < today && !hasHours && !skip?.has(day) && usualWeekdays.includes(new Date(`${day}T12:00:00`).getDay())
  );
}

/** Worked minutes; for a shift still running, worked so far (less unpaid breaks). */
export function liveMinutes(e: EntryRow): number {
  if (e.workedMinutes != null) return e.workedMinutes;
  const now = Date.now();
  const unpaid = e.breaks
    .filter((b) => !b.paid)
    .reduce((s, b) => s + ((b.endAt ? +new Date(b.endAt) : now) - +new Date(b.startAt)), 0);
  return Math.max(0, Math.round((now - +new Date(e.clockIn) - unpaid) / 60_000));
}

/** Minutes of work and break in each local hour 0–23 of `day`. */
export function hourBuckets(day: string, entries: EntryRow[]) {
  const base = new Date(`${day}T00:00:00`).getTime();
  const H = 3600_000;
  const work = new Array<number>(24).fill(0);
  const brk = new Array<number>(24).fill(0);
  const add = (arr: number[], a: number, b: number, sign = 1) => {
    for (let h = 0; h < 24; h++) {
      const s = Math.max(a, base + h * H);
      const e = Math.min(b, base + (h + 1) * H);
      if (e > s) arr[h] += (sign * (e - s)) / 60_000;
    }
  };
  const now = Date.now();
  for (const e of entries) {
    const a = +new Date(e.clockIn);
    const b = e.clockOut ? +new Date(e.clockOut) : now;
    add(work, a, b);
    for (const x of e.breaks) {
      const s = +new Date(x.startAt);
      const t = x.endAt ? +new Date(x.endAt) : now;
      add(work, s, t, -1);
      add(brk, s, t);
    }
  }
  return { work, brk };
}

/**
 * 24 dots, one per hour of the day: work, break, or off. A dot is as solid
 * as the share of the hour spent that way.
 */
export function HourDots({ day, entries, compact }: { day: string; entries: EntryRow[]; compact?: boolean }) {
  const { work, brk } = hourBuckets(day, entries);
  return (
    <div className={cn("flex items-center", compact ? "gap-px" : "gap-1")} aria-hidden>
      {work.map((w, h) => {
        const b = brk[h];
        const kind = w <= 0 && b <= 0 ? "off" : b > 0 && b >= w ? "brk" : "work";
        const share = Math.min(1, Math.max(w, b) / 60);
        return (
          <span
            key={h}
            title={`${String(h).padStart(2, "0")}:00 · ${Math.round(w)}m work${b ? ` · ${Math.round(b)}m break` : ""}`}
            className={cn(
              "shrink-0",
              compact ? "h-1 flex-1 first:rounded-l last:rounded-r" : "size-2.5 rounded-full sm:size-3",
              kind === "off" && "bg-muted-foreground/20",
              kind === "work" && "bg-primary",
              kind === "brk" && "bg-amber-400",
              !compact && h % 6 === 0 && h > 0 && "ml-1",
            )}
            style={kind === "off" ? undefined : { opacity: 0.35 + 0.65 * share }}
          />
        );
      })}
    </div>
  );
}

/**
 * Month calendar: hours per day, approved/open state, today ringed. Click a
 * day to pick it. Weeks start on the site `weekStart` setting.
 */
export function MonthCalendar({
  month,
  onMonth,
  entries,
  selected,
  onSelect,
  approvedDays,
  flaggedDays,
  leaveDays,
  holidayDays,
  usualWeekdays,
}: {
  month: Date;
  onMonth: (m: Date) => void;
  entries: EntryRow[];
  selected: string | null;
  onSelect: (day: string) => void;
  approvedDays?: Set<string>;
  /** Days with something to look at (pending changes, open shift, flags). */
  flaggedDays?: Set<string>;
  /** Approved leave days (tinted). */
  leaveDays?: ReadonlySet<string>;
  /** Public holidays (tinted). */
  holidayDays?: ReadonlySet<string>;
  /** Usual weekdays (0=Sun..6=Sat): past ones with nothing recorded get a hollow ring. */
  usualWeekdays?: readonly number[];
}) {
  const loc = useLocale();
  const t = useT();
  const { start } = monthGrid(month, loc.weekStart);
  const today = localDay();
  const minsByDay = new Map<string, number>();
  for (const e of entries) minsByDay.set(e.day, (minsByDay.get(e.day) ?? 0) + liveMinutes(e));
  const approved = approvedDays ?? new Set(entries.filter((e) => e.dayApproved).map((e) => e.day));
  const skip = new Set([...(leaveDays ?? []), ...(holidayDays ?? [])]);
  const weekdays = Array.from({ length: 7 }, (_, i) => (loc.weekStart + i) % 7);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  // Drop a trailing week that is entirely next month.
  const shown = cells[35].getMonth() !== month.getMonth() ? cells.slice(0, 35) : cells;
  const monthMin = entries
    .filter((e) => new Date(`${e.day}T12:00:00`).getMonth() === month.getMonth())
    .reduce((a, e) => a + liveMinutes(e), 0);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" aria-label={t("calendar.prevMonth")} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft />
        </Button>
        <span className="font-medium">{loc.date(month, { month: "long", year: "numeric" })}</span>
        <Button variant="ghost" size="sm" aria-label={t("calendar.nextMonth")} onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight />
        </Button>
        <Button variant="outline" size="sm" onClick={() => { onMonth(monthStart(new Date())); onSelect(today); }}>
          {loc.date(new Date(), { day: "numeric", month: "short" })}
        </Button>
        <span className="ml-auto font-mono text-sm">{(monthMin / 60).toFixed(2)}h</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {weekdays.map((w) => (
          <span key={w}>{loc.weekday(w, "short")}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {shown.map((d) => {
          const key = localDay(d);
          const mins = minsByDay.get(key);
          const inMonth = d.getMonth() === month.getMonth();
          const missed = !!usualWeekdays && missedUsualDay(key, today, usualWeekdays, mins != null, skip);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                "flex min-h-14 flex-col items-start rounded-md border border-transparent p-1.5 text-left transition-colors hover:bg-muted/60",
                !inMonth && "opacity-40",
                holidayDays?.has(key) && "bg-violet-500/15",
                leaveDays?.has(key) && "bg-sky-500/15",
                mins != null && "bg-primary/10",
                approved.has(key) && "bg-emerald-500/15",
                key === today && "border-primary/60",
                key === selected && "ring-2 ring-primary",
              )}
            >
              <span className="flex w-full items-center gap-0.5 text-xs">
                {d.getDate()}
                {missed && <span className="ml-auto size-2 rounded-full border border-muted-foreground/70" />}
                {flaggedDays?.has(key) && <span className="ml-auto size-1.5 rounded-full bg-amber-400" />}
              </span>
              {mins != null && (
                <>
                  <span className="mt-auto font-mono text-[11px] sm:text-xs">{(mins / 60).toFixed(1)}h</span>
                  <div className="mt-0.5 w-full">
                    <HourDots day={key} entries={entries.filter((e) => e.day === key)} compact />
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <Legend swatch="rounded-sm bg-emerald-500/40" label={t("calendar.legendApproved")} />
        <Legend swatch="rounded-sm bg-primary/30" label={t("calendar.legendHours")} />
        {flaggedDays && <Legend swatch="rounded-full bg-amber-400" label={t("calendar.legendAttention")} />}
        {leaveDays && <Legend swatch="rounded-sm bg-sky-500/40" label={t("calendar.legendLeave")} />}
        {holidayDays && <Legend swatch="rounded-sm bg-violet-500/40" label={t("calendar.legendHoliday")} />}
        {usualWeekdays && (
          <Legend swatch="rounded-full border border-muted-foreground/70" label={t("calendar.legendMissed")} />
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("size-2 shrink-0", swatch)} aria-hidden /> {label}
    </span>
  );
}
