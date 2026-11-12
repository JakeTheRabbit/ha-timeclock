"use client";

import Link from "next/link";
import * as React from "react";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { fmtH } from "@/hooks/use-clock-context";
import { nextShift } from "@/lib/clock-context";
import { useLocale } from "@/lib/format";
import { useT, type MessageKey, type TVars } from "@/lib/i18n";
import { APP_TZ } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { liveMinutes, shiftTime, weekDays } from "@/components/entries/month-calendar";
import { localDay, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPlus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

interface Shift {
  id: string;
  employeeId: string;
  employeeName?: string;
  shiftDate: string;
  startMin: number;
  endMin: number;
  jobId: string | null;
  note: string | null;
}
interface Compare {
  date: string;
  shifts: {
    rosterId: string;
    employeeName: string;
    startMin: number;
    endMin: number;
    status: "ok" | "late" | "no_show" | "in_progress" | "upcoming";
    lateMin: number;
    actualIn: string | null;
  }[];
}
interface Emp { id: string; displayName: string }

const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });

type TFn = (key: MessageKey, vars?: TVars) => string;

const STATUS_BADGE: Record<Compare["shifts"][number]["status"], string> = {
  ok: "border-transparent bg-emerald-500/15 text-emerald-300",
  in_progress: "border-transparent bg-sky-500/15 text-sky-300",
  upcoming: "border-transparent bg-secondary text-secondary-foreground",
  late: "border-transparent bg-amber-500/15 text-amber-300",
  no_show: "border-transparent bg-rose-500/15 text-rose-300",
};

const STATUS_KEY: Record<Compare["shifts"][number]["status"], MessageKey> = {
  ok: "roster.statusOk",
  in_progress: "roster.statusInProgress",
  upcoming: "roster.statusUpcoming",
  late: "roster.statusLate",
  no_show: "roster.statusNoShow",
};

const errMsg = (e: unknown, t: TFn) => apiErrorText(e, t);

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}

export default function RosterPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const t = useT();
  const fmtMin = (min: number) => shiftTime(loc, min);
  const fmtDay = (day: string) => loc.date(`${day}T12:00:00`);
  const isLead = session && ["lead", "manager", "admin"].includes(session.employee.role);
  const today = todayISO();
  const [date, setDate] = useState(today);
  const [form, setForm] = useState({ employeeId: "", start: "08:00", end: "16:30" });
  const [cancelTarget, setCancelTarget] = useState<Shift | null>(null);

  // The site week (weekStart setting) containing the picked date.
  const days = useMemo(() => weekDays(date, loc.weekStart), [date, loc.weekStart]);
  const week = { from: days[0], to: days[6] };

  const shiftWeek = (n: number) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + n);
    setDate(localDay(d));
  };

  const mine = useQuery({
    queryKey: ["roster-mine", week.from],
    queryFn: () => apiGet<{ shifts: Shift[] }>(`/roster/mine?from=${week.from}&to=${week.to}`),
    enabled: !!session && !isLead,
  });
  // Worked so far this week, and the next shift (may be past this week).
  const worked = useQuery({
    queryKey: ["roster-worked", week.from],
    queryFn: () => {
      const from = new Date(`${week.from}T00:00:00`);
      const to = new Date(`${week.to}T00:00:00`);
      to.setDate(to.getDate() + 1);
      return apiGet<{ entries: EntryRow[] }>(`/entries/mine?from=${from.toISOString()}&to=${to.toISOString()}`);
    },
    enabled: !!session && !isLead,
  });
  const upcoming = useQuery({
    queryKey: ["roster-upcoming", today],
    queryFn: () => {
      const h = new Date(`${today}T12:00:00`);
      h.setDate(h.getDate() + 14);
      return apiGet<{ shifts: Shift[] }>(`/roster/mine?from=${today}&to=${localDay(h)}`);
    },
    enabled: !!session && !isLead,
  });
  const all = useQuery({
    queryKey: ["roster-all", week.from],
    queryFn: () => apiGet<{ shifts: Shift[] }>(`/roster?from=${week.from}&to=${week.to}`),
    enabled: !!isLead,
  });
  const compare = useQuery({
    queryKey: ["roster-compare", date],
    queryFn: () => apiGet<Compare>(`/roster/compare?date=${date}`),
    enabled: !!isLead,
    refetchInterval: 30_000,
  });
  const staff = useQuery({
    queryKey: ["kiosk-employees"],
    queryFn: () => apiGet<{ employees: Emp[] }>("/auth/kiosk-employees"),
    enabled: !!isLead,
  });

  const toMin = (hhmm: string) => {
    const [hh, mm] = hhmm.split(":").map(Number);
    return hh * 60 + (mm || 0);
  };

  const add = useMutation({
    mutationFn: () =>
      apiPost("/roster", {
        employeeId: form.employeeId,
        shiftDate: date,
        startMin: toMin(form.start),
        endMin: toMin(form.end),
      }),
    onSuccess: () => {
      toast.success(t("toast.shiftAdded"));
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiPost(`/roster/${id}/cancel`),
    onSuccess: () => {
      toast.success(t("toast.shiftCancelled"));
      setCancelTarget(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errMsg(e, t)),
  });

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
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

  const shifts = (isLead ? all.data?.shifts : mine.data?.shifts) ?? [];
  const range = (s: { startMin: number; endMin: number }) => `${fmtMin(s.startMin)}–${fmtMin(s.endMin)}`;

  // Staff header: next shift + rostered vs worked this week.
  const next = nextShift(upcoming.data?.shifts ?? []);
  const nextWhen = (() => {
    if (!next) return null;
    if (next.current) return t("roster.onNow", { time: fmtMin(next.shift.endMin) });
    const ahead = (+new Date(`${next.shift.shiftDate}T12:00:00`) - +new Date(`${today}T12:00:00`)) / 86400_000;
    const label =
      next.shift.shiftDate === today
        ? t("roster.today")
        : ahead < 7
          ? loc.weekday(next.start.getDay())
          : loc.date(`${next.shift.shiftDate}T12:00:00`);
    return `${label} ${range(next.shift)}`;
  })();
  const rosteredMin = shifts.reduce((a, s) => a + Math.max(0, s.endMin - s.startMin), 0);
  const workedMin = (worked.data?.entries ?? []).reduce((a, e) => a + liveMinutes(e), 0);

  return (
    <Container>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => shiftWeek(-7)} aria-label={t("roster.previousWeek")}>
          <ChevronLeft />
        </Button>
        <Input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="w-auto"
          aria-label={t("roster.weekStartingDate")}
        />
        <Button variant="ghost" size="icon" onClick={() => shiftWeek(7)} aria-label={t("roster.nextWeek")}>
          <ChevronRight />
        </Button>
        {!days.includes(today) && (
          <Button variant="outline" size="sm" onClick={() => setDate(today)}>
            {t("roster.thisWeek")}
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {t("roster.weekOf", { date: `${fmtDay(week.from)} – ${fmtDay(week.to)}` })}
        </span>
      </div>

      {isLead && (
        <Card>
          <CardHeader>
            <CardTitle>{t("roster.addShiftTitle", { date: fmtDay(date) })}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2 sm:col-span-3">
                <Label htmlFor="shift-employee">{t("roster.employeeField")}</Label>
                <Select
                  value={form.employeeId}
                  onValueChange={(v) => setForm({ ...form, employeeId: v })}
                >
                  <SelectTrigger id="shift-employee">
                    <SelectValue placeholder={t("roster.chooseEmployee")} />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.data?.employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="shift-start">{t("roster.startField")}</Label>
                <Input
                  id="shift-start"
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="shift-end">{t("roster.endField")}</Label>
                <Input
                  id="shift-end"
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={() => add.mutate()}
                  disabled={!form.employeeId || add.isPending}
                >
                  <CalendarPlus /> {add.isPending ? t("roster.adding") : t("roster.addShift")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLead && compare.data && compare.data.shifts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("roster.scheduledVsActual", { date: fmtDay(date) })}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {compare.data.shifts.map((s) => (
              <div key={s.rosterId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
                <span className="font-medium">{s.employeeName}</span>
                <span className="font-mono text-sm text-muted-foreground">{range(s)}</span>
                <span className="font-mono text-sm text-muted-foreground">
                  {s.actualIn
                    ? t("roster.inAt", { time: loc.time(s.actualIn) })
                    : t("roster.noPunch")}
                </span>
                <Badge variant="secondary" className={cn("ml-auto capitalize", STATUS_BADGE[s.status])}>
                  {t(STATUS_KEY[s.status])}
                  {s.lateMin > 0 && ` ${t("roster.lateSuffix", { n: s.lateMin })}`}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isLead && (
        <Card>
          <CardHeader>
            <CardTitle>{t("roster.myShiftsThisWeek")}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {upcoming.isSuccess && (nextWhen ? t("roster.next", { when: nextWhen }) : t("roster.noUpcoming"))}
            </p>
            <p className="font-mono text-sm">
              {t("roster.weekTotals", { rostered: fmtH(t, loc, rosteredMin), worked: fmtH(t, loc, workedMin) })}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {mine.isLoading && <Skeleton className="h-64 w-full" />}
            {!mine.isLoading &&
              days.map((day) => {
                const ds = shifts.filter((s) => s.shiftDate === day);
                return (
                  <div
                    key={day}
                    className={cn(
                      "flex items-center gap-3 rounded-md border border-transparent px-2 py-2",
                      day === today && "border-primary/60 bg-primary/5",
                      day < today && "opacity-60",
                    )}
                  >
                    <span className="w-20 shrink-0 text-sm">
                      <span className="font-medium">{loc.weekday(new Date(`${day}T12:00:00`).getDay())}</span>{" "}
                      <span className="text-muted-foreground">{loc.date(`${day}T12:00:00`, { day: "numeric" })}</span>
                    </span>
                    <div className="relative h-2 flex-1 rounded-full bg-muted-foreground/15" aria-hidden>
                      {ds.map((s) => (
                        <span
                          key={s.id}
                          className="absolute inset-y-0 rounded-full bg-primary"
                          style={{
                            left: `${(s.startMin / 1440) * 100}%`,
                            width: `${Math.max(1, ((Math.min(s.endMin, 1440) - s.startMin) / 1440) * 100)}%`,
                          }}
                        />
                      ))}
                    </div>
                    <span className="shrink-0 text-right font-mono text-xs sm:w-36">
                      {ds.length ? ds.map(range).join(", ") : <span className="text-muted-foreground">{t("roster.off")}</span>}
                    </span>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {isLead && (
        <Card>
          <CardHeader>
            <CardTitle>{t("roster.allShiftsThisWeek")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {all.isLoading && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            )}
            {shifts.length === 0 && !all.isLoading && (
              <p className="py-1 text-sm text-muted-foreground">{t("roster.noShifts")}</p>
            )}
            {shifts.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  <span className="text-muted-foreground">{fmtDay(s.shiftDate)}</span>
                  <span className="font-mono">{range(s)}</span>
                  <span className="font-medium">{s.employeeName}</span>
                  {s.note && <span className="text-muted-foreground">· {s.note}</span>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setCancelTarget(s)}
                  disabled={cancel.isPending}
                  aria-label={t("roster.cancelShiftAria")}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Confirm before destroying a shift — a single stray tap should never
          cancel someone's roster. */}
      <Dialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("roster.cancelDialogTitle")}</DialogTitle>
            <DialogDescription>
              {cancelTarget &&
                t("roster.cancelDialogBody", {
                  shift: `${cancelTarget.employeeName ? `${cancelTarget.employeeName} · ` : ""}${fmtDay(cancelTarget.shiftDate)} · ${range(cancelTarget)}`,
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelTarget(null)}>
              {t("roster.keepShift")}
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancelTarget && cancel.mutate(cancelTarget.id)}
            >
              <Trash2 /> {cancel.isPending ? t("roster.cancelling") : t("roster.cancelShift")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Container>
  );
}
