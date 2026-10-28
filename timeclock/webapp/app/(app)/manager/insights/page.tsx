"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { tzOffset } from "@/lib/tz";
import {
  dailyMinutes,
  dayKey,
  daysBetween,
  describeActivity,
  heatmap,
  hhmm,
  hours,
  money,
  totals,
  workerStats,
  type Slice,
  type WorkerStats,
} from "@/lib/insights";
import { DailyHoursChart, Legend, OnSiteHeatmap, StatTile, seriesVar } from "@/components/insights/charts";
import { MonthCalendar, WeekTimeline } from "@/components/insights/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ---- facility-day maths (YYYY-MM-DD strings, instants at local midnight) ----
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const midnight = (day: string) => new Date(`${day}T00:00:00${tzOffset(new Date(`${day}T12:00:00Z`))}`);
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const nextMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1, 12)).toISOString().slice(0, 10);
};
const prevMonth = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1, 12)).toISOString().slice(0, 10);
};

const PRESETS = {
  thisWeek: "This week",
  lastWeek: "Last week",
  last30: "Last 30 days",
  thisMonth: "This month",
  lastMonth: "Last month",
  last90: "Last 90 days",
} as const;
type Preset = keyof typeof PRESETS;

function presetRange(p: Preset): { from: string; to: string } {
  const today = dayKey(new Date());
  const tomorrow = addDays(today, 1);
  switch (p) {
    case "thisWeek":
      return { from: mondayOf(today), to: tomorrow };
    case "lastWeek":
      return { from: addDays(mondayOf(today), -7), to: mondayOf(today) };
    case "thisMonth":
      return { from: monthStart(today), to: tomorrow };
    case "lastMonth":
      return { from: prevMonth(today), to: monthStart(today) };
    case "last90":
      return { from: addDays(today, -89), to: tomorrow };
    default:
      return { from: addDays(today, -29), to: tomorrow };
  }
}

function useSlice(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["insights", from, to],
    queryFn: () =>
      apiGet<Slice>(`/manager/insights?from=${midnight(from).toISOString()}&to=${midnight(to).toISOString()}`),
    enabled,
    placeholderData: keepPreviousData, // hold the last render on refetch, no skeleton flash
    refetchInterval: 60_000,
  });
}

type Tab = "overview" | "calendar" | "timeline" | "activity";

/** Manager dashboard: stats, charts, calendar, timeline and activity. */
export default function InsightsPage() {
  const { session, isLoading } = useSession();
  const canSee = !!session && ["lead", "manager", "admin"].includes(session.employee.role);
  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState<Preset>("last30");
  const [month, setMonth] = useState(() => monthStart(dayKey(new Date())));
  const [week, setWeek] = useState(() => mondayOf(dayKey(new Date())));

  const range = useMemo(() => presetRange(preset), [preset]);
  const overview = useSlice(range.from, range.to, canSee && (tab === "overview" || tab === "activity"));
  const monthQ = useSlice(addDays(month, -7), addDays(nextMonth(month), 7), canSee && tab === "calendar");
  const weekQ = useSlice(week, addDays(week, 7), canSee && tab === "timeline");

  if (isLoading)
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  if (!canSee)
    return (
      <div className="mx-auto w-full max-w-5xl p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Access denied</CardTitle>
            <CardDescription>Lead role or above required.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      {/* One filter row above everything it scopes */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto">
          {(tab === "overview" || tab === "activity") && (
            <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
              <SelectTrigger aria-label="Date range" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PRESETS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {tab === "calendar" && (
            <Stepper
              label={new Date(`${month}T12:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", month: "long", year: "numeric" })}
              onPrev={() => setMonth(prevMonth(month))}
              onNext={() => setMonth(nextMonth(month))}
              onToday={() => setMonth(monthStart(dayKey(new Date())))}
            />
          )}
          {tab === "timeline" && (
            <Stepper
              label={`Week of ${new Date(`${week}T12:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", day: "numeric", month: "short" })}`}
              onPrev={() => setWeek(addDays(week, -7))}
              onNext={() => setWeek(addDays(week, 7))}
              onToday={() => setWeek(mondayOf(dayKey(new Date())))}
            />
          )}
        </div>
      </div>

      {tab === "overview" && <Overview q={overview} range={range} />}
      {tab === "calendar" && (
        <Loaded q={monthQ}>{(s) => <MonthCalendar month={month.slice(0, 7)} slice={s} />}</Loaded>
      )}
      {tab === "timeline" && (
        <Loaded q={weekQ}>
          {(s) => (
            <Card>
              <CardContent>
                <WeekTimeline weekStart={week} slice={s} />
              </CardContent>
            </Card>
          )}
        </Loaded>
      )}
      {tab === "activity" && <Loaded q={overview}>{(s) => <Activity slice={s} />}</Loaded>}
    </div>
  );
}

function Stepper({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label="Previous" onClick={onPrev}>
        <ChevronLeft />
      </Button>
      <span className="min-w-36 text-center text-sm font-medium">{label}</span>
      <Button variant="ghost" size="icon" aria-label="Next" onClick={onNext}>
        <ChevronRight />
      </Button>
      <Button variant="secondary" size="sm" onClick={onToday}>
        Today
      </Button>
    </div>
  );
}

function Loaded({ q, children }: { q: ReturnType<typeof useSlice>; children: (s: Slice) => React.ReactNode }) {
  if (q.isError) return <p className="text-sm text-destructive">Couldn&apos;t load data.</p>;
  if (!q.data) return <Skeleton className="h-64 w-full rounded-xl" />;
  return <div className={q.isFetching && q.isPlaceholderData ? "opacity-60 transition-opacity" : ""}>{children(q.data)}</div>;
}

function Overview({ q, range }: { q: ReturnType<typeof useSlice>; range: { from: string; to: string } }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Loaded q={q}>
      {(s) => {
        const stats = workerStats(s);
        const t = totals(stats, s.withPay);
        const days = daysBetween(range.from, range.to);
        const daily = dailyMinutes(s, days);
        const people = stats.map((x) => x.employee).sort((a, b) => a.slot - b.slot);
        const dayLabel = (d: string) =>
          days.length <= 14
            ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric" })
            : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-NZ", { timeZone: "UTC", day: "numeric", month: "short" });
        const onShift = stats.filter((x) => x.onShiftNow).length;
        return (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Hours worked" value={hours(t.minutes)} hint={`${t.shifts} shifts · ${t.people} people`} />
              <StatTile label="Average shift" value={hours(t.avgShiftMin)} hint={onShift ? `${onShift} on shift now` : undefined} />
              <StatTile
                label="No door swipe"
                value={String(t.noDoorSwipe)}
                hint={`${t.edits} edited · ${t.late} late`}
                tone={t.noDoorSwipe ? "warn" : undefined}
              />
              {s.withPay ? (
                <StatTile label="Labour cost" value={money(t.costCents)} hint="pay-tracked staff with a rate" />
              ) : (
                <StatTile label="Days covered" value={String(new Set(s.entries.map((e) => dayKey(e.clockIn))).size)} />
              )}
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">Hours per day</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setView(view === "chart" ? "table" : "chart")}>
                  {view === "chart" ? "Table" : "Chart"}
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {view === "chart" ? (
                  <>
                    <DailyHoursChart days={days} data={daily} people={people} dayLabel={dayLabel} />
                    <Legend people={people} />
                  </>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Day</TableHead>
                          {people.map((p) => (
                            <TableHead key={p.id} className="text-right">
                              {p.displayName}
                            </TableHead>
                          ))}
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {days
                          .filter((d) => (daily.get(d)?.size ?? 0) > 0)
                          .map((d) => (
                            <TableRow key={d}>
                              <TableCell>{dayLabel(d)}</TableCell>
                              {people.map((p) => (
                                <TableCell key={p.id} className="text-right font-mono tabular-nums">
                                  {daily.get(d)?.get(p.id) ? hours(daily.get(d)!.get(p.id)!) : ""}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-mono tabular-nums">
                                {hours([...daily.get(d)!.values()].reduce((a, m) => a + m, 0))}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">When people are on site</CardTitle>
                <CardDescription>Person-hours by weekday and hour over the range</CardDescription>
              </CardHeader>
              <CardContent>
                <OnSiteHeatmap grid={heatmap(s)} />
              </CardContent>
            </Card>

            <WorkersTable stats={stats} withPay={s.withPay} />
          </div>
        );
      }}
    </Loaded>
  );
}

type SortKey = "name" | "minutes" | "shifts" | "avgShift" | "avgStart" | "flags" | "cost";

function WorkersTable({ stats, withPay }: { stats: WorkerStats[]; withPay: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "minutes", desc: true });
  const val = (s: WorkerStats): number | string => {
    switch (sort.key) {
      case "name":
        return s.employee.displayName.toLowerCase();
      case "shifts":
        return s.shifts;
      case "avgShift":
        return s.avgShiftMin ?? -1;
      case "avgStart":
        return s.avgStartMin ?? -1;
      case "flags":
        return s.noDoorSwipe + s.late;
      case "cost":
        return s.costCents ?? -1;
      default:
        return s.minutes;
    }
  };
  const rows = [...stats].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
  });
  const H = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <TableHead className={right ? "text-right" : undefined}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : k !== "name" })}
        aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}
      >
        {children}
        {sort.key === k && (sort.desc ? "↓" : "↑")}
      </button>
    </TableHead>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workers</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody clocked in during this range.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <H k="name">Person</H>
                <H k="minutes" right>Hours</H>
                <H k="shifts" right>Shifts</H>
                <H k="avgShift" right>Avg shift</H>
                <H k="avgStart" right>Avg start</H>
                <TableHead className="text-right">Breaks (paid / unpaid)</TableHead>
                <H k="flags" right>Flags</H>
                {withPay && <H k="cost" right>Cost</H>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.employee.id}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ background: seriesVar(s.employee.slot) }} />
                      {s.employee.displayName}
                      {s.onShiftNow && <span className="text-xs text-[var(--success-color)]">● on shift</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{hours(s.minutes)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {s.shifts}
                    <span className="text-muted-foreground"> / {s.daysWorked}d</span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{hours(s.avgShiftMin)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{hhmm(s.avgStartMin)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {s.paidBreakMin}m / {s.unpaidBreakMin}m
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex flex-wrap justify-end gap-x-2 text-xs">
                      {s.noDoorSwipe > 0 && (
                        <span className="inline-flex items-center gap-1 text-[var(--warning-color)]">
                          <AlertTriangle className="size-3" />
                          {s.noDoorSwipe} no swipe
                        </span>
                      )}
                      {s.late > 0 && <span className="text-muted-foreground">{s.late}/{s.rostered} late</span>}
                      {s.edits > 0 && <span className="text-muted-foreground">{s.edits} edited</span>}
                      {s.noDoorSwipe + s.late + s.edits === 0 && <span className="text-muted-foreground">—</span>}
                    </span>
                  </TableCell>
                  {withPay && <TableCell className="text-right font-mono tabular-nums">{money(s.costCents)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Activity({ slice }: { slice: Slice }) {
  if (slice.activity.length === 0) return <p className="text-sm text-muted-foreground">No activity in this range.</p>;
  return (
    <Card>
      <CardContent>
        <ul className="divide-y divide-border">
          {slice.activity.map((a, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">
                {new Date(a.at).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="text-sm">
                <span className="font-medium">{a.actor}</span> {describeActivity(a)}
                {a.reason && <span className="text-muted-foreground"> — “{a.reason}”</span>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
