"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Briefcase, CloudOff, Coffee, KeyRound, LogIn, LogOut, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLiveTimer } from "@/hooks/use-live-timer";
import { enqueuePunch, flushQueue, queuedPunches, isNetworkError } from "@/lib/offline-queue";
import { useT } from "@/lib/i18n";
import { useLocale } from "@/lib/format";

interface Status {
  open: {
    entryId: string;
    clockIn: string;
    job: { id: string; name: string } | null;
    onBreak: { breakId: string; startAt: string; paid: boolean } | null;
    unpaidBreakMin: number;
  } | null;
}
interface Jobs {
  jobs: { id: string; name: string; code: string | null }[];
}

/** Marker returned by act() when the punch was queued offline instead of sent. */
interface ActResult {
  queued?: boolean;
  [key: string]: unknown;
}

const NO_JOB = "__none__";

export default function ClockPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const t = useT();
  const [jobId, setJobId] = useState<string>("");

  const status = useQuery({
    queryKey: ["clock-status"],
    queryFn: () => apiGet<Status>("/clock/status"),
    enabled: !!session,
    refetchInterval: 30_000,
  });
  const jobList = useQuery({
    queryKey: ["clock-jobs"],
    queryFn: () => apiGet<Jobs>("/clock/jobs"),
    enabled: !!session,
  });

  const open = status.data?.open ?? null;
  const timer = useLiveTimer(open?.clockIn ?? null);
  const breakTimer = useLiveTimer(open?.onBreak?.startAt ?? null);
  const [queued, setQueued] = useState(0);

  // Offline queue: flush on mount + whenever connectivity returns.
  useEffect(() => {
    const flush = () =>
      flushQueue().then((n) => {
        setQueued(queuedPunches().length);
        if (n > 0) {
          toast.success(t("clock.syncedPunches", { n }));
          qc.invalidateQueries({ queryKey: ["clock-status"] });
        }
      });
    setQueued(queuedPunches().length);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [qc, t]);

  const act = (path: string, data?: Record<string, unknown>): Promise<ActResult> =>
    apiPost<ActResult>(path, data)
      .then((r) => {
        qc.invalidateQueries({ queryKey: ["clock-status"] });
        return r ?? {};
      })
      .catch((e) => {
        // Network down: queue clock in/out punches for replay (P12).
        if (isNetworkError(e) && (path === "/clock/in" || path === "/clock/out")) {
          enqueuePunch(path, data ?? {});
          setQueued(queuedPunches().length);
          toast.info(t("clock.offlineQueued"));
          return { queued: true };
        }
        toast.error(
          e instanceof ApiError
            ? `${(e.body as { error?: string })?.error ?? e.status}`
            : t("toast.requestFailed"),
        );
        throw e;
      });

  const clockIn = useMutation({
    mutationFn: () => act("/clock/in", { jobId: jobId || null }),
    onSuccess: (r) => {
      if (!r.queued) toast.success(t("toast.clockedIn"));
    },
  });
  const clockOut = useMutation({
    mutationFn: () =>
      act("/clock/out").then((r) => {
        const out = r as { workedMinutes?: number; autoDeductedMin?: number };
        if (typeof out.workedMinutes === "number") {
          const hours = (out.workedMinutes / 60).toFixed(2);
          toast.success(
            (out.autoDeductedMin ?? 0) > 0
              ? t("toast.workedAutoDeducted", { hours, min: out.autoDeductedMin ?? 0 })
              : t("toast.worked", { hours }),
          );
        }
      }),
  });
  // NZ break semantics (matches the compliance engine): 10-min rest breaks are
  // PAID, the meal break is UNPAID. Employees pick which they're taking.
  const breakStart = useMutation({
    mutationFn: (paid: boolean) => act("/clock/break/start", { paid }),
    onSuccess: () => toast.success(t("toast.breakStarted")),
  });
  const breakEnd = useMutation({
    mutationFn: () => act("/clock/break/end"),
    onSuccess: () => toast.success(t("toast.breakEnded")),
  });
  const switchJob = useMutation({
    mutationFn: (id: string) => act("/clock/switch-job", { jobId: id }),
    onSuccess: () => toast.success(t("toast.switchedJob")),
  });

  const busy =
    clockIn.isPending ||
    clockOut.isPending ||
    breakStart.isPending ||
    breakEnd.isPending ||
    switchJob.isPending;

  if (isLoading)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 p-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-20 w-full max-w-sm rounded-xl" />
      </div>
    );

  if (!session)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
            <p className="text-muted-foreground">{t("clock.notSignedIn")}</p>
            <Button asChild size="lg">
              <Link href="/pin">
                <KeyRound aria-hidden="true" /> {t("common.pinSignIn")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 p-4 pt-8">
      {/* Status header */}
      <div className="flex flex-col items-center gap-3 text-center">
        {open ? (
          <>
            <Badge className="px-3 py-1 text-sm">{t("clock.clockedIn")}</Badge>
            <div className="font-mono text-6xl tabular-nums sm:text-7xl">{timer}</div>
            <div className="text-sm text-muted-foreground">
              {t("clock.since", {
                time: loc.time(open.clockIn, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              })}
              {open.job ? (
                <>
                  {" "}
                  · <span className="text-foreground">{t("clock.jobLabel", { name: open.job.name })}</span>
                </>
              ) : null}
              {open.unpaidBreakMin > 0 ? (
                <> · {t("clock.breakTaken", { n: open.unpaidBreakMin })}</>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <Badge variant="secondary" className="px-3 py-1 text-sm">
              {t("clock.clockedOut")}
            </Badge>
            <div className="font-mono text-6xl text-muted-foreground/40 tabular-nums sm:text-7xl">
              0:00:00
            </div>
          </>
        )}
      </div>

      {open ? (
        open.onBreak ? (
          /* On break: end break is the only action (matches previous behavior). */
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-6 py-5">
            <div className="flex items-center gap-2 text-amber-300">
              <Coffee className="size-5" aria-hidden="true" />
              {open.onBreak.paid ? t("clock.onBreakPaid") : t("clock.onBreakUnpaid")} ·{" "}
              <span className="font-mono tabular-nums">{breakTimer}</span>
            </div>
            <Button
              disabled={busy}
              onClick={() => breakEnd.mutate()}
              className="h-16 w-full rounded-xl bg-amber-500 text-xl font-semibold text-amber-950 hover:bg-amber-400 active:bg-amber-400/90"
            >
              {t("clock.endBreak")}
            </Button>
          </div>
        ) : (
          <div className="flex w-full max-w-sm flex-col gap-3">
            {/* Giant primary action */}
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => clockOut.mutate()}
              className="h-20 w-full rounded-xl text-2xl font-semibold"
            >
              <LogOut className="size-7" aria-hidden="true" /> {t("clock.clockOut")}
            </Button>
            {/* Secondary row: rest (paid) vs meal (unpaid) break */}
            <div className="flex w-full gap-3">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => breakStart.mutate(true)}
                className="h-14 flex-1 rounded-xl text-base"
              >
                <Coffee className="size-5" aria-hidden="true" /> {t("clock.restBreak")}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => breakStart.mutate(false)}
                className="h-14 flex-1 rounded-xl text-base"
              >
                <UtensilsCrossed className="size-5" aria-hidden="true" /> {t("clock.mealBreak")}
              </Button>
            </div>
            {jobList.data && jobList.data.jobs.length > 0 && (
              <Select
                key={open.job?.id ?? "general"}
                disabled={busy}
                onValueChange={(v) => switchJob.mutate(v)}
              >
                <SelectTrigger
                  aria-label={t("clock.switchJob")}
                  className="h-14 min-h-14 w-full rounded-xl"
                >
                  <Briefcase className="size-5 shrink-0" aria-hidden="true" />
                  <SelectValue placeholder={t("clock.switchJobPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {jobList.data.jobs
                    .filter((j) => j.id !== open.job?.id)
                    .map((j) => (
                      <SelectItem key={j.id} value={j.id}>
                        {j.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )
      ) : (
        <div className="flex w-full max-w-sm flex-col gap-3">
          {jobList.data && jobList.data.jobs.length > 0 && (
            <Select
              disabled={busy}
              value={jobId === "" ? NO_JOB : jobId}
              onValueChange={(v) => setJobId(v === NO_JOB ? "" : v)}
            >
              <SelectTrigger aria-label={t("clock.job")} className="h-14 min-h-14 rounded-xl">
                <Briefcase className="size-5 shrink-0" aria-hidden="true" />
                <SelectValue placeholder={t("clock.noJob")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_JOB}>{t("clock.noJob")}</SelectItem>
                {jobList.data.jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Giant primary action */}
          <Button
            disabled={busy}
            onClick={() => clockIn.mutate()}
            className="h-20 w-full rounded-xl text-2xl font-semibold"
          >
            <LogIn className="size-7" aria-hidden="true" /> {t("clock.clockIn")}
          </Button>
        </div>
      )}

      {queued > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <CloudOff className="size-4" aria-hidden="true" />
          {t("clock.offlinePending", { n: queued })}
        </div>
      )}
    </div>
  );
}
