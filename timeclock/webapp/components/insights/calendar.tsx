"use client";

import * as React from "react";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { dayKey, hhmm, hours, localParts, type Slice, type SliceEntry } from "@/lib/insights";
import { cn } from "@/lib/utils";
import { seriesVar, useWidth } from "./charts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The 6-week Mon-start grid covering a month (YYYY-MM). */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1, 12));
  const offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) =>
    new Date(Date.UTC(y, m - 1, 1 - offset + i, 12)).toISOString().slice(0, 10),
  );
}

function ShiftLine({ e, slice }: { e: SliceEntry; slice: Slice }) {
  const p = slice.employees.find((x) => x.id === e.employeeId);
  const flagged = e.fraudFlags.includes("no_door_access");
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesVar(p?.slot ?? 0) }} />
      <span className="w-28 truncate font-medium">{p?.displayName ?? "?"}</span>
      <span className="flex-1 font-mono text-xs text-muted-foreground">
        {hhmm(localParts(e.clockIn).minute)} → {e.clockOut ? hhmm(localParts(e.clockOut).minute) : "on shift"}
      </span>
      {flagged && (
        <span className="flex items-center gap-1 text-xs text-[var(--warning-color)]">
          <AlertTriangle className="size-3.5" /> no swipe
        </span>
      )}
      {e.edited && <span className="text-xs text-muted-foreground">edited</span>}
      <span className="w-14 text-right font-mono text-xs tabular-nums">{hours(e.workedMinutes)}</span>
    </li>
  );
}

/**
 * Month view: each day lists who worked (colour + name + hours; flagged
 * shifts carry a warning icon). Tap a day for its shifts and roster.
 */
export function MonthCalendar({ month, slice }: { month: string; slice: Slice }) {
  const days = monthGrid(month);
  const today = dayKey(new Date());
  const [open, setOpen] = useState<string | null>(null);
  const byDay = new Map<string, SliceEntry[]>();
  for (const e of slice.entries) byDay.set(dayKey(e.clockIn), [...(byDay.get(dayKey(e.clockIn)) ?? []), e]);
  const nameOf = (id: string) => slice.employees.find((p) => p.id === id);

  const perPerson = (es: SliceEntry[]) => {
    const m = new Map<string, { min: number; flagged: boolean }>();
    for (const e of es) {
      const cur = m.get(e.employeeId) ?? { min: 0, flagged: false };
      m.set(e.employeeId, { min: cur.min + e.workedMinutes, flagged: cur.flagged || e.fraudFlags.includes("no_door_access") });
    }
    return [...m.entries()];
  };
  const openEntries = open ? (byDay.get(open) ?? []) : [];
  const openRoster = open ? slice.rosters.filter((r) => r.shiftDate === open) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-card px-1 py-1 text-center text-[11px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((d) => {
          const inMonth = d.startsWith(month);
          const es = byDay.get(d) ?? [];
          const total = es.reduce((a, e) => a + e.workedMinutes, 0);
          return (
            <button
              key={d}
              type="button"
              onClick={() => setOpen(open === d ? null : d)}
              className={cn(
                "flex min-h-20 flex-col items-stretch gap-0.5 bg-card p-1 text-left transition-colors hover:bg-accent sm:min-h-24",
                !inMonth && "opacity-40",
                open === d && "ring-2 ring-inset ring-[var(--primary)]",
              )}
              aria-label={`${d}: ${es.length} shift(s), ${hours(total)}`}
            >
              <span className={cn("text-xs", d === today && "font-bold text-[var(--primary)]")}>{Number(d.slice(8))}</span>
              {perPerson(es)
                .slice(0, 3)
                .map(([id, v]) => (
                  <span key={id} className="flex items-center gap-1 truncate text-[10px] leading-tight sm:text-[11px]">
                    <span className="size-2 shrink-0 rounded-sm" style={{ background: seriesVar(nameOf(id)?.slot ?? 0) }} />
                    <span className="truncate">{nameOf(id)?.displayName}</span>
                    {v.flagged && <AlertTriangle className="size-3 shrink-0 text-[var(--warning-color)]" aria-label="no door swipe" />}
                    <span className="ml-auto hidden tabular-nums text-muted-foreground sm:inline">{(v.min / 60).toFixed(1)}</span>
                  </span>
                ))}
              {perPerson(es).length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{perPerson(es).length - 3} more</span>
              )}
            </button>
          );
        })}
      </div>

      {open && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="font-medium">
              {new Date(`${open}T12:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })}
            </span>
            <span className="text-sm text-muted-foreground">
              {hours(openEntries.reduce((a, e) => a + e.workedMinutes, 0))} total
            </span>
          </div>
          {openEntries.length === 0 && <p className="text-sm text-muted-foreground">Nobody clocked in.</p>}
          <ul className="divide-y divide-border">
            {openEntries.map((e) => (
              <ShiftLine key={e.id} e={e} slice={slice} />
            ))}
          </ul>
          {openRoster.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              Rostered:{" "}
              {openRoster
                .map((r) => `${nameOf(r.employeeId)?.displayName} ${hhmm(r.startMin)}–${hhmm(r.endMin)}`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Week timeline: one row per person, shifts as bars across Mon–Sun on a
 * 24h-per-day track; rostered shifts sit behind as hollow outlines.
 */
export function WeekTimeline({ weekStart, slice }: { weekStart: string; slice: Slice }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<{ x: number; y: number; body: React.ReactNode } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const ids = [...new Set([...slice.entries.map((e) => e.employeeId), ...slice.rosters.map((r) => r.employeeId)])];
  const people = slice.employees.filter((p) => ids.includes(p.id));
  const labelW = 72;
  const trackW = Math.max(0, width - labelW);
  const dayW = trackW / 7;
  const rowH = 30;
  const xOf = (day: string, minute: number) => {
    const i = days.indexOf(day);
    return i < 0 ? null : labelW + i * dayW + (minute / 1440) * dayW;
  };
  // A shift's bar may run past local midnight: width by its true duration.
  const pxPerMin = dayW / 1440;

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={people.length * rowH + 24} role="img" aria-label="Shifts this week by person">
          {days.map((d, i) => (
            <g key={d}>
              <line x1={labelW + i * dayW} x2={labelW + i * dayW} y1={0} y2={people.length * rowH} stroke="var(--border)" />
              <text x={labelW + i * dayW + dayW / 2} y={people.length * rowH + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                {WEEKDAYS[i]} {Number(d.slice(8))}
              </text>
            </g>
          ))}
          {people.map((p, row) => {
            const yTop = row * rowH;
            return (
              <g key={p.id}>
                <line x1={labelW} x2={width} y1={yTop + rowH} y2={yTop + rowH} stroke="var(--border)" />
                <text x={0} y={yTop + rowH / 2} dy="0.32em" className="fill-foreground text-[11px]">
                  {p.displayName.length > 10 ? `${p.displayName.slice(0, 9)}…` : p.displayName}
                </text>
                {slice.rosters
                  .filter((r) => r.employeeId === p.id)
                  .map((r) => {
                    const x = xOf(r.shiftDate, r.startMin);
                    if (x == null) return null;
                    return (
                      <rect
                        key={`r-${r.shiftDate}`}
                        x={x}
                        y={yTop + 5}
                        width={Math.max(2, (r.endMin - r.startMin) * pxPerMin)}
                        height={rowH - 10}
                        rx={4}
                        fill="none"
                        stroke="var(--muted-foreground)"
                        strokeWidth={1}
                        opacity={0.6}
                      />
                    );
                  })}
                {slice.entries
                  .filter((e) => e.employeeId === p.id)
                  .map((e) => {
                    const start = localParts(e.clockIn).minute;
                    const x = xOf(dayKey(e.clockIn), start);
                    if (x == null) return null;
                    const endMs = e.clockOut ? new Date(e.clockOut).getTime() : Date.now();
                    const w = Math.max(3, ((endMs - new Date(e.clockIn).getTime()) / 60_000) * pxPerMin);
                    const flagged = e.fraudFlags.includes("no_door_access");
                    const showTip = () =>
                      setTip({
                        x: x + w / 2,
                        y: yTop + 6,
                        body: (
                          <>
                            <div className="font-medium">
                              {p.displayName} · {dayKey(e.clockIn)}
                            </div>
                            <div className="font-mono">
                              {hhmm(start)} → {e.clockOut ? hhmm(localParts(e.clockOut).minute) : "on shift"} · {hours(e.workedMinutes)}
                            </div>
                            {flagged && <div className="text-[var(--warning-color)]">⚠ no door swipe before clock-in</div>}
                            {e.edited && <div className="text-muted-foreground">edited</div>}
                          </>
                        ),
                      });
                    return (
                      <rect
                        key={e.id}
                        x={x}
                        y={yTop + 7}
                        width={Math.min(w, width - x)}
                        height={rowH - 14}
                        rx={4}
                        fill={seriesVar(p.slot)}
                        stroke={flagged ? "var(--warning-color)" : "none"}
                        strokeWidth={flagged ? 2 : 0}
                        tabIndex={0}
                        aria-label={`${p.displayName} ${dayKey(e.clockIn)} ${hhmm(start)}, ${hours(e.workedMinutes)}${flagged ? ", no door swipe" : ""}`}
                        onMouseEnter={showTip}
                        onFocus={showTip}
                        onBlur={() => setTip(null)}
                        className="outline-none"
                      />
                    );
                  })}
              </g>
            );
          })}
        </svg>
      )}
      {people.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No shifts this week.</p>}
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.body}
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">Filled bar = worked · outline = rostered · amber edge = no door swipe</p>
    </div>
  );
}
