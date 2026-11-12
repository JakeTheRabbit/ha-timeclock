"use client";

import Link from "next/link";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, CircleCheck, MessageCircleQuestion, Pencil, Plus, Send } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import {
  EditEntryDialog,
  Textarea,
  errMsg,
  daysBetween,
  localDay,
  recentWindow,
  suggestMissingDay,
  typicalForDay,
  typicalFrom,
  useHolidayDays,
  type EntryRow,
} from "@/components/entries/edit-entry-dialog";
import {
  HourDots,
  liveMinutes,
  MonthCalendar,
  monthGrid,
  monthStart,
  shiftTime,
} from "@/components/entries/month-calendar";
import { useSession } from "@/hooks/use-session";
import { fmtH } from "@/hooks/use-clock-context";
import { usualWeekMin } from "@/lib/clock-context";
import { useLocale } from "@/lib/format";
import { groupByWeek, weekStartDay } from "@/lib/pay-helpers";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type TFn = (key: MessageKey, vars?: TVars) => string;

export interface ModRow {
  id: string;
  day: string;
  kind: "entry_add" | "entry_edit" | "entry_remove" | "break_add" | "break_edit" | "break_remove";
  reason: string;
  status: "pending" | "acknowledged" | "disputed" | "resolved";
  createdAt: string;
  messages: { id: string; authorId: string; authorName: string; body: string; createdAt: string }[];
}

interface MyCorrection {
  id: string;
  day: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  reviewedAt: string | null;
}

const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");

const breaksLabel = (e: EntryRow, t: TFn) =>
  e.breaks.length === 0
    ? "—"
    : e.breaks
        .map(
          (b) =>
            `${b.autoDeducted ? t("myHours.breakAuto") : ""}${b.paid ? t("myHours.breakPaid") : t("myHours.breakUnpaid")} ${
              b.endAt
                ? Math.round((+new Date(b.endAt) - +new Date(b.startAt)) / 60000) + "m"
                : t("myHours.breakOpen")
            }`,
        )
        .join(", ");

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

/** A dispute from the manager, with the conversation and a reply box. */
function DisputeCard({
  mod,
  myId,
  onSent,
  onOpenDay,
}: {
  mod: ModRow;
  myId: string;
  onSent: () => void;
  onOpenDay: (day: string) => void;
}) {
  const t = useT();
  const loc = useLocale();
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => apiPost(`/review/modifications/${mod.id}/messages`, { body: text }),
    onSuccess: () => {
      setText("");
      toast.success(t("toast.replySent"));
      onSent();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 p-3">
      <div className="text-sm font-medium">
        {t("myHours.disputeAbout", { day: loc.date(`${mod.day}T12:00:00`), what: t(`myHours.kind.${mod.kind}` as MessageKey) })}
      </div>
      <div className="text-xs text-muted-foreground">{t("myHours.yourReason", { reason: mod.reason })}</div>
      <div className="flex flex-col gap-2">
        {mod.messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              m.authorId === myId ? "self-end bg-primary/15" : "self-start bg-muted"
            }`}
          >
            <div className="text-xs text-muted-foreground">
              {m.authorName} · {loc.dateTime(m.createdAt)}
            </div>
            {m.body}
          </div>
        ))}
      </div>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("myHours.replyPlaceholder")}
        className="min-h-14"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onOpenDay(mod.day)}>
          <Pencil /> {t("myHours.openDay")}
        </Button>
        <Button size="sm" className="ml-auto" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()}>
          <Send /> {t("myHours.send")}
        </Button>
      </div>
    </div>
  );
}

export default function MyHoursPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const t = useT();
  const loc = useLocale();
  const fmtT = (s: string) => loc.time(s);
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [selected, setSelected] = useState<string | null>(localDay());
  const [editing, setEditing] = useState<{ day: string; focusId?: string; addNew?: boolean } | null>(null);

  const { start: from, end: to } = useMemo(() => monthGrid(month, loc.weekStart), [month, loc.weekStart]);
  const list = useQuery({
    queryKey: ["my-hours", from.toISOString()],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(`/entries/mine?from=${from.toISOString()}&to=${to.toISOString()}`),
    enabled: !!session,
  });
  const review = useQuery({
    queryKey: ["my-review", from.toISOString()],
    queryFn: () =>
      apiGet<{ approvedDays: string[]; modifications: ModRow[] }>(
        `/review/mine?from=${localDay(new Date(from.getTime() - 86400_000))}&to=${localDay(to)}`,
      ),
    enabled: !!session,
  });
  const disputes = useQuery({
    queryKey: ["my-disputes"],
    queryFn: () => apiGet<{ modifications: ModRow[] }>("/review/mine/disputes"),
    enabled: !!session,
    refetchInterval: 60_000,
  });
  const myCorrections = useQuery({
    queryKey: ["my-corrections", from.toISOString()],
    queryFn: () =>
      apiGet<{ corrections: MyCorrection[] }>(`/corrections/mine?from=${localDay(from)}&to=${localDay(to)}`),
    enabled: !!session,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-hours"] });
    qc.invalidateQueries({ queryKey: ["my-review"] });
    qc.invalidateQueries({ queryKey: ["my-disputes"] });
    qc.invalidateQueries({ queryKey: ["my-corrections"] });
  };

  // Smart defaults learn from the last 28 days, skip leave + public holidays,
  // and use the rostered shift on a day that has one.
  const recentWin = useMemo(() => recentWindow(), []);
  const recent = useQuery({
    queryKey: ["my-hours", "recent", recentWin.from.toISOString()],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(
        `/entries/mine?from=${recentWin.from.toISOString()}&to=${new Date().toISOString()}`,
      ),
    enabled: !!session,
  });
  const myLeave = useQuery({
    queryKey: ["leave-mine"],
    queryFn: () =>
      apiGet<{ requests: { startDate: string; endDate: string; status: string }[] }>("/leave/mine"),
    enabled: !!session,
  });
  const roster = useQuery({
    queryKey: ["my-roster", localDay(from)],
    queryFn: () =>
      apiGet<{ shifts: { shiftDate: string; startMin: number; endMin: number }[] }>(
        `/roster/mine?from=${localDay(from)}&to=${localDay(to)}`,
      ),
    enabled: !!session,
  });
  const holidayDays = useHolidayDays(!!session);

  const entries = useMemo(() => list.data?.entries ?? [], [list.data]);
  const recentEntries = useMemo(() => recent.data?.entries ?? entries, [recent.data, entries]);
  const typical = useMemo(() => typicalFrom(recentEntries), [recentEntries]);
  const leaveDays = useMemo(
    () =>
      new Set(
        (myLeave.data?.requests ?? [])
          .filter((r) => r.status === "approved")
          .flatMap((r) => daysBetween(r.startDate, r.endDate)),
      ),
    [myLeave.data],
  );
  const holidaySet = useMemo(() => new Set(holidayDays), [holidayDays]);
  const skipDays = useMemo(() => new Set([...holidaySet, ...leaveDays]), [holidaySet, leaveDays]);
  const shiftOn = (day: string) => roster.data?.shifts.find((s) => s.shiftDate === day);
  // Usual week = average worked day (last 28 days) × usual workdays.
  const usualWeek = useMemo(() => {
    const today = localDay();
    const past = recentEntries.filter((e) => e.day < today && e.workedMinutes != null);
    return usualWeekMin(
      past.map((e) => ({ day: e.day, minutes: e.workedMinutes! })),
      typical.weekdays.length,
    );
  }, [recentEntries, typical]);

  // Group by facility day, newest first; entries inside a day oldest first.
  const days = useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const e of entries) m.set(e.day, [...(m.get(e.day) ?? []), e]);
    return [...m.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, es]) => ({ day, entries: es.sort((a, b) => +new Date(a.clockIn) - +new Date(b.clockIn)) }));
  }, [entries]);
  // Day cards grouped by week, the selected day's week first (and expanded,
  // with the selected day on top); other weeks collapse to a subtotal row.
  const selectedWeek = selected ? weekStartDay(`${selected}T12:00:00`, loc.weekStart) : null;
  const weeks = useMemo(() => {
    const g = groupByWeek(days, (d) => `${d.day}T12:00:00`, loc.weekStart);
    const sel = g.filter((w) => w.week === selectedWeek);
    for (const w of sel) w.rows = [...w.rows.filter((d) => d.day === selected), ...w.rows.filter((d) => d.day !== selected)];
    return [...sel, ...g.filter((w) => w.week !== selectedWeek)];
  }, [days, loc.weekStart, selected, selectedWeek]);
  // Weeks the user flipped from their default (selected = open, others = closed).
  const [toggledWeeks, setToggledWeeks] = useState<Set<string>>(new Set());
  useEffect(() => setToggledWeeks(new Set()), [selectedWeek]);
  const toggleWeek = (w: string) =>
    setToggledWeeks((s) => {
      const n = new Set(s);
      if (!n.delete(w)) n.add(w);
      return n;
    });
  // "Open this day" from a dispute: jump the calendar there, then open the
  // editor once that month's entries are in.
  const [editOnLoad, setEditOnLoad] = useState<string | null>(null);
  const openDay = (day: string) => {
    setSelected(day);
    setMonth(monthStart(new Date(`${day}T12:00:00`)));
    setEditOnLoad(day);
  };
  useEffect(() => {
    if (!editOnLoad || !list.data || list.isFetching) return;
    const es = days.find((d) => d.day === editOnLoad)?.entries ?? [];
    setEditing(es.length ? { day: editOnLoad, focusId: es[0].id } : { day: editOnLoad, addNew: true });
    setEditOnLoad(null);
  }, [editOnLoad, list.data, list.isFetching, days]);

  const pendingByDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of review.data?.modifications ?? []) if (x.status === "pending") m.set(x.day, (m.get(x.day) ?? 0) + 1);
    return m;
  }, [review.data]);

  // One correction badge per day: a pending one wins, else the latest decided
  // in the last 14 days (newest first from the API).
  const correctionByDay = useMemo(() => {
    const m = new Map<string, MyCorrection>();
    const recent = Date.now() - 14 * 86400_000;
    for (const c of myCorrections.data?.corrections ?? []) {
      if (c.status !== "pending" && (!c.reviewedAt || +new Date(c.reviewedAt) < recent)) continue;
      const cur = m.get(c.day);
      if (!cur || (c.status === "pending" && cur.status !== "pending")) m.set(c.day, c);
    }
    return m;
  }, [myCorrections.data]);

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-11 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </Container>
    );

  if (!session)
    return (
      <Container>
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">{t("common.notSignedIn")}</p>
            <Button asChild variant="secondary">
              <Link href="/pin">{t("common.pinSignIn")}</Link>
            </Button>
          </CardContent>
        </Card>
      </Container>
    );

  const renderDay = ({ day, entries: es }: { day: string; entries: EntryRow[] }) => {
    const approved = es.some((e) => e.dayApproved);
    const dayMin = es.reduce((a, e) => a + liveMinutes(e), 0);
    const waiting = pendingByDay.get(day) ?? 0;
    const corr = correctionByDay.get(day);
    // Approved day with several start/finishes: pick which one to correct.
    const pickEntry = approved && es.length > 1;
    return (
      <Card key={day} className={day === selected ? "border-primary/60" : undefined}>
        <CardContent className="flex flex-col gap-3">
          <button type="button" className="flex flex-wrap items-center gap-2 text-left" onClick={() => setSelected(day)}>
            <span className="font-medium">{loc.date(`${day}T12:00:00`, { weekday: "short", day: "numeric", month: "short" })}</span>
            {approved ? (
              <StatusBadge status="approved">
                <CircleCheck className="size-3" /> {t("myHours.dayApproved")}
              </StatusBadge>
            ) : (
              <Badge variant="secondary">{t("myHours.dayOpen")}</Badge>
            )}
            {waiting > 0 && (
              <StatusBadge status="pending">
                {t(waiting === 1 ? "myHours.changesWaiting.one" : "myHours.changesWaiting.other", { n: waiting })}
              </StatusBadge>
            )}
            {corr && (
              <StatusBadge
                status={corr.status === "pending" ? "pending" : corr.status === "approved" ? "approved" : "declined"}
              >
                {t(
                  corr.status === "pending"
                    ? "myHours.correctionPending"
                    : corr.status === "approved"
                      ? "myHours.correctionApproved"
                      : "myHours.correctionDeclined",
                )}
              </StatusBadge>
            )}
            <span className="ml-auto font-mono text-sm">{hrs(dayMin)}</span>
          </button>
          {corr?.reviewNote && (
            <p className="text-xs text-muted-foreground">{t("myHours.correctionNote", { note: corr.reviewNote })}</p>
          )}

          <HourDots day={day} entries={es} />

          <div className="flex flex-col gap-1">
            {es.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 font-mono text-sm">
                {fmtT(e.clockIn)} → {e.clockOut ? fmtT(e.clockOut) : t("myHours.breakOpen")}
                <span className="text-muted-foreground">{hrs(liveMinutes(e))}</span>
                <span className="font-sans text-xs text-muted-foreground">
                  {t("myHours.breaks", { value: breaksLabel(e, t) })}
                  {e.job && <> · {e.job.name}</>}
                </span>
                {e.edited && <StatusBadge status="edited" className="font-sans" />}
                {e.paidAt && <StatusBadge status="paid" className="font-sans" />}
                {pickEntry && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="ml-auto min-h-11 font-sans sm:min-h-8"
                    onClick={() => setEditing({ day, focusId: e.id })}
                  >
                    <Pencil /> {t("myHours.fixThis")}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {!pickEntry && (
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 self-start sm:min-h-9"
              onClick={() => setEditing({ day, focusId: es[0]?.id })}
            >
              <Pencil /> {t("myHours.fixTimes")}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Container>
      {(disputes.data?.modifications.length ?? 0) > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircleQuestion className="size-5 text-amber-600 dark:text-amber-400" /> {t("myHours.disputesTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {disputes.data!.modifications.map((m) => (
              <DisputeCard key={m.id} mod={m} myId={session.employee.id} onSent={refresh} onOpenDay={openDay} />
            ))}
          </CardContent>
        </Card>
      )}

      <MonthCalendar
        month={month}
        onMonth={setMonth}
        entries={entries}
        selected={selected}
        onSelect={setSelected}
        approvedDays={new Set(review.data?.approvedDays ?? [])}
        flaggedDays={
          new Set([
            ...pendingByDay.keys(),
            ...(disputes.data?.modifications.map((m) => m.day) ?? []),
            ...correctionByDay.keys(),
          ])
        }
        leaveDays={leaveDays}
        holidayDays={holidaySet}
        usualWeekdays={recent.isSuccess ? typical.weekdays : undefined}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11"
          onClick={() => {
            const day = suggestMissingDay(recentEntries, typical, skipDays);
            setSelected(day);
            setEditing({ day, addNew: true });
          }}
        >
          <Plus /> {t("myHours.addShift")}
        </Button>
        <p className="flex-1 text-xs text-muted-foreground">{t("myHours.editHint")}</p>
      </div>

      {list.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!list.isLoading && selected && !days.some((d) => d.day === selected) && (
        <Card className="border-primary/60">
          <CardContent className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{loc.date(`${selected}T12:00:00`, { weekday: "short", day: "numeric", month: "short" })}</span>
            <span className="text-sm text-muted-foreground">
              {(() => {
                const s = shiftOn(selected);
                if (s) return t("myHours.rosteredShift", { time: `${shiftTime(loc, s.startMin)}–${shiftTime(loc, s.endMin)}` });
                return selected > localDay() ? t("myHours.nothingRostered") : t("myHours.nothingRecorded");
              })()}
            </span>
            {selected <= localDay() && (
              <Button size="sm" className="ml-auto" onClick={() => setEditing({ day: selected, addNew: true })}>
                <Plus /> {t("myHours.addTime")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {weeks.map(({ week, rows }) => {
        const open = (week === selectedWeek) !== toggledWeeks.has(week);
        const weekMin = rows.reduce((a, d) => a + d.entries.reduce((b, e) => b + liveMinutes(e), 0), 0);
        return (
          <React.Fragment key={week}>
            <button
              type="button"
              className="flex min-h-11 items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-muted/60"
              aria-expanded={open}
              onClick={() => toggleWeek(week)}
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              <span className="font-medium">{t("myHours.weekOf", { date: loc.date(`${week}T12:00:00`, { day: "numeric", month: "short" }) })}</span>
              {!open && (
                <span className="text-xs text-muted-foreground">
                  {t(rows.length === 1 ? "myHours.weekDays.one" : "myHours.weekDays.other", { n: rows.length })}
                </span>
              )}
              <span className="ml-auto font-mono">
                {usualWeek
                  ? t("myHours.weekTotal", { worked: fmtH(t, loc, weekMin), usual: fmtH(t, loc, usualWeek) })
                  : fmtH(t, loc, weekMin)}
              </span>
            </button>
            {open && rows.map((d) => renderDay(d))}
          </React.Fragment>
        );
      })}

      {editing && (
        <EditEntryDialog
          entries={days.find((d) => d.day === editing.day)?.entries ?? []}
          focusId={editing.focusId}
          addNew={editing.addNew}
          defaultDay={editing.day}
          typical={typicalForDay(typical, shiftOn(editing.day))}
          mode="self"
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Container>
  );
}
