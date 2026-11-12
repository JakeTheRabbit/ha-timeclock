"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  CalendarDays,
  ChartColumn,
  IdCard,
  KeyRound,
  LogIn,
  LogOut,
  MonitorSmartphone,
  Scale,
  Settings2,
  Timer,
  TreePalm,
  TriangleAlert,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorCode, apiErrorText } from "@/lib/api-errors";
import { useLocale } from "@/lib/format";
import { useLiveTimer } from "@/hooks/use-live-timer";
import {
  fmtH,
  fmtHm,
  liveTodayMin,
  shiftWhen,
  useClockContext,
  useClockStatus,
} from "@/hooks/use-clock-context";
import { autoDeductMinutes } from "@/server/domain/time/breaks";

const HM = { hour: "2-digit", minute: "2-digit" } as const;
import { cn } from "@/lib/utils";
import { useSession } from "@/hooks/use-session";
import { roleAtLeast } from "@/server/auth/rbac";
import { useT } from "@/lib/i18n";

interface Whoami {
  ha: { haUserId: string; displayName: string | null } | null;
  employee: { id: string; displayName: string; role: string } | null;
  bootstrapped: boolean;
}

function Tile({
  href,
  icon: Icon,
  label,
  description,
  primary,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex min-h-24 flex-col justify-center gap-1 rounded-xl border p-4 shadow-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.99]",
        primary
          ? "col-span-2 border-transparent bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      <Icon className={cn(primary ? "size-8" : "size-6")} aria-hidden="true" />
      <span className={cn("font-semibold", primary && "text-lg")}>{label}</span>
      <span
        className={cn(
          "text-sm",
          primary ? "text-primary-foreground/80" : "text-muted-foreground",
        )}
      >
        {description}
      </span>
    </Link>
  );
}

/** Live status: clock state + one-tap punch, today/week vs usual, next shift, nudges. */
function StatusCard() {
  const qc = useQueryClient();
  const t = useT();
  const loc = useLocale();
  const status = useClockStatus(true);
  const ctx = useClockContext(true);
  const disputes = useQuery({
    queryKey: ["my-disputes"],
    queryFn: () => apiGet<{ modifications: { day: string }[] }>("/review/mine/disputes"),
  });
  const leave = useQuery({
    queryKey: ["leave-mine"],
    queryFn: () => apiGet<{ requests: { status: string }[] }>("/leave/mine"),
  });

  const s = status.data;
  const open = s?.open ?? null;
  const since = open?.shiftStart ?? open?.clockIn ?? null;
  const timer = useLiveTimer(since);
  const todayMin = liveTodayMin(s, status.dataUpdatedAt);
  const disputedDays = new Set(disputes.data?.modifications.map((m) => m.day)).size;
  const pendingLeave = leave.data?.requests.filter((r) => r.status === "pending").length ?? 0;

  // Anything needing more than a tap (photo, location, a break, the meal-deduct
  // warning) goes to the clock screen instead.
  const deduct =
    open && s?.breakRule
      ? autoDeductMinutes((Date.now() - +new Date(open.clockIn)) / 60_000, open.unpaidBreakMin, s.breakRule)
      : 0;
  const needsClockScreen = open ? !!open.onBreak || deduct > 0 : !!(s?.requires?.geo || s?.requires?.photo);

  const punch = useMutation({
    mutationFn: () =>
      open ? apiPost<{ workedMinutes?: number }>("/clock/out") : apiPost("/clock/in", { jobId: ctx.likelyJobId }),
    onSuccess: (r) => {
      const worked = (r as { workedMinutes?: number } | undefined)?.workedMinutes;
      toast.success(
        open ? t("toast.worked", { hours: ((worked ?? 0) / 60).toFixed(2) }) : t("toast.clockedIn"),
      );
      qc.invalidateQueries({ queryKey: ["clock-status"] });
      qc.invalidateQueries({ queryKey: ["clock-context-entries"] });
    },
    onError: (e) =>
      toast.error(apiErrorCode(e) === "just_clocked_out" ? t("clock.justClockedOut") : apiErrorText(e, t)),
  });

  if (status.isLoading) return <Skeleton className="h-44 rounded-xl" />;

  const Icon = open ? LogOut : LogIn;
  const label = open ? t("clock.clockOut") : t("clock.clockIn");
  const btnClass = "h-14 w-full rounded-xl text-lg font-semibold sm:w-48";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            {!open ? (
              <Badge variant="secondary">{t("clock.clockedOut")}</Badge>
            ) : (
              <StatusBadge status="open">
                {!open.onBreak
                  ? t("clock.clockedIn")
                  : open.onBreak.paid
                    ? t("clock.onBreakPaid")
                    : t("clock.onBreakUnpaid")}
              </StatusBadge>
            )}
            {open ? (
              <>
                <div className="font-mono text-4xl tabular-nums">{timer}</div>
                <div className="text-sm text-muted-foreground">
                  {t("clock.since", { time: loc.time(since!, HM) })}
                  {open.job && <> · {t("clock.jobLabel", { name: open.job.name })}</>}
                </div>
              </>
            ) : (
              ctx.lastOut && (
                <div className="text-sm text-muted-foreground">
                  {t("clock.lastOut", { time: loc.dateTime(ctx.lastOut, { weekday: "short", ...HM }) })}
                </div>
              )
            )}
          </div>
          {needsClockScreen ? (
            <Button asChild size="lg" variant={open ? "destructive" : "default"} className={btnClass}>
              <Link href="/clock">
                <Icon aria-hidden="true" /> {open?.onBreak ? t("home.status.openClock") : label}
              </Link>
            </Button>
          ) : (
            <Button
              size="lg"
              variant={open ? "destructive" : "default"}
              disabled={punch.isPending}
              onClick={() => punch.mutate()}
              className={btnClass}
            >
              <Icon aria-hidden="true" /> {label}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-muted-foreground">{t("home.status.today")}</div>
            <div className="font-semibold tabular-nums">{fmtHm(t, todayMin)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{t("home.status.week")}</div>
            <div className="font-semibold tabular-nums">{fmtH(t, loc, ctx.weekMin)}</div>
            {ctx.usualWeekMin != null && (
              <div className="text-xs text-muted-foreground">
                {t("home.status.ofUsual", { usual: fmtH(t, loc, ctx.usualWeekMin) })}
              </div>
            )}
          </div>
          <div>
            <div className="text-muted-foreground">{t("home.status.nextShift")}</div>
            <Link href="/roster" className="font-semibold hover:underline">
              {ctx.next ? shiftWhen(t, loc, ctx.next) : t("home.status.noShift")}
            </Link>
          </div>
        </div>

        {disputedDays > 0 && (
          <Link
            href="/my-hours"
            className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          >
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            {t(disputedDays === 1 ? "home.status.disputes.one" : "home.status.disputes.other", { n: disputedDays })}
          </Link>
        )}
        {pendingLeave > 0 && (
          <Link
            href="/leave"
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          >
            <TreePalm className="size-4 shrink-0" aria-hidden="true" />
            {t(pendingLeave === 1 ? "home.status.pendingLeave.one" : "home.status.pendingLeave.other", { n: pendingLeave })}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export default function Home() {
  // useSession performs HA SSO server-side: an HA account linked to an
  // employee is signed in the moment this page loads, on any device.
  const { session, isLoading } = useSession();
  const whoami = useQuery({
    queryKey: ["whoami"],
    queryFn: () => apiGet<Whoami>("/auth/whoami"),
  });
  const t = useT();

  const role = session?.employee.role ?? "employee";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
      {session && <StatusCard />}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="col-span-2 h-28 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : session ? (
        <nav aria-label={t("home.sections")} className="grid grid-cols-2 gap-3">
          <Tile
            href="/clock"
            icon={Timer}
            label={t("home.clock.label")}
            description={t("home.clock.description")}
            primary
          />
          <Tile
            href="/my-hours"
            icon={ChartColumn}
            label={t("home.myHours.label")}
            description={t("home.myHours.description")}
          />
          <Tile
            href="/roster"
            icon={CalendarDays}
            label={t("home.roster.label")}
            description={t("home.roster.description")}
          />
          <Tile
            href="/leave"
            icon={TreePalm}
            label={t("home.leave.label")}
            description={t("home.leave.description")}
          />
          <Tile
            href="/me"
            icon={UserRound}
            label={t("home.profile.label")}
            description={t("home.profile.description")}
          />
          {roleAtLeast(role, "lead") && (
            <Tile
              href="/manager"
              icon={Users}
              label={t("home.manager.label")}
              description={t("home.manager.description")}
            />
          )}
          {roleAtLeast(role, "manager") && (
            <Tile
              href="/manager/leave-balances"
              icon={Scale}
              label={t("home.leaveBalances.label")}
              description={t("home.leaveBalances.description")}
            />
          )}
          {roleAtLeast(role, "admin") && (
            <>
              <Tile
                href="/admin/employees"
                icon={IdCard}
                label={t("home.employees.label")}
                description={t("home.employees.description")}
              />
              <Tile
                href="/admin/jobs"
                icon={Briefcase}
                label={t("home.jobs.label")}
                description={t("home.jobs.description")}
              />
              <Tile
                href="/admin/settings"
                icon={Settings2}
                label={t("home.settings.label")}
                description={t("home.settings.description")}
              />
              <Tile
                href="/admin/devices"
                icon={MonitorSmartphone}
                label={t("home.devices.label")}
                description={t("home.devices.description")}
              />
            </>
          )}
        </nav>
      ) : null}

      {!session && !isLoading ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
            <Timer className="size-10 text-primary" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold">{t("home.notSignedIn")}</p>
              <p className="text-sm text-muted-foreground">
                {t("home.tagline")}
              </p>
            </div>
            <Button asChild size="lg" className="w-full max-w-xs">
              <Link href="/pin">
                <KeyRound aria-hidden="true" /> {t("home.kioskSignIn")}
              </Link>
            </Button>
            {whoami.data?.ha && !whoami.data.employee && whoami.data.bootstrapped && (
              <p className="text-sm text-muted-foreground">
                {t("home.notLinkedHint", {
                  account: whoami.data.ha.displayName ?? whoami.data.ha.haUserId,
                })}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
