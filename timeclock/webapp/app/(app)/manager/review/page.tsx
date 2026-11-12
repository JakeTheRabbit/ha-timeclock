"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCheck, CircleCheck, MessageCircleQuestion, Pencil, Send, Undo2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { entriesHref } from "@/lib/links";
import { useT, type MessageKey } from "@/lib/i18n";
import { errMsg, localDay, Textarea, typicalFrom, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { HourDots, liveMinutes } from "@/components/entries/month-calendar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, STATUS_TEXT } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Kind = "entry_add" | "entry_edit" | "entry_remove" | "break_add" | "break_edit" | "break_remove";
type Status = "pending" | "acknowledged" | "disputed" | "resolved";

interface Mod {
  id: string;
  employeeId: string;
  employeeName: string;
  day: string;
  kind: Kind;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  status: Status;
  createdAt: string;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  disputedByName: string | null;
  resolvedByName: string | null;
  messages: { id: string; authorId: string; authorName: string; body: string; createdAt: string }[];
}

interface DaySummary {
  day: string;
  entries: EntryRow[];
  workedMinutes: number;
  hasOpen: boolean;
  approved: { at: string; by: string } | null;
  pendingMods: number;
  disputedMods: number;
  /** Rostered shifts, facility-local minutes from midnight. */
  rostered: { startMin: number; endMin: number }[];
}
interface PersonDays {
  employeeId: string;
  employeeName: string;
  days: DaySummary[];
}

const KIND: Record<Kind, MessageKey> = {
  entry_add: "myHours.kind.entry_add",
  entry_edit: "myHours.kind.entry_edit",
  entry_remove: "myHours.kind.entry_remove",
  break_add: "myHours.kind.break_add",
  break_edit: "myHours.kind.break_edit",
  break_remove: "myHours.kind.break_remove",
};

const hrs = (min: number) => (min / 60).toFixed(2) + "h";
const signedHrs = (min: number) => (min >= 0 ? "+" : "−") + hrs(Math.abs(min));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const dayMin = (d: DaySummary) => d.entries.reduce((s, e) => s + liveMinutes(e), 0);
const breakMin = (d: DaySummary) =>
  d.entries.reduce(
    (s, e) =>
      s + e.breaks.reduce((t, b) => t + ((b.endAt ? +new Date(b.endAt) : Date.now()) - +new Date(b.startAt)) / 60_000, 0),
    0,
  );
/** Median worked minutes of the person's finished days — their usual day length. */
function usualMin(days: DaySummary[]): number | null {
  const xs = days.filter((d) => !d.hasOpen && d.workedMinutes > 0).map((d) => d.workedMinutes).sort((a, b) => a - b);
  return xs.length >= 3 ? xs[Math.floor(xs.length / 2)] : null;
}
/** Can be approved as-is (same skip rules as the server, plus "no time"). */
const isReady = (d: DaySummary) => !d.approved && !d.hasOpen && d.disputedMods === 0 && d.entries.length > 0;
/** Monday (YYYY-MM-DD) of the week containing `day`. */
function weekOf(day: string) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return localDay(d);
}
const SKIP: Record<string, MessageKey> = {
  open_entry: "review.skip.open_entry",
  dispute_open: "review.skip.dispute_open",
  already_approved: "review.skip.already_approved",
};
const REOPEN_CHIPS: MessageKey[] = ["review.chip.fix", "review.chip.asked", "review.chip.mistake"];

function useSpan() {
  const loc = useLocale();
  const t = useT();
  return (v: Record<string, unknown> | null): string => {
    if (!v) return "—";
    const a = (v.clockIn ?? v.startAt) as string | undefined;
    const b = (v.clockOut ?? v.endAt) as string | null | undefined;
    if (!a) return "—";
    const span = `${loc.time(a)} → ${b ? loc.time(b) : t("common.open")}`;
    const extra = "paid" in v ? ` (${v.paid ? t("myHours.breakPaid") : t("myHours.breakUnpaid")})` : "";
    const n = Array.isArray(v.breaks) ? v.breaks.length : 0;
    const brks = n ? ` · ${t(n === 1 ? "review.breaks.one" : "review.breaks.other", { n })}` : "";
    return span + extra + brks;
  };
}

function ModCard({ mod, myId, grouped }: { mod: Mod; myId: string; grouped?: boolean }) {
  const qc = useQueryClient();
  const t = useT();
  const loc = useLocale();
  const span = useSpan();
  const [disputing, setDisputing] = useState(false);
  const [text, setText] = useState("");
  const done = () => {
    setText("");
    setDisputing(false);
    qc.invalidateQueries({ queryKey: ["review-mods"] });
    qc.invalidateQueries({ queryKey: ["review-days"] });
    qc.invalidateQueries({ queryKey: ["review-open-count"] });
    qc.invalidateQueries({ queryKey: ["my-disputes"] });
  };
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiPost(`/review/modifications/${mod.id}/${path}`, body),
    onSuccess: done,
    onError: (e) => toast.error(errMsg(e, t)),
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!grouped && (
          <>
            <Link href={entriesHref(mod.employeeId, mod.day)} className="font-medium underline-offset-4 hover:underline">
              {mod.employeeName}
            </Link>
            <Link href={entriesHref(mod.employeeId, mod.day)} className="text-muted-foreground underline-offset-4 hover:underline">
              {loc.date(`${mod.day}T12:00:00`)}
            </Link>
          </>
        )}
        <Badge variant="secondary">{t(KIND[mod.kind])}</Badge>
        <StatusBadge status={mod.status} />
        <span className="ml-auto text-xs text-muted-foreground">{loc.dateTime(mod.createdAt)}</span>
      </div>
      <div className="font-mono text-sm">
        {mod.before && <span className="text-muted-foreground line-through">{span(mod.before)}</span>}
        {mod.before && mod.after && <span className="px-2">⇒</span>}
        {mod.after && <span>{span(mod.after)}</span>}
      </div>
      <div className="rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">{t("review.reason")} </span>
        {mod.reason}
      </div>
      {mod.status === "acknowledged" && mod.acknowledgedByName && (
        <div className="text-xs text-muted-foreground">{t("review.seenBy", { name: mod.acknowledgedByName })}</div>
      )}

      {mod.messages.length > 0 && (
        <div className="flex flex-col gap-2">
          {mod.messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.authorId === myId ? "self-end bg-primary/15" : "self-start bg-muted"}`}
            >
              <div className="text-xs text-muted-foreground">
                {m.authorName} · {loc.dateTime(m.createdAt)}
              </div>
              {m.body}
            </div>
          ))}
        </div>
      )}

      {mod.status === "pending" && !disputing && (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={act.isPending} onClick={() => act.mutate({ path: "acknowledge", body: {} })}>
            <Check /> {t("review.acknowledge")}
          </Button>
          <Button variant="destructive" onClick={() => setDisputing(true)}>
            <MessageCircleQuestion /> {t("review.dispute")}
          </Button>
        </div>
      )}
      {(disputing || mod.status === "disputed") && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-14"
            placeholder={disputing ? t("review.disputePlaceholder", { name: mod.employeeName }) : t("review.replyPlaceholder")}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {disputing ? (
              <>
                <Button variant="secondary" onClick={() => setDisputing(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={text.trim().length < 3 || act.isPending}
                  onClick={() => act.mutate({ path: "dispute", body: { message: text } })}
                >
                  <Send /> {t("review.sendDispute")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  disabled={!text.trim() || act.isPending}
                  onClick={() => act.mutate({ path: "messages", body: { body: text } })}
                >
                  <Send /> {t("review.reply")}
                </Button>
                <Button
                  disabled={act.isPending}
                  onClick={() => act.mutate({ path: "resolve", body: text.trim() ? { note: text } : {} })}
                >
                  <CheckCheck /> {t("review.resolve")}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One day for one person: hour strip, totals, breaks, roster, vs usual, and the action. */
function DayLine({
  employeeId,
  d,
  usual,
  isManager,
  busy,
  onApprove,
  onReopen,
}: {
  employeeId: string;
  d: DaySummary;
  usual: number | null;
  isManager: boolean;
  busy: boolean;
  onApprove: () => void;
  onReopen: () => void;
}) {
  const loc = useLocale();
  const t = useT();
  const worked = dayMin(d);
  const brk = Math.round(breakMin(d));
  const rostered = d.rostered.reduce((s, r) => s + r.endMin - r.startMin, 0);
  const delta = usual != null && !d.hasOpen && d.entries.length ? worked - usual : null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={entriesHref(employeeId, d.day)} className="font-medium underline-offset-4 hover:underline">
            {loc.date(`${d.day}T12:00:00`)}
          </Link>
          <span className="font-mono">{hrs(worked)}</span>
          {delta != null && Math.abs(delta) >= 1 && (
            <span
              className={`font-mono text-xs ${Math.abs(delta) >= 30 ? STATUS_TEXT.warning : "text-muted-foreground"}`}
              title={t("review.usualDay", { h: hrs(usual!) })}
            >
              {t("review.vsUsual", { delta: signedHrs(delta) })}
            </span>
          )}
          {d.approved && (
            <StatusBadge status="approved">{t("review.approvedBy", { name: d.approved.by })}</StatusBadge>
          )}
          {d.pendingMods > 0 && (
            <StatusBadge status="pending">{t("review.toCheck", { n: d.pendingMods })}</StatusBadge>
          )}
          {d.disputedMods > 0 && (
            <StatusBadge status="disputed">{t("review.nDisputed", { n: d.disputedMods })}</StatusBadge>
          )}
          {d.hasOpen && <StatusBadge status="open" />}
        </div>
        {d.entries.length > 0 && <HourDots day={d.day} entries={d.entries} compact />}
        <div className="font-mono text-xs text-muted-foreground">
          {d.entries.map((e) => `${loc.time(e.clockIn)}–${e.clockOut ? loc.time(e.clockOut) : t("common.open")}`).join("  ·  ") || "—"}
          {brk > 0 && `  ·  ${t("review.breakMin", { n: brk })}`}
          {d.rostered.length > 0 && (
            <span title={t("review.rosteredTotal", { h: hrs(rostered) })}>
              {"  ·  "}
              {t("review.rosteredList", { list: d.rostered.map((r) => `${hhmm(r.startMin)}–${hhmm(r.endMin)}`).join(", ") })}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <Button asChild variant="ghost" size="sm" aria-label={t("review.editDay")}>
          <Link href={entriesHref(employeeId, d.day, true)}>
            <Pencil />
          </Link>
        </Button>
        {d.approved ? (
          isManager && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onReopen}>
              <Undo2 /> {t("review.reopen")}
            </Button>
          )
        ) : d.hasOpen ? (
          // Say why it can't be approved, and where to fix it.
          <Button asChild variant="outline" size="sm">
            <Link href={entriesHref(employeeId, d.day, true)}>{t("review.stillIn")}</Link>
          </Button>
        ) : d.disputedMods > 0 ? (
          <span className="self-center text-xs text-destructive">{t("review.disputeOpen")}</span>
        ) : d.entries.length === 0 ? (
          <span className="self-center text-xs text-muted-foreground">{t("review.noTime")}</span>
        ) : (
          <Button size="sm" disabled={busy} onClick={onApprove}>
            <CircleCheck /> {t("review.approve")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Reason for taking an approval back (the employee can edit the day again). */
function ReopenDialog({
  target,
  busy,
  onClose,
  onConfirm,
}: {
  target: { name: string; day: string } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const loc = useLocale();
  const t = useT();
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("review.reopenTitle")}</DialogTitle>
          <DialogDescription>
            {target && `${target.name} · ${loc.date(`${target.day}T12:00:00`)}. `}
            {t("review.reopenBody")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {REOPEN_CHIPS.map((k) => t(k)).map((c) => (
            <Button key={c} type="button" variant={reason === c ? "default" : "outline"} size="sm" onClick={() => setReason(c)}>
              {c}
            </Button>
          ))}
        </div>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-16"
          placeholder={t("review.reopenPlaceholder")}
          aria-label={t("review.reasonAria")}
        />
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setReason("");
              onClose();
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!ok || busy}
            onClick={() => {
              onConfirm(reason.trim());
              setReason("");
            }}
          >
            <Undo2 /> {t("review.reopen")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Timesheet review: (1) every change staff made to their own times, each with
 * their reason, grouped by person then day — tick Acknowledge (read it) or
 * Dispute (opens a conversation); (2) approve days, which locks them against
 * further staff edits. Defaults to everyone, last two pay periods.
 */
export default function ReviewPage() {
  const qc = useQueryClient();
  const t = useT();
  const loc = useLocale();
  const { session, isLoading } = useSession();
  const canSee = session && ["lead", "manager", "admin"].includes(session.employee.role);
  const isManager = !!session && ["manager", "admin"].includes(session.employee.role);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [employeeId, setEmployeeId] = useState<string>("all");
  const [dayView, setDayView] = useState<"todo" | "all">("todo");
  const [reopen, setReopen] = useState<{ employeeId: string; name: string; day: string } | null>(null);

  const mods = useQuery({
    queryKey: ["review-mods", filter],
    queryFn: () => apiGet<{ modifications: Mod[] }>(`/review/modifications?status=${filter}`),
    enabled: !!canSee,
    refetchInterval: 30_000,
  });
  // Everyone's days; the person picker filters client-side so staff-change
  // groups can always show the day's strip.
  const days = useQuery({
    queryKey: ["review-days", "all"],
    queryFn: () => apiGet<{ from: string; to: string; people: PersonDays[] }>("/review/days/all"),
    enabled: !!canSee,
  });

  const refreshDays = () => {
    qc.invalidateQueries({ queryKey: ["review-days"] });
    qc.invalidateQueries({ queryKey: ["manager-entries"] });
  };
  const refreshMods = () => {
    qc.invalidateQueries({ queryKey: ["review-mods"] });
    qc.invalidateQueries({ queryKey: ["review-days"] });
    qc.invalidateQueries({ queryKey: ["review-open-count"] });
  };
  const names = useMemo(
    () => new Map((days.data?.people ?? []).map((p) => [p.employeeId, p.employeeName])),
    [days.data],
  );
  // One call per person (the endpoint takes one employee); results pooled.
  const approve = useMutation({
    mutationFn: async (items: { employeeId: string; days: string[] }[]) => {
      const out = { approved: 0, skipped: [] as { name: string; day: string; reason: string }[] };
      for (const it of items) {
        const r = await apiPost<{ approved: string[]; skipped: { day: string; reason: string }[] }>("/review/days/approve", it);
        out.approved += r.approved.length;
        for (const s of r.skipped) out.skipped.push({ ...s, name: names.get(it.employeeId) ?? "" });
      }
      return out;
    },
    onSuccess: (r) => {
      if (r.approved) toast.success(t(r.approved === 1 ? "review.approvedDays.one" : "review.approvedDays.other", { n: r.approved }));
      for (const s of r.skipped)
        toast.warning(`${s.name ? `${s.name}, ` : ""}${s.day}: ${SKIP[s.reason] ? t(SKIP[s.reason]) : s.reason}`);
      refreshDays();
    },
    onError: (e) => {
      toast.error(errMsg(e, t));
      refreshDays();
    },
  });
  const unapprove = useMutation({
    mutationFn: ({ employeeId: emp, day, reason }: { employeeId: string; day: string; reason: string }) =>
      apiPost("/review/days/unapprove", { employeeId: emp, day, reason }),
    onSuccess: () => {
      toast.success(t("review.unapproved"));
      setReopen(null);
      refreshDays();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });
  const ackAll = useMutation({
    mutationFn: async ({ ids, approveDay }: { ids: string[]; approveDay?: { employeeId: string; day: string } }) => {
      const r = await apiPost<{ acknowledged: number }>("/review/modifications/acknowledge", { ids });
      const a = approveDay
        ? await apiPost<{ approved: string[]; skipped: { day: string; reason: string }[] }>("/review/days/approve", {
            employeeId: approveDay.employeeId,
            days: [approveDay.day],
          })
        : null;
      return { ...r, approved: a?.approved.length ?? 0, skipped: a?.skipped ?? [] };
    },
    onSuccess: (r) => {
      const one = r.acknowledged === 1;
      toast.success(
        r.approved
          ? t(one ? "review.ackedApproved.one" : "review.ackedApproved.other", { n: r.acknowledged })
          : t(one ? "review.acked.one" : "review.acked.other", { n: r.acknowledged }),
      );
      for (const s of r.skipped) toast.warning(`${s.day}: ${SKIP[s.reason] ? t(SKIP[s.reason]) : s.reason}`);
      refreshMods();
      qc.invalidateQueries({ queryKey: ["manager-entries"] });
    },
    onError: (e) => {
      toast.error(errMsg(e, t));
      refreshMods();
    },
  });

  if (isLoading)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  if (!canSee)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">{t("mgr.accessDenied")}</CardTitle>
            <CardDescription>{t("mgr.leadRequired")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );

  const list = mods.data?.modifications ?? [];
  const pendingIds = list.filter((m) => m.status === "pending").map((m) => m.id);
  const dayByKey = new Map<string, DaySummary>();
  for (const p of days.data?.people ?? []) for (const d of p.days) dayByKey.set(`${p.employeeId}|${d.day}`, d);

  // Staff changes: person -> day.
  const modGroups = new Map<string, { employeeId: string; name: string; days: Map<string, Mod[]> }>();
  for (const m of list) {
    let g = modGroups.get(m.employeeId);
    if (!g) modGroups.set(m.employeeId, (g = { employeeId: m.employeeId, name: m.employeeName, days: new Map() }));
    g.days.set(m.day, [...(g.days.get(m.day) ?? []), m]);
  }
  const modPeople = [...modGroups.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Approve days: person -> week, filtered by picker and view.
  const people = (days.data?.people ?? [])
    .filter((p) => employeeId === "all" || p.employeeId === employeeId)
    .map((p) => {
      const shown = p.days.filter((d) => dayView === "all" || !d.approved);
      const weeks = new Map<string, DaySummary[]>();
      for (const d of shown) weeks.set(weekOf(d.day), [...(weeks.get(weekOf(d.day)) ?? []), d]);
      const typical = typicalFrom(p.days.flatMap((d) => d.entries));
      return { ...p, weeks, ready: p.days.filter(isReady), usual: usualMin(p.days), typical, hasWork: p.days.some((d) => d.entries.length) };
    })
    .filter((p) => p.weeks.size > 0);
  const allReady = people.filter((p) => p.ready.length).map((p) => ({ employeeId: p.employeeId, days: p.ready.map((d) => d.day) }));
  const allReadyCount = allReady.reduce((s, x) => s + x.days.length, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("mgr.staffChangesTitle")}</CardTitle>
          <CardDescription>{t("review.staffChangesHint")}</CardDescription>
          <CardAction>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as "open" | "all")}>
              <TabsList>
                <TabsTrigger value="open">{t("review.tabToCheck")}</TabsTrigger>
                <TabsTrigger value="all">{t("review.tabHistory")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mods.isLoading && <Skeleton className="h-24 w-full" />}
          {!mods.isLoading && list.length === 0 && (
            <p className="text-sm text-muted-foreground">{filter === "open" ? t("mgr.nothingToCheck") : t("review.noChanges")}</p>
          )}
          {pendingIds.length > 1 && modPeople.length > 1 && (
            <Button
              variant="secondary"
              className="self-start"
              disabled={ackAll.isPending}
              onClick={() => ackAll.mutate({ ids: pendingIds })}
            >
              <CheckCheck /> {t("review.ackAll", { n: pendingIds.length })}
            </Button>
          )}
          {modPeople.map((g) => {
            const personPending = [...g.days.values()].flat().filter((m) => m.status === "pending").map((m) => m.id);
            return (
              <section key={g.employeeId} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={entriesHref(g.employeeId)} className="font-medium underline-offset-4 hover:underline">
                    {g.name}
                  </Link>
                  {personPending.length > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="ml-auto"
                      disabled={ackAll.isPending}
                      onClick={() => ackAll.mutate({ ids: personPending })}
                    >
                      <CheckCheck /> {t("review.ackAllFor", { name: g.name, n: personPending.length })}
                    </Button>
                  )}
                </div>
                {[...g.days.entries()]
                  .sort(([a], [b]) => (a < b ? 1 : -1))
                  .map(([day, ms]) => {
                    const d = dayByKey.get(`${g.employeeId}|${day}`);
                    const dayPending = ms.filter((m) => m.status === "pending").map((m) => m.id);
                    // After acknowledging, the day is approvable if nothing else blocks it.
                    const canAckApprove = !!d && dayPending.length > 0 && isReady(d);
                    return (
                      <div key={day} className="flex flex-col gap-2 border-l-2 border-border pl-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Link
                            href={entriesHref(g.employeeId, day)}
                            className="text-muted-foreground underline-offset-4 hover:underline"
                          >
                            {loc.date(`${day}T12:00:00`)}
                          </Link>
                          {d && <span className="font-mono">{hrs(dayMin(d))}</span>}
                          {d?.approved && (
                            <StatusBadge status="approved" />
                          )}
                          {canAckApprove && (
                            <Button
                              size="sm"
                              className="ml-auto"
                              disabled={ackAll.isPending}
                              onClick={() => ackAll.mutate({ ids: dayPending, approveDay: { employeeId: g.employeeId, day } })}
                            >
                              <CircleCheck /> {t("review.ackApproveDay")}
                            </Button>
                          )}
                        </div>
                        {d && d.entries.length > 0 && <HourDots day={day} entries={d.entries} compact />}
                        {ms.map((m) => (
                          <ModCard key={m.id} mod={m} myId={session.employee.id} grouped />
                        ))}
                      </div>
                    );
                  })}
              </section>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("review.approveDaysTitle")}</CardTitle>
          <CardDescription>
            {t("review.approveDaysHint")}
            {days.data &&
              ` ${t("review.showing", { from: loc.date(`${days.data.from}T12:00:00`), to: loc.date(`${days.data.to}T12:00:00`) })}`}
          </CardDescription>
          <CardAction>
            <Tabs value={dayView} onValueChange={(v) => setDayView(v as "todo" | "all")}>
              <TabsList>
                <TabsTrigger value="todo">{t("review.tabToApprove")}</TabsTrigger>
                <TabsTrigger value="all">{t("review.tabAllDays")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger aria-label={t("review.filterEmployee")} className="min-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("review.everyone")}</SelectItem>
                {(days.data?.people ?? []).map((p) => (
                  <SelectItem key={p.employeeId} value={p.employeeId}>
                    {p.employeeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {allReadyCount > 1 && (
              <Button className="ml-auto" disabled={approve.isPending} onClick={() => approve.mutate(allReady)}>
                <CircleCheck /> {t("review.approveAllReady", { n: allReadyCount })}
              </Button>
            )}
          </div>

          {days.isLoading && <Skeleton className="h-24 w-full" />}
          {!days.isLoading && people.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {dayView === "todo" ? t("review.nothingToApprove") : t("review.noTimeWindow")}
            </p>
          )}
          {people.map((p) => (
            <section key={p.employeeId} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={entriesHref(p.employeeId)} className="font-medium underline-offset-4 hover:underline">
                  {p.employeeName}
                </Link>
                {p.hasWork && (
                  <span className="text-xs text-muted-foreground">
                    {t("review.usually", { start: p.typical.start, end: p.typical.end })}
                    {p.usual != null && ` · ${hrs(p.usual)}`}
                  </span>
                )}
                {p.ready.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate([{ employeeId: p.employeeId, days: p.ready.map((d) => d.day) }])}
                  >
                    <CircleCheck /> {t("review.approveReady", { n: p.ready.length })}
                  </Button>
                )}
              </div>
              {[...p.weeks.entries()].map(([wk, ds]) => (
                <div key={wk} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t("myHours.weekOf", { date: loc.date(`${wk}T12:00:00`) })}</span>
                    <span className="ml-auto font-mono">{hrs(ds.reduce((s, d) => s + dayMin(d), 0))}</span>
                  </div>
                  {ds.map((d) => (
                    <DayLine
                      key={d.day}
                      employeeId={p.employeeId}
                      d={d}
                      usual={p.usual}
                      isManager={isManager}
                      busy={approve.isPending || unapprove.isPending}
                      onApprove={() => approve.mutate([{ employeeId: p.employeeId, days: [d.day] }])}
                      onReopen={() => setReopen({ employeeId: p.employeeId, name: p.employeeName, day: d.day })}
                    />
                  ))}
                </div>
              ))}
            </section>
          ))}
        </CardContent>
      </Card>

      <ReopenDialog
        target={reopen}
        busy={unapprove.isPending}
        onClose={() => setReopen(null)}
        onConfirm={(reason) => reopen && unapprove.mutate({ employeeId: reopen.employeeId, day: reopen.day, reason })}
      />
    </div>
  );
}
