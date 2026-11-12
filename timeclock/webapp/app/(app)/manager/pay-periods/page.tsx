"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Lock,
  LockKeyhole,
  LockOpen,
  Pencil,
  TriangleAlert,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ExportMenu } from "@/components/pay/export-menu";

import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLocale } from "@/lib/format";
import { entriesHref } from "@/lib/links";
import { flagLabel, periodDays } from "@/lib/pay-helpers";
import { cn } from "@/lib/utils";
import { useT, type MessageKey } from "@/lib/i18n";
import { StatusBadge, STATUS_TEXT } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Period {
  id: string;
  startAt: string;
  endAt: string;
  lockedAt: string | null;
}
interface TimesheetDay {
  date: string;
  workedMin: number;
  edited: boolean;
  publicHoliday: string | null;
  complianceFlags: string[];
}
interface ReadinessPerson {
  employeeId: string;
  employeeName: string;
  approvedDays: string[];
  unapprovedDays: string[];
  disputedDays: string[];
  correctionDays: string[];
  openShiftDays: string[];
  pendingLeave: { id: string; type: string; startDate: string; endDate: string }[];
}
interface Readiness {
  ready: boolean;
  people: ReadinessPerson[];
}
interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  days: TimesheetDay[];
  totals: {
    workedMin: number;
    ordinaryMin: number;
    ot1Min: number;
    ot2Min: number;
    statT15Min: number;
    altHolidaysEarned: number;
    editedDays: number;
    complianceFlagCount: number;
  };
}

const h = (min: number) => (min / 60).toFixed(2);

type T = ReturnType<typeof useT>;

/** Plural via `<key>.one` / `<key>.other`. */
const plural = (t: T, key: string, n: number) => t(`${key}.${n === 1 ? "one" : "other"}` as MessageKey, { n });

const LEAVE_TYPE_KEYS: Record<string, MessageKey> = {
  annual: "leave.typeAnnual",
  sick: "leave.typeSick",
  bereavement: "leave.typeBereavement",
  alt_holiday: "leave.typeAltHoliday",
  unpaid: "leave.typeUnpaid",
};

const FLAG_KEYS: Record<string, MessageKey> = {
  missing_rest_break: "payPeriods.flag.missingRest",
  missing_meal_break: "payPeriods.flag.missingMeal",
};

export default function PayPeriodsPage() {
  const qc = useQueryClient();
  const t = useT();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const d = (iso: string) => loc.date(iso, { day: "numeric", month: "short" });
  const dayLabel = (day: string) => loc.date(`${day}T12:00:00`, { weekday: "short", day: "numeric", month: "short" });
  const [picked, setPicked] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");
  const canSee =
    session && ["lead", "manager", "admin"].includes(session.employee.role);
  const role = session?.employee.role;
  const canLock = role === "manager" || role === "admin";
  const canUnlock = role === "admin";

  const periods = useQuery({
    queryKey: ["pay-periods"],
    queryFn: () => apiGet<{ periods: Period[] }>("/manager/pay-periods"),
    enabled: !!canSee,
  });
  // Newest first. Default = the latest finished period still to sign off,
  // else the latest finished one, else the current one.
  const list = periods.data?.periods ?? [];
  const now = Date.now();
  const fallback =
    list.find((p) => +new Date(p.endAt) <= now && !p.lockedAt) ??
    list.find((p) => +new Date(p.endAt) <= now) ??
    list[0];
  const selected = picked ?? fallback?.id ?? null;
  const idx = list.findIndex((p) => p.id === selected);
  const timesheet = useQuery({
    queryKey: ["timesheet", selected],
    queryFn: () =>
      apiGet<{ period: Period; rows: TimesheetRow[] }>(
        `/manager/pay-periods/${selected}/timesheet`,
      ),
    enabled: !!selected,
  });
  const readiness = useQuery({
    queryKey: ["pay-period-readiness", selected],
    queryFn: () => apiGet<Readiness>(`/manager/pay-periods/${selected}/readiness`),
    enabled: !!selected,
  });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const approvedOf = (employeeId: string) =>
    new Set(readiness.data?.people.find((p) => p.employeeId === employeeId)?.approvedDays ?? []);

  const unlock = useMutation({
    mutationFn: (id: string) => apiPost(`/manager/pay-periods/${id}/unlock`, { reason: unlockReason }),
    onSuccess: () => {
      toast.success(t("payPeriods.unlocked"));
      setUnlockOpen(false);
      setUnlockReason("");
      qc.invalidateQueries({ queryKey: ["pay-periods"] });
      qc.invalidateQueries({ queryKey: ["timesheet"] });
    },
    onError: (e) => toast.error(t("payPeriods.unlockRefused", { error: apiErrorText(e) })),
  });

  const lock = useMutation({
    mutationFn: (id: string) => apiPost(`/manager/pay-periods/${id}/lock`),
    onSuccess: () => {
      toast.success(t("payPeriods.locked"));
      qc.invalidateQueries({ queryKey: ["pay-periods"] });
      qc.invalidateQueries({ queryKey: ["timesheet"] });
    },
    onError: (e) =>
      toast.error(
        t("payPeriods.lockRefused", { error: apiErrorText(e) }),
      ),
  });

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
            <CardTitle className="text-destructive">{t("pay.accessDenied")}</CardTitle>
            <CardDescription>{t("payPeriods.leadRequired")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const period = timesheet.data?.period;
  const issues = (readiness.data?.people ?? []).filter((p) => countOf(p) > 0);
  const notReady = readiness.data ? !readiness.data.ready : false;
  const outstanding = issues.reduce((a, p) => a + countOf(p), 0);
  const openShifts = issues.reduce((a, p) => a + p.openShiftDays.length, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {/* Period selector: older ‹ [period] › newer */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("payPeriods.older")}
          disabled={idx < 0 || idx >= list.length - 1}
          onClick={() => setPicked(list[idx + 1].id)}
        >
          <ChevronLeft />
        </Button>
        <Select value={selected ?? undefined} onValueChange={setPicked}>
          <SelectTrigger aria-label={t("payPeriods.select")} className="flex-1">
            <SelectValue placeholder={t("payPeriods.selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {list.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {d(p.startAt)} – {d(p.endAt)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.lockedAt ? t("status.locked") : +new Date(p.endAt) > now ? t("payPeriods.current") : t("payPeriods.toSignOff")}
                </span>
                {p.lockedAt && <Lock className="size-3.5 text-muted-foreground" />}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("payPeriods.newer")}
          disabled={idx <= 0}
          onClick={() => setPicked(list[idx - 1].id)}
        >
          <ChevronRight />
        </Button>
      </div>

      {selected && timesheet.isLoading && (
        <Skeleton className="h-64 w-full rounded-xl" />
      )}

      {selected && timesheet.data && period && (
        <>
          {/* Sign-off / lock + exports */}
          <div className="flex flex-wrap items-center gap-2">
            {!period.lockedAt ? (
              !canLock ? (
                <StatusBadge status="open" className="px-3 py-1.5 text-sm">
                  {t("payPeriods.openManagerLocks")}
                </StatusBadge>
              ) : +new Date(period.endAt) > now ? (
                <StatusBadge status="open" className="px-3 py-1.5 text-sm">
                  {t("payPeriods.currentLockAfter", { date: d(period.endAt) })}
                </StatusBadge>
              ) : (
              <>
                <Button
                  variant="destructive"
                  disabled={lock.isPending || readiness.isLoading || notReady}
                  onClick={() => setConfirmOpen(true)}
                >
                  <LockKeyhole /> {t("payPeriods.signOffLock")}
                </Button>
                {notReady && (
                  <Button
                    variant="outline"
                    disabled={lock.isPending || openShifts > 0}
                    title={openShifts > 0 ? t("payPeriods.closeOpenFirst") : undefined}
                    onClick={() => setConfirmOpen(true)}
                  >
                    {t("payPeriods.lockAnyway")}
                  </Button>
                )}
                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("payPeriods.lockTitle")}</DialogTitle>
                      <DialogDescription>
                        {t("payPeriods.lockBody", { from: d(period.startAt), to: d(period.endAt) })}
                        {notReady && (
                          <span className={cn("mt-2 block", STATUS_TEXT.warning)}>
                            {plural(t, "payPeriods.outstanding", outstanding)}
                          </span>
                        )}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">{t("common.cancel")}</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        disabled={lock.isPending}
                        onClick={() => {
                          setConfirmOpen(false);
                          lock.mutate(selected);
                        }}
                      >
                        <LockKeyhole /> {t("payPeriods.lockPeriod")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
              )
            ) : (
              <>
                <StatusBadge status="locked" className="gap-1.5 px-3 py-1.5 text-sm [&>svg]:size-4">
                  <Lock /> {t("payPeriods.lockedAt", { when: loc.dateTime(period.lockedAt) })}
                </StatusBadge>
                {canUnlock && (
                  <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
                    <Button variant="ghost" size="sm" onClick={() => setUnlockOpen(true)}>
                      <LockOpen /> {t("payPeriods.unlock")}
                    </Button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("payPeriods.unlockTitle")}</DialogTitle>
                        <DialogDescription>
                          {t("payPeriods.unlockBody", { from: d(period.startAt), to: d(period.endAt) })}
                        </DialogDescription>
                      </DialogHeader>
                      <Input
                        value={unlockReason}
                        onChange={(e) => setUnlockReason(e.target.value)}
                        placeholder={t("payPeriods.unlockReason")}
                      />
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">{t("common.cancel")}</Button>
                        </DialogClose>
                        <Button
                          disabled={unlockReason.trim().length < 5 || unlock.isPending}
                          onClick={() => unlock.mutate(period.id)}
                        >
                          <LockOpen /> {t("payPeriods.unlockPeriod")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </>
            )}
            <ExportMenu period={period} />
          </div>

          {!period.lockedAt && +new Date(period.endAt) <= now && (
            <ReadinessCard loading={readiness.isLoading} people={issues} fmt={dayLabel} t={t} />
          )}

          {timesheet.data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t("payPeriods.noTime")}
            </p>
          ) : (
            <>
              {/* Mobile: stacked cards */}
              <div className="flex flex-col gap-3 md:hidden">
                {timesheet.data.rows.map((r) => (
                  <Card key={r.employeeId} className="gap-3">
                    <CardHeader>
                      <CardTitle>{r.employeeName}</CardTitle>
                      {(r.totals.editedDays > 0 ||
                        r.totals.complianceFlagCount > 0) && (
                        <div className="flex flex-wrap gap-1.5">
                          {r.totals.editedDays > 0 && (
                            <StatusBadge status="edited">
                              {plural(t, "payPeriods.daysEdited", r.totals.editedDays)}
                            </StatusBadge>
                          )}
                          {r.totals.complianceFlagCount > 0 && (
                            <StatusBadge status="flag">
                              {plural(t, "payPeriods.flags", r.totals.complianceFlagCount)}
                            </StatusBadge>
                          )}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">{t("corrections.worked")}</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.workedMin)}
                        </dd>
                        <dt className="text-muted-foreground">{t("payPeriods.ordinary")}</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.ordinaryMin)}
                        </dd>
                        <dt className="text-muted-foreground">OT 1.5</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.ot1Min)}
                        </dd>
                        <dt className="text-muted-foreground">OT 2.0</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.ot2Min)}
                        </dd>
                        <dt className="text-muted-foreground">Stat T1.5</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.statT15Min)}
                        </dd>
                        <dt className="text-muted-foreground">{t("payPeriods.altHolidays")}</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {r.totals.altHolidaysEarned || "—"}
                        </dd>
                      </dl>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-2 w-full"
                        aria-expanded={open.has(r.employeeId)}
                        onClick={() => toggleRow(r.employeeId)}
                      >
                        <ChevronDown className={cn("transition-transform", open.has(r.employeeId) && "rotate-180")} />
                        {open.has(r.employeeId) ? t("payPeriods.hideDays") : t("payPeriods.showDays")}
                      </Button>
                      {open.has(r.employeeId) && (
                        <DayStrip row={r} days={periodDays(period.startAt, period.endAt)} approved={approvedOf(r.employeeId)} fmt={dayLabel} t={t} />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("roster.employeeField")}</TableHead>
                      <TableHead>{t("corrections.worked")}</TableHead>
                      <TableHead>{t("payPeriods.ordinary")}</TableHead>
                      <TableHead>OT 1.5</TableHead>
                      <TableHead>OT 2.0</TableHead>
                      <TableHead>Stat T1.5</TableHead>
                      <TableHead>{t("payPeriods.altHol")}</TableHead>
                      <TableHead>{t("status.edited")}</TableHead>
                      <TableHead>{t("payPeriods.flagsCol")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timesheet.data.rows.map((r) => (
                      <Fragment key={r.employeeId}>
                      <TableRow>
                        <TableCell className="font-medium">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-left hover:underline"
                            aria-expanded={open.has(r.employeeId)}
                            onClick={() => toggleRow(r.employeeId)}
                          >
                            <ChevronDown
                              className={cn(
                                "size-4 shrink-0 text-muted-foreground transition-transform",
                                open.has(r.employeeId) && "rotate-180",
                              )}
                            />
                            {r.employeeName}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.workedMin)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.ordinaryMin)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.ot1Min)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.ot2Min)}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {h(r.totals.statT15Min)}
                        </TableCell>
                        <TableCell>
                          {r.totals.altHolidaysEarned || "—"}
                        </TableCell>
                        <TableCell>
                          {r.totals.editedDays > 0 ? (
                            <StatusBadge status="edited">
                              {t("payPeriods.daysShort", { n: r.totals.editedDays })}
                            </StatusBadge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {r.totals.complianceFlagCount > 0 ? (
                            <StatusBadge status="flag">
                              {r.totals.complianceFlagCount}
                            </StatusBadge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                      {open.has(r.employeeId) && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="whitespace-normal">
                            <DayStrip row={r} days={periodDays(period.startAt, period.endAt)} approved={approvedOf(r.employeeId)} fmt={dayLabel} t={t} />
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const countOf = (p: ReadinessPerson) =>
  p.unapprovedDays.length + p.disputedDays.length + p.correctionDays.length + p.openShiftDays.length + p.pendingLeave.length;

/** Before locking: per person, what's still to sort out, each linking to where it's fixed. */
function ReadinessCard({
  loading,
  people,
  fmt,
  t,
}: {
  loading: boolean;
  people: ReadinessPerson[];
  fmt: (day: string) => string;
  t: T;
}) {
  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (people.length === 0) {
    return (
      <p className={cn("flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm", STATUS_TEXT.approved)}>
        <CircleCheck className="size-4 shrink-0" /> {t("payPeriods.ready")}
      </p>
    );
  }
  const dayLinks = (employeeId: string, days: string[], edit = false) => (
    <span className="flex flex-wrap gap-1">
      {days.map((day) => (
        <Link
          key={day}
          href={entriesHref(employeeId, day, edit)}
          className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent"
        >
          {fmt(day)}
        </Link>
      ))}
    </span>
  );
  const linkCls = "text-xs underline underline-offset-4 hover:text-foreground";
  return (
    <Card className="gap-3 border-amber-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TriangleAlert className="size-4 text-amber-500 dark:text-amber-400" /> {t("payPeriods.notReady")}
        </CardTitle>
        <CardDescription>{t("payPeriods.notReadyHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {people.map((p) => (
          <div key={p.employeeId} className="flex flex-col gap-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
            <span className="font-medium">{p.employeeName}</span>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {p.openShiftDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span className="text-destructive">{plural(t, "payPeriods.openShifts", p.openShiftDays.length)}</span>
                  {dayLinks(p.employeeId, p.openShiftDays, true)}
                </li>
              )}
              {p.disputedDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span>
                    {plural(t, "payPeriods.disputedDays", p.disputedDays.length)} ·{" "}
                    <Link href="/manager/review" className={linkCls}>{t("payPeriods.review")}</Link>
                  </span>
                  {dayLinks(p.employeeId, p.disputedDays)}
                </li>
              )}
              {p.unapprovedDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span>
                    {plural(t, "payPeriods.unapprovedDays", p.unapprovedDays.length)} ·{" "}
                    <Link href="/manager/review" className={linkCls}>{t("payPeriods.review")}</Link>
                  </span>
                  {dayLinks(p.employeeId, p.unapprovedDays)}
                </li>
              )}
              {p.correctionDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span>
                    {plural(t, "payPeriods.correctionDays", p.correctionDays.length)} ·{" "}
                    <Link href="/manager" className={linkCls}>{t("route.managerInsights")}</Link>
                  </span>
                  {dayLinks(p.employeeId, p.correctionDays)}
                </li>
              )}
              {p.pendingLeave.map((l) => (
                <li key={l.id}>
                  {t("payPeriods.leavePending", {
                    type: LEAVE_TYPE_KEYS[l.type] ? t(LEAVE_TYPE_KEYS[l.type]) : l.type.replace(/_/g, " "),
                    dates: l.endDate !== l.startDate ? `${fmt(l.startDate)} – ${fmt(l.endDate)}` : fmt(l.startDate),
                  })}{" "}
                  ·{" "}
                  <Link href="/manager" className={linkCls}>{t("route.managerInsights")}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** One person's period, day by day: hours, named flags, edited, approved — each day opens in Entries. */
function DayStrip({
  row,
  days,
  approved,
  fmt,
  t,
}: {
  row: TimesheetRow;
  days: string[];
  approved: Set<string>;
  fmt: (day: string) => string;
  t: T;
}) {
  const byDate = new Map(row.days.map((x) => [x.date, x]));
  return (
    <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((day) => {
        const x = byDate.get(day);
        const ok = approved.has(day);
        return (
          <Link
            key={day}
            href={entriesHref(row.employeeId, day)}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent lg:flex-col lg:items-start lg:gap-1",
              !x && "text-muted-foreground opacity-60",
            )}
          >
            <span className="w-20 shrink-0 lg:w-auto">{fmt(day)}</span>
            <span className="font-mono tabular-nums">{x ? `${h(x.workedMin)}h` : "—"}</span>
            {x && (
              <span className="flex flex-1 flex-wrap items-center justify-end gap-1 lg:justify-start">
                {x.publicHoliday && (
                  <StatusBadge status="holiday" className="px-1 text-[10px]">{x.publicHoliday}</StatusBadge>
                )}
                {x.complianceFlags.map((f) => (
                  <StatusBadge key={f} status="flag" className="px-1 text-[10px]">
                    {FLAG_KEYS[f] ? t(FLAG_KEYS[f]) : flagLabel(f)}
                  </StatusBadge>
                ))}
                {x.edited && (
                  <span className={cn("inline-flex items-center gap-0.5", STATUS_TEXT.edited)} title={t("status.edited")}>
                    <Pencil className="size-3" /> {t("status.edited")}
                  </span>
                )}
                {ok ? (
                  <span className={cn("inline-flex items-center gap-0.5", STATUS_TEXT.approved)} title={t("status.approved")}>
                    <Check className="size-3" /> {t("status.approved")}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("payPeriods.notApproved")}</span>
                )}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
