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
import { Badge } from "@/components/ui/badge";
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

export default function PayPeriodsPage() {
  const qc = useQueryClient();
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
      toast.success("Period unlocked — entries can be edited again.");
      setUnlockOpen(false);
      setUnlockReason("");
      qc.invalidateQueries({ queryKey: ["pay-periods"] });
      qc.invalidateQueries({ queryKey: ["timesheet"] });
    },
    onError: (e) => toast.error(`Unlock refused: ${apiErrorText(e)}`),
  });

  const lock = useMutation({
    mutationFn: (id: string) => apiPost(`/manager/pay-periods/${id}/lock`),
    onSuccess: () => {
      toast.success("Period locked — entries inside are now immutable.");
      qc.invalidateQueries({ queryKey: ["pay-periods"] });
      qc.invalidateQueries({ queryKey: ["timesheet"] });
    },
    onError: (e) =>
      toast.error(
        `Lock refused: ${apiErrorText(e)}`,
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
            <CardTitle className="text-destructive">Access denied</CardTitle>
            <CardDescription>Lead role or above required.</CardDescription>
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
          aria-label="Older period"
          disabled={idx < 0 || idx >= list.length - 1}
          onClick={() => setPicked(list[idx + 1].id)}
        >
          <ChevronLeft />
        </Button>
        <Select value={selected ?? undefined} onValueChange={setPicked}>
          <SelectTrigger aria-label="Select pay period" className="flex-1">
            <SelectValue placeholder="Select a pay period…" />
          </SelectTrigger>
          <SelectContent>
            {list.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {d(p.startAt)} – {d(p.endAt)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {p.lockedAt ? "Locked" : +new Date(p.endAt) > now ? "Current" : "To sign off"}
                </span>
                {p.lockedAt && <Lock className="size-3.5 text-muted-foreground" />}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Newer period"
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
                <Badge variant="secondary" className="px-3 py-1.5 text-sm">
                  Open — a manager signs off and locks
                </Badge>
              ) : +new Date(period.endAt) > now ? (
                <Badge variant="secondary" className="px-3 py-1.5 text-sm">
                  Current period — lock after {d(period.endAt)}
                </Badge>
              ) : (
              <>
                <Button
                  variant="destructive"
                  disabled={lock.isPending || readiness.isLoading || notReady}
                  onClick={() => setConfirmOpen(true)}
                >
                  <LockKeyhole /> Sign off + LOCK period
                </Button>
                {notReady && (
                  <Button
                    variant="outline"
                    disabled={lock.isPending || openShifts > 0}
                    title={openShifts > 0 ? "Close the open shifts first" : undefined}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Lock anyway
                  </Button>
                )}
                <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Lock this pay period?</DialogTitle>
                      <DialogDescription>
                        Signing off locks {d(period.startAt)} –{" "}
                        {d(period.endAt)}. Every time entry inside the period
                        becomes immutable. This cannot be undone.
                        {notReady && (
                          <span className="mt-2 block text-amber-300">
                            {outstanding} item{outstanding === 1 ? "" : "s"} still outstanding — they are locked as they are.
                          </span>
                        )}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        disabled={lock.isPending}
                        onClick={() => {
                          setConfirmOpen(false);
                          lock.mutate(selected);
                        }}
                      >
                        <LockKeyhole /> Lock period
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
              )
            ) : (
              <>
                <Badge
                  variant="secondary"
                  className="gap-1.5 px-3 py-1.5 text-sm [&>svg]:size-4"
                >
                  <Lock /> Locked {loc.dateTime(period.lockedAt)}
                </Badge>
                {canUnlock && (
                  <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
                    <Button variant="ghost" size="sm" onClick={() => setUnlockOpen(true)}>
                      <LockOpen /> Unlock
                    </Button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Unlock this pay period?</DialogTitle>
                        <DialogDescription>
                          Entries in {d(period.startAt)} – {d(period.endAt)} become editable again. This is
                          recorded in the audit log with your reason.
                        </DialogDescription>
                      </DialogHeader>
                      <Input
                        value={unlockReason}
                        onChange={(e) => setUnlockReason(e.target.value)}
                        placeholder="Reason (e.g. payroll correction for Sam)"
                      />
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button
                          disabled={unlockReason.trim().length < 5 || unlock.isPending}
                          onClick={() => unlock.mutate(period.id)}
                        >
                          <LockOpen /> Unlock period
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
            <ReadinessCard loading={readiness.isLoading} people={issues} fmt={dayLabel} />
          )}

          {timesheet.data.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No worked time in this period.
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
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 bg-amber-500/10 text-amber-300"
                            >
                              {r.totals.editedDays}d edited
                            </Badge>
                          )}
                          {r.totals.complianceFlagCount > 0 && (
                            <Badge variant="destructive">
                              {r.totals.complianceFlagCount} flags
                            </Badge>
                          )}
                        </div>
                      )}
                    </CardHeader>
                    <CardContent>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Worked</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {h(r.totals.workedMin)}
                        </dd>
                        <dt className="text-muted-foreground">Ordinary</dt>
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
                        <dt className="text-muted-foreground">Alt holidays</dt>
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
                        {open.has(r.employeeId) ? "Hide days" : "Show days"}
                      </Button>
                      {open.has(r.employeeId) && (
                        <DayStrip row={r} days={periodDays(period.startAt, period.endAt)} approved={approvedOf(r.employeeId)} fmt={dayLabel} />
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
                      <TableHead>Employee</TableHead>
                      <TableHead>Worked</TableHead>
                      <TableHead>Ordinary</TableHead>
                      <TableHead>OT 1.5</TableHead>
                      <TableHead>OT 2.0</TableHead>
                      <TableHead>Stat T1.5</TableHead>
                      <TableHead>Alt hol.</TableHead>
                      <TableHead>Edited</TableHead>
                      <TableHead>Flags</TableHead>
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
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 bg-amber-500/10 text-amber-300"
                            >
                              {r.totals.editedDays}d
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {r.totals.complianceFlagCount > 0 ? (
                            <Badge variant="destructive">
                              {r.totals.complianceFlagCount}
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                      {open.has(r.employeeId) && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="whitespace-normal">
                            <DayStrip row={r} days={periodDays(period.startAt, period.endAt)} approved={approvedOf(r.employeeId)} fmt={dayLabel} />
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Before locking: per person, what's still to sort out, each linking to where it's fixed. */
function ReadinessCard({ loading, people, fmt }: { loading: boolean; people: ReadinessPerson[]; fmt: (day: string) => string }) {
  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (people.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
        <CircleCheck className="size-4 shrink-0" /> Ready to lock — every day approved, nothing outstanding.
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
          <TriangleAlert className="size-4 text-amber-400" /> Not ready to lock yet
        </CardTitle>
        <CardDescription>Sort these out first, or lock anyway (open shifts always block the lock).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {people.map((p) => (
          <div key={p.employeeId} className="flex flex-col gap-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
            <span className="font-medium">{p.employeeName}</span>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {p.openShiftDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span className="text-destructive">{plural(p.openShiftDays.length, "shift")} still clocked in — close to lock</span>
                  {dayLinks(p.employeeId, p.openShiftDays, true)}
                </li>
              )}
              {p.disputedDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span>
                    {plural(p.disputedDays.length, "day")} with an open dispute ·{" "}
                    <Link href="/manager/review" className={linkCls}>Review</Link>
                  </span>
                  {dayLinks(p.employeeId, p.disputedDays)}
                </li>
              )}
              {p.unapprovedDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span>
                    {plural(p.unapprovedDays.length, "day")} not approved ·{" "}
                    <Link href="/manager/review" className={linkCls}>Review</Link>
                  </span>
                  {dayLinks(p.employeeId, p.unapprovedDays)}
                </li>
              )}
              {p.correctionDays.length > 0 && (
                <li className="flex flex-col gap-1">
                  <span>
                    {plural(p.correctionDays.length, "day")} with a correction pending ·{" "}
                    <Link href="/manager" className={linkCls}>Dashboard</Link>
                  </span>
                  {dayLinks(p.employeeId, p.correctionDays)}
                </li>
              )}
              {p.pendingLeave.map((l) => (
                <li key={l.id}>
                  Leave request ({l.type.replace(/_/g, " ")}) {fmt(l.startDate)}
                  {l.endDate !== l.startDate && ` – ${fmt(l.endDate)}`} pending ·{" "}
                  <Link href="/manager" className={linkCls}>Dashboard</Link>
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
}: {
  row: TimesheetRow;
  days: string[];
  approved: Set<string>;
  fmt: (day: string) => string;
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
                  <Badge variant="outline" className="px-1 text-[10px]">{x.publicHoliday}</Badge>
                )}
                {x.complianceFlags.map((f) => (
                  <Badge key={f} variant="destructive" className="px-1 text-[10px]">{flagLabel(f)}</Badge>
                ))}
                {x.edited && (
                  <span className="inline-flex items-center gap-0.5 text-amber-300" title="Edited">
                    <Pencil className="size-3" /> Edited
                  </span>
                )}
                {ok ? (
                  <span className="inline-flex items-center gap-0.5 text-emerald-300" title="Approved">
                    <Check className="size-3" /> Approved
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not approved</span>
                )}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
