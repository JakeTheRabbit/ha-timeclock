"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { hours, type SliceEmployee } from "@/lib/insights";
import { cn } from "@/lib/utils";

export const seriesVar = (slot: number) => `var(--series-${(slot % 8) + 1})`;

/** Measure a container's width (charts draw in real pixels, no stretched text). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-2xl font-semibold", tone === "warn" && "text-[var(--warning-color)]")}>{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** Colour key: swatch + name, always shown for ≥ 2 people. */
export function Legend({ people }: { people: SliceEmployee[] }) {
  if (people.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {people.map((p) => (
        <li key={p.id} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: seriesVar(p.slot) }} />
          {p.displayName}
        </li>
      ))}
    </ul>
  );
}

interface Tip {
  x: number;
  y: number;
  body: React.ReactNode;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      {tip.body}
    </div>
  );
}

/** Axis top + tick step on round hour values (4–5 gridlines). */
const niceScale = (v: number) => {
  const step = v <= 8 ? 2 : v <= 20 ? 5 : v <= 50 ? 10 : v <= 100 ? 20 : 50;
  return { max: Math.max(step, Math.ceil(v / step) * step), step };
};

/**
 * Hours per day, stacked by person (stable colour per person). Thin bars with
 * a 2px surface gap between segments, rounded data-end, hairline grid, one
 * y-axis. Hover/focus a bar for the day's breakdown.
 */
export function DailyHoursChart({
  days,
  data,
  people,
  dayLabel,
}: {
  days: string[];
  data: Map<string, Map<string, number>>;
  people: SliceEmployee[];
  dayLabel: (day: string) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const H = 200;
  const pad = { l: 34, r: 8, t: 8, b: 24 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const totalOf = (d: string) => [...(data.get(d)?.values() ?? [])].reduce((a, m) => a + m, 0) / 60;
  const { max, step } = niceScale(Math.max(0, ...days.map(totalOf)));
  const y = (h: number) => pad.t + H - (h / max) * H;
  const slotW = days.length ? plotW / days.length : 0;
  const barW = Math.max(3, Math.min(28, slotW * 0.6));
  const labelEvery = Math.ceil(days.length / Math.max(1, Math.floor(plotW / 48))); // ~48px per date label
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);

  const show = (d: string, cx: number) => {
    const rows = people
      .map((p) => ({ p, m: data.get(d)?.get(p.id) ?? 0 }))
      .filter((r) => r.m > 0);
    setTip({
      x: cx,
      y: y(totalOf(d)),
      body: (
        <>
          <div className="mb-1 font-medium">
            {dayLabel(d)} · {hours(Math.round(totalOf(d) * 60))}
          </div>
          {rows.length === 0 && <div className="text-muted-foreground">Nobody worked</div>}
          {rows.map((r) => (
            <div key={r.p.id} className="flex items-center gap-2">
              <span className="size-2 rounded-sm" style={{ background: seriesVar(r.p.slot) }} />
              <span className="flex-1">{r.p.displayName}</span>
              <span className="tabular-nums">{hours(r.m)}</span>
            </div>
          ))}
        </>
      ),
    });
  };

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={H + pad.t + pad.b} role="img" aria-label="Hours worked per day, stacked by person">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {t}h
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const cx = pad.l + slotW * i + slotW / 2;
            let acc = 0;
            const segs = people
              .map((p) => ({ p, h: (data.get(d)?.get(p.id) ?? 0) / 60 }))
              .filter((s) => s.h > 0);
            return (
              <g key={d}>
                {segs.map((s, j) => {
                  const top = y(acc + s.h);
                  const bottom = y(acc);
                  acc += s.h;
                  const last = j === segs.length - 1;
                  const h = Math.max(0, bottom - top - (j > 0 ? 2 : 0)); // 2px surface gap
                  const x = cx - barW / 2;
                  const r = last ? Math.min(4, barW / 2, h) : 0;
                  return (
                    <path
                      key={s.p.id}
                      fill={seriesVar(s.p.slot)}
                      d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                    />
                  );
                })}
                {/* hit area: whole column, bigger than the mark */}
                <rect
                  x={pad.l + slotW * i}
                  y={pad.t}
                  width={slotW}
                  height={H}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${dayLabel(d)}: ${hours(Math.round(totalOf(d) * 60))}`}
                  onMouseEnter={() => show(d, cx)}
                  onFocus={() => show(d, cx)}
                  onBlur={() => setTip(null)}
                  className="outline-none focus-visible:fill-[var(--border)]"
                />
                {i % labelEvery === 0 && (
                  <text x={cx} y={pad.t + H + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">
                    {dayLabel(d)}
                  </text>
                )}
              </g>
            );
          })}
          <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.5} />
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * When people are on site: total person-hours per weekday × hour, one-hue
 * ramp from the card surface to blue, with a scale legend.
 */
export function OnSiteHeatmap({ grid }: { grid: number[][] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const max = Math.max(1, ...grid.flat());
  const padL = 34;
  const cell = width > 0 ? (width - padL) / 24 : 0;
  const ch = Math.max(14, Math.min(26, cell));
  const fill = (v: number) =>
    v <= 0 ? "var(--muted)" : `color-mix(in oklab, var(--seq-high) ${Math.round(15 + (v / max) * 85)}%, var(--card))`;

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={ch * 7 + 22} role="img" aria-label="Person-hours on site by weekday and hour">
          {grid.map((row, wd) => (
            <g key={wd}>
              <text x={padL - 6} y={wd * ch + ch / 2} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
                {WEEKDAYS[wd]}
              </text>
              {row.map((v, h) => (
                <rect
                  key={h}
                  x={padL + h * cell + 1}
                  y={wd * ch + 1}
                  width={Math.max(0, cell - 2)}
                  height={ch - 2}
                  rx={2}
                  fill={fill(v)}
                  tabIndex={v > 0 ? 0 : -1}
                  aria-label={`${WEEKDAYS[wd]} ${h}:00: ${(v / 60).toFixed(1)} person-hours`}
                  onMouseEnter={() =>
                    setTip({
                      x: padL + h * cell + cell / 2,
                      y: wd * ch,
                      body: (
                        <>
                          <div className="font-medium">
                            {WEEKDAYS[wd]} {String(h).padStart(2, "0")}:00–{String((h + 1) % 24).padStart(2, "0")}:00
                          </div>
                          <div className="tabular-nums">{(v / 60).toFixed(1)} person-hours</div>
                        </>
                      ),
                    })
                  }
                  className="outline-none focus-visible:stroke-[var(--primary)]"
                />
              ))}
            </g>
          ))}
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <text key={h} x={padL + h * cell} y={ch * 7 + 14} className="fill-muted-foreground text-[10px]">
              {String(h).padStart(2, "0")}
            </text>
          ))}
        </svg>
      )}
      <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
        <span>0</span>
        <span
          className="h-2 w-28 rounded-sm"
          style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--seq-high) 15%, var(--card)), var(--seq-high))" }}
        />
        <span>{(max / 60).toFixed(1)} person-h</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}
