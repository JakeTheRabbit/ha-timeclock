"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { localDay, type EntryRow } from "@/components/entries/edit-entry-dialog";

/** First day of the month containing `d`. */
export const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
/** Fetch window for a month view: whole weeks shown, Monday start. */
export function monthGrid(month: Date) {
  const first = monthStart(month);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 42);
  return { start, end };
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
 * day to pick it. Monday-first (NZ payroll weeks).
 */
export function MonthCalendar({
  month,
  onMonth,
  entries,
  selected,
  onSelect,
  approvedDays,
  flaggedDays,
}: {
  month: Date;
  onMonth: (m: Date) => void;
  entries: EntryRow[];
  selected: string | null;
  onSelect: (day: string) => void;
  approvedDays?: Set<string>;
  /** Days with something to look at (pending changes, open shift, flags). */
  flaggedDays?: Set<string>;
}) {
  const loc = useLocale();
  const { start } = monthGrid(month);
  const today = localDay();
  const minsByDay = new Map<string, number>();
  for (const e of entries) minsByDay.set(e.day, (minsByDay.get(e.day) ?? 0) + (e.workedMinutes ?? 0));
  const approved = approvedDays ?? new Set(entries.filter((e) => e.dayApproved).map((e) => e.day));
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  // Drop a trailing week that is entirely next month.
  const shown = cells[35].getMonth() !== month.getMonth() ? cells.slice(0, 35) : cells;
  const monthMin = entries
    .filter((e) => new Date(`${e.day}T12:00:00`).getMonth() === month.getMonth())
    .reduce((a, e) => a + (e.workedMinutes ?? 0), 0);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft />
        </Button>
        <span className="font-medium">{loc.date(month, { month: "long", year: "numeric" })}</span>
        <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight />
        </Button>
        <Button variant="outline" size="sm" onClick={() => { onMonth(monthStart(new Date())); onSelect(today); }}>
          {loc.date(new Date(), { day: "numeric", month: "short" })}
        </Button>
        <span className="ml-auto font-mono text-sm">{(monthMin / 60).toFixed(2)}h</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {[1, 2, 3, 4, 5, 6, 0].map((w) => (
          <span key={w}>{loc.weekday(w, "short")}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {shown.map((d) => {
          const key = localDay(d);
          const mins = minsByDay.get(key);
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              className={cn(
                "flex min-h-14 flex-col items-start rounded-md border border-transparent p-1.5 text-left transition-colors hover:bg-muted/60",
                !inMonth && "opacity-40",
                mins != null && "bg-primary/10",
                approved.has(key) && "bg-emerald-500/15",
                key === today && "border-primary/60",
                key === selected && "ring-2 ring-primary",
              )}
            >
              <span className="flex w-full items-center text-xs">
                {d.getDate()}
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
    </div>
  );
}
