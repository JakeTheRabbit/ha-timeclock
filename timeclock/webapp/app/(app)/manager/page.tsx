"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarRange,
  ChartColumn,
  Check,
  ClipboardCheck,
  ChevronRight,
  Pencil,
  ScrollText,
  Wallet,
  X,
} from "lucide-react";

import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLiveTimer } from "@/hooks/use-live-timer";
import { useLocale } from "@/lib/format";
import { entriesHref } from "@/lib/links";
import { localDay } from "@/components/entries/edit-entry-dialog";
import { CorrectionRequest, type PendingCorrection } from "@/components/corrections/correction-request";
import { LeaveApprovals } from "@/components/leave/leave-approvals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface Board {
  now: string;
  clockedIn: {
    entryId: string;
    employeeId: string;
    employeeName: string;
    clockIn: string;
    onBreak: boolean;
    breakSince: string | null;
  }[];
  todayClosedMin: Record<string, number>;
}

/** GET /roster/compare — today's rostered shifts vs punches. */
interface RosterShift {
  rosterId: string;
  employeeId: string;
  employeeName: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualIn: string | null;
  status: "ok" | "late" | "no_show" | "in_progress" | "upcoming";
}

const errorMessage = (e: unknown): string => apiErrorText(e);

const hm = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

function LiveRow({
  e,
  shift,
  closedMin,
}: {
  e: Board["clockedIn"][number];
  shift?: RosterShift;
  closedMin: number;
}) {
  const timer = useLiveTimer(e.clockIn); // also re-renders every second
  const loc = useLocale();
  const now = Date.now();
  const todayMin = closedMin + (now - new Date(e.clockIn).getTime()) / 60_000;
  // Progress from clock-in to their rostered end.
  const a = new Date(e.clockIn).getTime();
  const end = shift ? new Date(shift.scheduledEnd).getTime() : NaN;
  const pct = end > a ? Math.min(100, ((now - a) / (end - a)) * 100) : 100;
  const overMin = (now - end) / 60_000;
  return (
    <Link
      href={entriesHref(e.employeeId, localDay(new Date(e.clockIn)))}
      className="-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted/50"
    >
      <div className="relative shrink-0">
        <Avatar employeeId={e.employeeId} name={e.employeeName} size="sm" />
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card ${
            e.onBreak ? "bg-amber-400" : "bg-emerald-400"
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{e.employeeName}</div>
        <div className="text-xs text-muted-foreground">
          {e.onBreak ? "On break" : "Working"} · today {hm(todayMin)}
          {shift &&
            (overMin > 0 ? (
              <span className="text-amber-400"> · {Math.round(overMin)}m past rostered end</span>
            ) : (
              <> · rostered until {loc.time(shift.scheduledEnd)}</>
            ))}
        </div>
        {shift && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${overMin > 0 ? "bg-amber-400" : "bg-primary/70"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>
      <span className="font-mono text-sm tabular-nums text-muted-foreground">
        {timer}
      </span>
    </Link>
  );
}

/** Rostered today, not clocked in: how long until due, or how late. */
function DueRow({ s, today }: { s: RosterShift; today: string }) {
  const loc = useLocale();
  const start = new Date(s.scheduledStart).getTime();
  const min = Math.round((start - Date.now()) / 60_000);
  const missed = s.status === "no_show";
  const late = !missed && min < 0;
  return (
    <Link
      href={entriesHref(s.employeeId, today)}
      className="-mx-2 flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-muted/50"
    >
      <Avatar employeeId={s.employeeId} name={s.employeeName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{s.employeeName}</div>
        <div className="text-xs text-muted-foreground">
          Rostered {loc.time(s.scheduledStart)}–{loc.time(s.scheduledEnd)}
        </div>
      </div>
      <Badge
        className={`border-transparent ${
          missed
            ? "bg-destructive/15 text-destructive"
            : late
              ? "bg-amber-500/15 text-amber-300"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {missed ? "Didn't show" : late ? `Late ${hm(-min)}` : `Due in ${hm(min)}`}
      </Badge>
    </Link>
  );
}

export default function ManagerPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const canSee =
    session && ["lead", "manager", "admin"].includes(session.employee.role);

  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => apiGet<Board>("/manager/board"),
    enabled: !!canSee,
    refetchInterval: 15_000,
  });
  const today = localDay();
  const rosterToday = useQuery({
    queryKey: ["roster-compare", today],
    queryFn: () => apiGet<{ shifts: RosterShift[] }>(`/roster/compare?date=${today}`),
    enabled: !!canSee,
    refetchInterval: 60_000,
  });
  const shiftsToday = rosterToday.data?.shifts ?? [];
  const inNow = new Set(board.data?.clockedIn.map((e) => e.employeeId));
  const rank = { late: 0, upcoming: 1, no_show: 2 } as Record<string, number>;
  const notIn = shiftsToday
    .filter((s) => !s.actualIn && s.status in rank && !inNow.has(s.employeeId))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.scheduledStart.localeCompare(b.scheduledStart));
  // The rostered shift a working person is on (or the first one today).
  const shiftFor = (employeeId: string) =>
    shiftsToday.find((s) => s.employeeId === employeeId && s.status === "in_progress") ??
    shiftsToday.find((s) => s.employeeId === employeeId);
  const corrections = useQuery({
    queryKey: ["pending-corrections"],
    queryFn: () =>
      apiGet<{ corrections: PendingCorrection[] }>("/corrections/pending"),
    enabled: !!canSee,
  });

  const review = useQuery({
    queryKey: ["review-open-count"],
    queryFn: () =>
      apiGet<{ modifications: { id: string; status: string }[] }>("/review/modifications?status=open&limit=500"),
    enabled: !!canSee,
    refetchInterval: 60_000,
  });
  const reviewPending = review.data?.modifications.filter((m) => m.status === "pending").length ?? 0;
  const reviewDisputed = review.data?.modifications.filter((m) => m.status === "disputed").length ?? 0;

  const decideCorrection = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: "approve" | "reject"; note?: string }) =>
      apiPost(`/corrections/${id}/${action}`, note ? { note } : {}),
    onSuccess: (_data, v) => {
      toast.success(
        v.action === "approve" ? "Correction approved." : "Correction declined.",
      );
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
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
          <CardContent>
            <Button asChild variant="secondary">
              <Link href="/pin">PIN sign-in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {/* Live who-is-in board */}
      <Card>
        <CardHeader>
          <CardTitle>On the clock now</CardTitle>
          <CardDescription>Live — refreshes every 15 seconds</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {board.isLoading && <Skeleton className="h-11 w-full" />}
          {board.data?.clockedIn.length === 0 && (
            <div className="flex min-h-11 items-center gap-3">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full bg-muted-foreground/50"
              />
              <span className="text-sm text-muted-foreground">
                Nobody clocked in.
              </span>
            </div>
          )}
          {board.data?.clockedIn.map((e) => (
            <LiveRow
              key={e.entryId}
              e={e}
              shift={shiftFor(e.employeeId)}
              closedMin={board.data?.todayClosedMin[e.employeeId] ?? 0}
            />
          ))}
          {notIn.length > 0 && (
            <>
              <Separator className="my-2" />
              <div className="text-xs font-medium text-muted-foreground">
                Rostered today, not clocked in
              </div>
              {notIn.map((s) => (
                <DueRow key={s.rosterId} s={s} today={today} />
              ))}
            </>
          )}
        </CardContent>
      </Card>

      {/* Staff self-edits to acknowledge / dispute + day approval */}
      <Card>
        <CardHeader>
          <CardTitle>Staff changes to check</CardTitle>
          <CardDescription>Times staff changed themselves, with their reason</CardDescription>
          <CardAction>
            <Badge variant={reviewPending + reviewDisputed > 0 ? "default" : "secondary"}>{reviewPending}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {review.isLoading && <Skeleton className="h-11 w-full" />}
          {review.data && (
            <p className="text-sm text-muted-foreground">
              {reviewPending === 0 && reviewDisputed === 0
                ? "Nothing to check."
                : `${reviewPending} to acknowledge${reviewDisputed ? ` · ${reviewDisputed} in dispute` : ""}`}
            </p>
          )}
          <Button asChild className="self-start">
            <Link href="/manager/review">
              <ClipboardCheck /> Review &amp; approve days
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Correction approval queue */}
      <Card>
        <CardHeader>
          <CardTitle>Correction requests</CardTitle>
          <CardAction>
            <Badge variant="secondary">
              {corrections.data?.corrections.length ?? 0}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {corrections.isLoading && <Skeleton className="h-20 w-full" />}
          {corrections.data?.corrections.length === 0 && (
            <p className="text-sm text-muted-foreground">None pending.</p>
          )}
          {corrections.data?.corrections.map((cr) => (
            <CorrectionRequest
              key={cr.id}
              cr={cr}
              busy={decideCorrection.isPending}
              onDecide={(action, note) => decideCorrection.mutate({ id: cr.id, action, note })}
            />
          ))}
        </CardContent>
      </Card>

      {/* Leave approval queue */}
      <LeaveApprovals />

      {/* Section links */}
      <Card className="py-1">
        <CardContent className="px-0">
          <Link
            href="/manager/insights"
            className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
          >
            <ChartColumn className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Dashboard &amp; calendar</span>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Link>
          <Separator />
          <Link
            href="/manager/review"
            className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
          >
            <ClipboardCheck className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Timesheet review</span>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Link>
          <Separator />
          <Link
            href="/manager/entries"
            className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
          >
            <Pencil className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Edit entries</span>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Link>
          <Separator />
          {["manager", "admin"].includes(session.employee.role) && (
            <>
              <Link
                href="/manager/pay"
                className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
              >
                <Wallet className="size-5 text-muted-foreground" />
                <span className="flex-1 text-sm font-medium">Pay</span>
                <ChevronRight className="size-5 text-muted-foreground" />
              </Link>
              <Separator />
            </>
          )}
          <Link
            href="/manager/pay-periods"
            className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
          >
            <CalendarRange className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Pay periods</span>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Link>
          <Separator />
          <Link
            href="/manager/audit"
            className="flex min-h-12 items-center gap-3 px-4 transition-colors hover:bg-accent"
          >
            <ScrollText className="size-5 text-muted-foreground" />
            <span className="flex-1 text-sm font-medium">Audit log</span>
            <ChevronRight className="size-5 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
