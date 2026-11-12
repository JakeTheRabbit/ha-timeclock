"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Pencil, Plus } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import {
  EditEntryDialog,
  localDay,
  suggestMissingDay,
  typicalFrom,
  type EntryRow,
} from "@/components/entries/edit-entry-dialog";
import { HourDots, liveMinutes, MonthCalendar, monthGrid, monthStart } from "@/components/entries/month-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const FLAG_LABELS: Record<string, string> = {
  no_door_access: "No door swipe",
  offline_queued: "Offline punch",
};

const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");

/** Manager edit screen: any employee's month on a calendar, edited a day at a time (audited). */
export default function ManagerEntriesPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selected, setSelected] = useState<string | null>(localDay());
  const [editing, setEditing] = useState<{ day: string; focusId?: string; addNew?: boolean } | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["manager-entries"] });
    qc.invalidateQueries({ queryKey: ["review-days"] });
  };
  const canSee = session && ["lead", "manager", "admin"].includes(session.employee.role);

  // Deep link from Review / dashboard: ?employeeId=…&day=YYYY-MM-DD[&edit=1].
  const [editOnLoad, setEditOnLoad] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const emp = q.get("employeeId");
    const day = q.get("day");
    if (emp) setEmployeeId(emp);
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setSelected(day);
      setMonth(monthStart(new Date(`${day}T12:00:00`)));
      if (q.get("edit") === "1") setEditOnLoad(day);
    }
  }, []);

  const { start, end } = useMemo(() => monthGrid(month), [month]);
  const people = useQuery({
    queryKey: ["manager-employees"],
    queryFn: () => apiGet<{ employees: { id: string; displayName: string; active: boolean }[] }>("/manager/employees"),
    enabled: !!canSee,
  });
  const list = useQuery({
    queryKey: ["manager-entries", employeeId, start.toISOString()],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(
        `/manager/entries?employeeId=${employeeId}&from=${start.toISOString()}&to=${end.toISOString()}`,
      ),
    enabled: !!employeeId,
  });

  const entries = useMemo(() => list.data?.entries ?? [], [list.data]);
  const typical = useMemo(() => typicalFrom(entries), [entries]);
  // Days newest first; start/finishes inside a day in time order.
  const days = useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const e of entries) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, es]) => ({ day, entries: es.sort((a, b) => +new Date(a.clockIn) - +new Date(b.clockIn)) }));
  }, [entries]);
  // Open the day editor once that day's entries have loaded.
  useEffect(() => {
    if (!editOnLoad || !list.data) return;
    const es = days.find((d) => d.day === editOnLoad)?.entries ?? [];
    setEditing(es.length ? { day: editOnLoad, focusId: es[0].id } : { day: editOnLoad, addNew: true });
    setEditOnLoad(null);
  }, [editOnLoad, list.data, days]);

  const flagged = useMemo(
    () => new Set(entries.filter((e) => e.clockOut == null || e.fraudFlags.length > 0).map((e) => e.day)),
    [entries],
  );

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!canSee) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Access denied</CardTitle>
            <CardDescription>Lead role or above required.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const selDay = days.find((d) => d.day === selected);
  const dayCard = ({ day, entries: es }: { day: string; entries: EntryRow[] }, highlight = false) => {
    const approved = es.some((e) => e.dayApproved);
    const flags = [...new Set(es.flatMap((e) => e.fraudFlags))];
    return (
      <Card key={day} className={highlight ? "border-primary/60" : undefined}>
        <CardContent className="flex flex-col gap-2">
          <button type="button" className="flex flex-wrap items-center gap-2 text-left" onClick={() => setSelected(day)}>
            <span className="font-medium">{loc.date(`${day}T12:00:00`, { weekday: "short", day: "numeric", month: "short" })}</span>
            {approved && (
              <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">
                <CircleCheck className="size-3" /> Day approved
              </Badge>
            )}
            {es.some((e) => e.edited) && <Badge className="border-transparent bg-amber-500/15 text-amber-300">Edited</Badge>}
            {es.some((e) => e.paidAt) && <Badge className="border-transparent bg-emerald-500/15 text-emerald-300">Paid</Badge>}
            {flags.map((f) => (
              <Badge key={f} className="border-transparent bg-destructive/15 text-destructive">
                {FLAG_LABELS[f] ?? f}
              </Badge>
            ))}
            <span className="ml-auto font-mono text-sm">{hrs(es.reduce((a, e) => a + liveMinutes(e), 0))}</span>
          </button>
          <HourDots day={day} entries={es} />
          <div className="flex flex-col gap-0.5 font-mono text-sm text-muted-foreground">
            {es.map((e) => (
              <span key={e.id}>
                {loc.time(e.clockIn)} → {e.clockOut ? loc.time(e.clockOut) : "still clocked in"}
                {e.breaks.length > 0 && ` · ${e.breaks.length} break${e.breaks.length > 1 ? "s" : ""}`}
                <span className="ml-2">{hrs(liveMinutes(e))}</span>
              </span>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="self-start" onClick={() => setEditing({ day, focusId: es[0]?.id })}>
            <Pencil /> Edit day
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <Select value={employeeId ?? undefined} onValueChange={setEmployeeId}>
        <SelectTrigger aria-label="Select employee">
          <SelectValue placeholder="Select an employee…" />
        </SelectTrigger>
        <SelectContent>
          {people.data?.employees
            .filter((p) => p.active)
            .map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.displayName}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      {employeeId && (
        <>
          <MonthCalendar
            month={month}
            onMonth={setMonth}
            entries={entries}
            selected={selected}
            onSelect={setSelected}
            flaggedDays={flagged}
          />

          {list.isLoading && <Skeleton className="h-40 w-full rounded-xl" />}

          {!list.isLoading && selected && (
            selDay ? (
              dayCard(selDay, true)
            ) : (
              <Card className="border-primary/60">
                <CardContent className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{loc.date(`${selected}T12:00:00`, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="text-sm text-muted-foreground">No time recorded.</span>
                  <Button size="sm" className="ml-auto" onClick={() => setEditing({ day: selected, addNew: true })}>
                    <Plus /> Add time
                  </Button>
                </CardContent>
              </Card>
            )
          )}

          <Button
            variant="outline"
            className="self-start"
            onClick={() => {
              const day = suggestMissingDay(entries, typical);
              setSelected(day);
              setEditing({ day, addNew: true });
            }}
          >
            <Plus /> Add missed time
          </Button>

          {days.filter((d) => d.day !== selected).map((d) => dayCard(d))}
        </>
      )}

      {editing && (
        <EditEntryDialog
          entries={days.find((d) => d.day === editing.day)?.entries ?? []}
          focusId={editing.focusId}
          addNew={editing.addNew}
          defaultDay={editing.day}
          typical={typical}
          mode="manager"
          employeeId={employeeId ?? undefined}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
