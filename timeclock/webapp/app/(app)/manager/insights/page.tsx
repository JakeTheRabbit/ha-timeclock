"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, X } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { entriesHref } from "@/lib/links";
import { tzOffset } from "@/lib/tz";
import {
  dailyMinutes,
  dayKey,
  daysBetween,
  delta,
  describeActivity,
  filterSlice,
  heatmap,
  hhmm,
  hours,
  totals,
  weekStartOf,
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

function presetRange(p: Preset, weekStart: 0 | 1): { from: string; to: string } {
  const today = dayKey(new Date());
  const tomorrow = addDays(today, 1);
  const week = weekStartOf(today, weekStart);
  switch (p) {
    case "thisWeek":
      return { from: week, to: tomorrow };
    case "lastWeek":
      return { from: addDays(week, -7), to: week };
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
  const loc = useLocale();
  const router = useRouter();
  const canSee = !!session && ["lead", "manager", "admin"].includes(session.employee.role);
  const [tab, setTab] = useState<Tab>("overview");
  const [preset, setPreset] = useState<Preset>("last30");
  const [month, setMonth] = useState(() => monthStart(dayKey(new Date())));
  const [weekAnchor, setWeekAnchor] = useState(() => dayKey(new Date())); // any day in the shown week
  const [personId, setPersonId] = useState<string | null>(null);
  const [calOpen, setCalOpen] = useState<string | null>(null);
  const week = weekStartOf(weekAnchor, loc.weekStart);

  const range = useMemo(() => presetRange(preset, loc.weekStart), [preset, loc.weekStart]);
  // Previous equal-length period, for the ▲/▼ on every headline number.
  const prevRange = useMemo(() => {
    const len = daysBetween(range.from, range.to).length;
    return { from: addDays(range.from, -len), to: range.from };
  }, [range]);
  const overview = useSlice(range.from, range.to, canSee && (tab === "overview" || tab === "activity"));
  const prev = useSlice(prevRange.from, prevRange.to, canSee && tab === "overview");
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

  const person = [overview.data, monthQ.data, weekQ.data]
    .find((s) => s)
    ?.employees.find((e) => e.id === personId);
  const openDay = (day: string) => {
    if (personId) return router.push(entriesHref(personId, day));
    setMonth(monthStart(day));
    setCalOpen(day);
    setTab("calendar");
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      {/* One filter row above everything it scopes */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Tabs value={tab} onValueChange={(v) => {
            setTab(v as Tab);
            setCalOpen(null);
          }}className="w-full sm:w-auto">
          <TabsList className="grid w-full grid-cols-4 sm:inline-flex sm:w-fit">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {personId && (
            <Button variant="secondary" size="sm" onClick={() => setPersonId(null)} aria-label="Show everyone">
              Showing: {person?.displayName ?? "1 person"} <X />
            </Button>
          )}
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
              label={loc.date(`${month}T12:00:00Z`, { timeZone: "UTC", month: "long", year: "numeric" })}
              onPrev={() => setMonth(prevMonth(month))}
              onNext={() => setMonth(nextMonth(month))}
              onToday={() => setMonth(monthStart(dayKey(new Date())))}
            />
          )}
          {tab === "timeline" && (
            <Stepper
              label={`Week of ${loc.date(`${week}T12:00:00Z`, { timeZone: "UTC", day: "numeric", month: "short" })}`}
              onPrev={() => setWeekAnchor(addDays(weekAnchor, -7))}
              onNext={() => setWeekAnchor(addDays(weekAnchor, 7))}
              onToday={() => setWeekAnchor(dayKey(new Date()))}
            />
          )}
        </div>
      </div>

      {tab === "overview" && (
        <Overview
          q={overview}
          prev={prev.data}
          range={range}
          personId={personId}
          onPerson={(id) => setPersonId(personId === id ? null : id)}
          onDay={openDay}
        />
      )}
      {tab === "calendar" && (
        <Loaded q={monthQ}>
          {(s) => <MonthCalendar month={month.slice(0, 7)} slice={filterSlice(s, personId)} initialOpen={calOpen} />}
        </Loaded>
      )}
      {tab === "timeline" && (
        <Loaded q={weekQ}>
          {(s) => (
            <Card>
              <CardContent>
                <WeekTimeline weekStart={week} slice={filterSlice(s, personId)} />
              </CardContent>
            </Card>
          )}
        </Loaded>
      )}
      {tab === "activity" && <Loaded q={overview}>{(s) => <Activity slice={filterSlice(s, personId)} />}</Loaded>}
    </div>
  );
}

function Stepper({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div className="flex w-full items-center gap-1 sm:w-auto">
      <Button variant="ghost" size="icon" aria-label="Previous" onClick={onPrev}>
        <ChevronLeft />
      </Button>
      <span className="min-w-0 flex-1 truncate text-center text-sm font-medium sm:min-w-36 sm:flex-none">{label}</span>
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

function Overview({
  q,
  prev,
  range,
  personId,
  onPerson,
  onDay,
}: {
  q: ReturnType<typeof useSlice>;
  prev: Slice | undefined;
  range: { from: string; to: string };
  personId: string | null;
  onPerson: (id: string) => void;
  onDay: (day: string) => void;
}) {
  const loc = useLocale();
  const router = useRouter();
  const [view, setView] = useState<"chart" | "table">("chart");
  const money = (cents: number | null | undefined) => (cents == null ? "—" : loc.money(cents / 100));
  return (
    <Loaded q={q}>
      {(full) => {
        const s = filterSlice(full, personId);
        const stats = workerStats(s);
        const t = totals(stats, s.withPay);
        const ps = prev ? filterSlice(prev, personId) : null;
        const pt = ps ? totals(workerStats(ps), ps.withPay) : null;
        const days = daysBetween(range.from, range.to);
        const daily = dailyMinutes(s, days);
        const people = stats.map((x) => x.employee).sort((a, b) => a.slot - b.slot);
        const dayLabel = (d: string) =>
          days.length <= 14
            ? loc.date(`${d}T12:00:00Z`, { timeZone: "UTC", weekday: "short", day: "numeric" })
            : loc.date(`${d}T12:00:00Z`, { timeZone: "UTC", day: "numeric", month: "short" });
        const onShift = stats.filter((x) => x.onShiftNow).length;
        const covered = (sl: Slice) => new Set(sl.entries.map((e) => dayKey(e.clockIn))).size;
        const activeDays = days.filter((d) => (daily.get(d)?.size ?? 0) > 0);
        const dayTotal = (d: string) => [...daily.get(d)!.values()].reduce((a, m) => a + m, 0);
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile
                  label="Hours worked"
                  value={hours(t.minutes)}
                  hint={`${t.shifts} shifts · ${t.people} people`}
                  change={pt && delta(t.minutes, pt.minutes)}
                  prev={pt ? hours(pt.minutes) : undefined}
                />
                <StatTile
                  label="Average shift"
                  value={hours(t.avgShiftMin)}
                  hint={onShift ? `${onShift} on shift now` : undefined}
                  change={pt && delta(t.avgShiftMin, pt.avgShiftMin)}
                  prev={pt ? hours(pt.avgShiftMin) : undefined}
                />
                <StatTile
                  label="No door swipe"
                  value={String(t.noDoorSwipe)}
                  hint={`${t.edits} edited · ${t.late} late`}
                  tone={t.noDoorSwipe ? "warn" : undefined}
                  change={pt && delta(t.noDoorSwipe, pt.noDoorSwipe)}
                  prev={pt ? `${pt.noDoorSwipe} (${pt.edits} edited · ${pt.late} late)` : undefined}
                  upIsBad
                />
                {s.withPay ? (
                  <StatTile
                    label="Labour cost"
                    value={money(t.costCents)}
                    hint="pay-tracked staff with a rate"
                    change={pt && delta(t.costCents, pt.costCents)}
                    prev={pt ? money(pt.costCents) : undefined}
                  />
                ) : (
                  <StatTile
                    label="Days covered"
                    value={String(covered(s))}
                    change={ps && delta(covered(s), covered(ps))}
                    prev={ps ? String(covered(ps)) : undefined}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                ▲/▼ vs the previous {days.length} days (
                {loc.date(`${addDays(range.from, -days.length)}T12:00:00Z`, { timeZone: "UTC", day: "numeric", month: "short" })}–
                {loc.date(`${addDays(range.from, -1)}T12:00:00Z`, { timeZone: "UTC", day: "numeric", month: "short" })})
              </p>
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
                    <DailyHoursChart
                      days={days}
                      data={daily}
                      people={people}
                      dayLabel={dayLabel}
                      onDay={onDay}
                      onSegment={(d, id) => router.push(entriesHref(id, d))}
                    />
                    <Legend people={people} />
                  </>
                ) : (
                  <>
                    {/* phones: one card per day */}
                    <ul className="flex flex-col gap-2 sm:hidden">
                      {activeDays.map((d) => (
                        <li key={d} className="rounded-lg border border-border p-2">
                          <button type="button" className="flex w-full items-baseline justify-between text-sm" onClick={() => onDay(d)}>
                            <span className="font-medium">{dayLabel(d)}</span>
                            <span className="font-mono tabular-nums">{hours(dayTotal(d))}</span>
                          </button>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                            {people
                              .filter((p) => daily.get(d)?.get(p.id))
                              .map((p) => (
                                <Link key={p.id} href={entriesHref(p.id, d)} className="flex items-center gap-1 hover:underline">
                                  <span className="size-2 rounded-sm" style={{ background: seriesVar(p.slot) }} />
                                  {p.displayName}
                                  <span className="font-mono tabular-nums text-muted-foreground">{hours(daily.get(d)!.get(p.id)!)}</span>
                                </Link>
                              ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden overflow-x-auto sm:block">
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
                          {activeDays.map((d) => (
                            <TableRow key={d}>
                              <TableCell>
                                <button type="button" className="hover:underline" onClick={() => onDay(d)}>
                                  {dayLabel(d)}
                                </button>
                              </TableCell>
                              {people.map((p) => (
                                <TableCell key={p.id} className="text-right font-mono tabular-nums">
                                  {daily.get(d)?.get(p.id) ? (
                                    <Link href={entriesHref(p.id, d)} className="hover:underline">
                                      {hours(daily.get(d)!.get(p.id)!)}
                                    </Link>
                                  ) : (
                                    ""
                                  )}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-mono tabular-nums">{hours(dayTotal(d))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
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

            <WorkersTable stats={stats} withPay={s.withPay} money={money} personId={personId} onPerson={onPerson} />
          </div>
        );
      }}
    </Loaded>
  );
}

type SortKey = "name" | "minutes" | "shifts" | "avgShift" | "avgStart" | "flags" | "cost";

function Flags({ s }: { s: WorkerStats }) {
  return (
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
  );
}

function WorkersTable({
  stats,
  withPay,
  money,
  personId,
  onPerson,
}: {
  stats: WorkerStats[];
  withPay: boolean;
  money: (cents: number | null | undefined) => string;
  personId: string | null;
  onPerson: (id: string) => void;
}) {
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
  const Name = ({ s }: { s: WorkerStats }) => (
    <span className="flex items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-sm" style={{ background: seriesVar(s.employee.slot) }} />
      <span className="truncate font-medium">{s.employee.displayName}</span>
      {s.onShiftNow && <span className="shrink-0 text-xs text-[var(--success-color)]">● on shift</span>}
    </span>
  );
  const pickLabel = (s: WorkerStats) =>
    personId === s.employee.id ? `Show everyone` : `Show only ${s.employee.displayName}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workers</CardTitle>
        <CardDescription>Tap a person to filter the whole page to them</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody clocked in during this range.</p>
        ) : (
          <>
            {/* phones: one card per person */}
            <ul className="flex flex-col gap-2 sm:hidden">
              {rows.map((s) => (
                <li key={s.employee.id}>
                  <button
                    type="button"
                    onClick={() => onPerson(s.employee.id)}
                    aria-label={pickLabel(s)}
                    className="flex w-full flex-col gap-1 rounded-lg border border-border p-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <Name s={s} />
                      <span className="shrink-0 font-mono tabular-nums">{hours(s.minutes)}</span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>
                        {s.shifts} shifts / {s.daysWorked}d
                      </span>
                      <span>avg {hours(s.avgShiftMin)}</span>
                      <span>starts {hhmm(s.avgStartMin)}</span>
                      <span>
                        breaks {s.paidBreakMin}m / {s.unpaidBreakMin}m
                      </span>
                      {withPay && <span>{money(s.costCents)}</span>}
                    </span>
                    <span className="flex justify-start">
                      <Flags s={s} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
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
                    <TableRow key={s.employee.id} className="cursor-pointer" onClick={() => onPerson(s.employee.id)}>
                      <TableCell>
                        <button type="button" aria-label={pickLabel(s)} className="hover:underline">
                          <Name s={s} />
                        </button>
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
                        <Flags s={s} />
                      </TableCell>
                      {withPay && <TableCell className="text-right font-mono tabular-nums">{money(s.costCents)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Activity({ slice }: { slice: Slice }) {
  const loc = useLocale();
  if (slice.activity.length === 0) return <p className="text-sm text-muted-foreground">No activity in this range.</p>;
  return (
    <Card>
      <CardContent>
        <ul className="divide-y divide-border">
          {slice.activity.map((a, i) => (
            <li key={i} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground">
                {loc.dateTime(a.at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
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
