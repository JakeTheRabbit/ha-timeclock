"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { apiGet, apiPost } from "@/lib/api-client";
import { apiErrorCode, apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { useLiveTimer } from "@/hooks/use-live-timer";
import { enqueuePunch, flushQueue, queuedPunches, isNetworkError, type QueuedPunch } from "@/lib/offline-queue";
import { useT } from "@/lib/i18n";
import { useLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fmtH,
  fmtHm,
  liveTodayMin,
  shiftWhen,
  useClockContext,
  useClockStatus,
  type ClockStatus as Status,
} from "@/hooks/use-clock-context";
import { breakLengthMin, breakProgress } from "@/lib/clock-context";
import { autoDeductMinutes } from "@/server/domain/time/breaks";

const HM = { hour: "2-digit", minute: "2-digit" } as const;

interface Jobs {
  jobs: { id: string; name: string; code: string | null }[];
}

/** Marker returned by act() when the punch was queued offline instead of sent. */
interface ActResult {
  queued?: boolean;
  [key: string]: unknown;
}

const NO_JOB = "__none__";
const AUTO_SIGN_OUT_S = 5;
type Done = "in" | "out" | "breakStart" | "breakEnd";

/** Best-effort location; null if denied, unavailable or slow. */
const getGeo = () =>
  new Promise<{ lat: number; lng: number } | null>((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });

/** Camera photo → downscaled JPEG data URL (well under the 3 MB cap). */
const toJpeg = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

export default function ClockPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const loc = useLocale();
  const t = useT();
  const [jobId, setJobId] = useState<string>("");
  const [jobTouched, setJobTouched] = useState(false);
  const [confirmOut, setConfirmOut] = useState(0); // minutes auto-deduct would take; 0 = closed
  const me = session?.employee.id ?? "";
  const router = useRouter();

  // Shared kiosk (PIN sign-in on a bound device): after a punch, confirm it,
  // then sign out back to /pin unless someone taps. Personal phones: no-op.
  const [done, setDone] = useState<{ kind: Done; left: number } | null>(null);
  const finish = (kind: Done) => {
    if (session?.kiosk) setDone({ kind, left: AUTO_SIGN_OUT_S });
  };
  useEffect(() => {
    if (!done) return;
    const cancel = () => setDone(null);
    window.addEventListener("keydown", cancel);
    const id = setTimeout(() => {
      if (done.left > 1) return setDone({ ...done, left: done.left - 1 });
      setDone(null);
      apiPost("/auth/logout")
        .catch(() => {})
        .finally(() => {
          qc.clear(); // drop this person's cached data before the next one signs in
          router.replace("/pin");
        });
    }, 1000);
    return () => {
      clearTimeout(id);
      window.removeEventListener("keydown", cancel);
    };
  }, [done, qc, router]);

  const status = useClockStatus(!!session);
  const ctx = useClockContext(!!session);
  const jobList = useQuery({
    queryKey: ["clock-jobs"],
    queryFn: () => apiGet<Jobs>("/clock/jobs"),
    enabled: !!session,
  });

  // Prefill the job from the rostered shift (current/next), else the last entry.
  useEffect(() => {
    if (jobTouched || !ctx.likelyJobId || !jobList.data) return;
    if (jobList.data.jobs.some((j) => j.id === ctx.likelyJobId)) setJobId(ctx.likelyJobId);
  }, [jobTouched, ctx.likelyJobId, jobList.data]);

  const [queue, setQueue] = useState<QueuedPunch[]>([]);
  const queued = queue.length;
  const lastQueued = queue[queue.length - 1] ?? null;
  const photoInput = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);

  // A punch queued offline is what the person did — show it, not stale state.
  const serverOpen = status.data?.open ?? null;
  const pendingIn = lastQueued?.path === "/clock/in";
  const pendingOut = lastQueued?.path === "/clock/out";
  const open: Status["open"] = pendingOut
    ? null
    : (serverOpen ??
      (pendingIn
        ? { entryId: "", clockIn: lastQueued!.queuedAt, job: null, onBreak: null, unpaidBreakMin: 0 }
        : null));
  const since = open?.shiftStart ?? open?.clockIn ?? null;
  const timer = useLiveTimer(since);
  const breakTimer = useLiveTimer(open?.onBreak?.startAt ?? null);
  const todayMin = liveTodayMin(status.data, status.dataUpdatedAt);
  const mealMin = status.data?.breakRule?.autoDeductMin ?? 30;

  // Rest/meal entitlement for the shift as expected (rostered / usual / so far).
  const chainBreaks = open?.breaks ?? [];
  const elapsedMin = since ? (Date.now() - +new Date(since)) / 60_000 : 0;
  const shiftLen = ctx.next?.current ? (+ctx.next.end - +ctx.next.start) / 60_000 : 0;
  const progress = breakProgress(Math.max(elapsedMin, shiftLen, ctx.usualDayMin ?? 0), chainBreaks);
  const breakEndsAt = open?.onBreak
    ? new Date(+new Date(open.onBreak.startAt) + breakLengthMin(open.onBreak.paid, mealMin) * 60_000)
    : null;
  const overrun = !!breakEndsAt && Date.now() > +breakEndsAt;
  const overrunMin = overrun ? Math.floor((Date.now() - +breakEndsAt!) / 60_000) : 0;

  // Offline queue: flush on mount + whenever connectivity returns. Only the
  // signed-in person's own punches — a shared kiosk holds several people's.
  useEffect(() => {
    if (!me) return setQueue([]);
    const flush = () =>
      flushQueue(me).then((n) => {
        setQueue(queuedPunches(me));
        if (n > 0) {
          toast.success(t(n === 1 ? "clock.syncedPunches.one" : "clock.syncedPunches.other", { n }));
          qc.invalidateQueries({ queryKey: ["clock-status"] });
        }
      });
    setQueue(queuedPunches(me));
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [qc, t, me]);

  const act = (path: string, data?: Record<string, unknown>): Promise<ActResult> =>
    apiPost<ActResult>(path, data)
      .then((r) => {
        qc.invalidateQueries({ queryKey: ["clock-status"] });
        qc.invalidateQueries({ queryKey: ["clock-context-entries"] });
        return r ?? {};
      })
      .catch((e) => {
        // Network down: queue clock in/out punches for replay (P12).
        if (isNetworkError(e) && (path === "/clock/in" || path === "/clock/out")) {
          enqueuePunch(me, path, data ?? {});
          setQueue(queuedPunches(me));
          toast.info(t("clock.offlineQueued"));
          return { queued: true };
        }
        toast.error(apiErrorCode(e) === "just_clocked_out" ? t("clock.justClockedOut") : apiErrorText(e, t));
        throw e;
      });

  const requires = status.data?.requires;
  const clockIn = useMutation({
    mutationFn: async (photo?: string) => {
      let geo: { lat: number; lng: number } | null = null;
      if (requires?.geo) {
        setLocating(true);
        geo = await getGeo().finally(() => setLocating(false));
        if (!geo) toast.warning(t("clock.noLocation"));
      }
      return act("/clock/in", { jobId: jobId || null, ...(geo && { geo }), ...(photo && { photo }) });
    },
    onSuccess: (r) => {
      if (!r.queued) toast.success(t("toast.clockedIn"));
      finish("in");
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
    onSuccess: () => finish("out"),
  });
  // NZ break semantics (matches the compliance engine): 10-min rest breaks are
  // PAID, the meal break is UNPAID. Employees pick which they're taking.
  const breakStart = useMutation({
    mutationFn: (paid: boolean) => act("/clock/break/start", { paid }),
    onSuccess: () => {
      toast.success(t("toast.breakStarted"));
      finish("breakStart");
    },
  });
  const breakEnd = useMutation({
    mutationFn: () => act("/clock/break/end"),
    onSuccess: () => {
      toast.success(t("toast.breakEnded"));
      finish("breakEnd");
    },
  });
  const switchJob = useMutation({
    mutationFn: (id: string) => act("/clock/switch-job", { jobId: id }),
    onSuccess: () => toast.success(t("toast.switchedJob")),
  });

  // Photo-on-punch: the camera has to open from the tap itself.
  const startClockIn = () => (requires?.photo ? photoInput.current?.click() : clockIn.mutate(undefined));

  // Same rule the server applies at clock-out (current entry's span + unpaid breaks).
  const startClockOut = () => {
    const rule = status.data?.breakRule;
    const deduct =
      serverOpen && rule
        ? autoDeductMinutes((Date.now() - +new Date(serverOpen.clockIn)) / 60_000, serverOpen.unpaidBreakMin, rule)
        : 0;
    if (deduct > 0) setConfirmOut(deduct);
    else clockOut.mutate();
  };

  const busy =
    locating ||
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
            <Badge className="px-3 py-1 text-sm">
              {pendingIn ? t("clock.clockedInPendingSync") : t("clock.clockedIn")}
            </Badge>
            <div className="font-mono text-6xl tabular-nums sm:text-7xl">{timer}</div>
            <div className="text-sm text-muted-foreground">
              {t("clock.since", { time: loc.time(since!, HM) })}
              {status.data?.todayWorkedMin != null && (
                <>
                  {" "}
                  · <span className="text-foreground">{t("clock.todayTotal", { total: fmtHm(t, todayMin) })}</span>
                </>
              )}
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
            {!open.onBreak && (progress.restDue > 0 || progress.mealDue) && (
              <div className="flex gap-2 text-sm">
                {progress.restDue > 0 && (
                  <Badge variant={progress.restTaken >= progress.restDue ? "secondary" : "outline"}>
                    <Coffee aria-hidden="true" />
                    {t("clock.restProgress", { taken: progress.restTaken, due: progress.restDue })}
                  </Badge>
                )}
                {progress.mealDue && (
                  <Badge variant={progress.mealTaken ? "secondary" : "outline"}>
                    <UtensilsCrossed aria-hidden="true" />
                    {progress.mealTaken ? t("clock.mealTaken") : t("clock.mealDue")}
                  </Badge>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <Badge variant="secondary" className="px-3 py-1 text-sm">
              {pendingOut ? t("clock.clockedOutPendingSync") : t("clock.clockedOut")}
            </Badge>
            {/* Context instead of a dead 0:00:00: last out, today, week vs usual, next shift. */}
            <div className="flex flex-col gap-1 text-base text-muted-foreground">
              <div>
                {[
                  ctx.lastOut && t("clock.lastOut", { time: loc.time(ctx.lastOut, HM) }),
                  status.data?.todayWorkedMin != null &&
                    t("clock.todayTotal", { total: fmtHm(t, status.data.todayWorkedMin) }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              <div>
                {[
                  ctx.ready &&
                    (ctx.usualWeekMin
                      ? t("clock.weekVsUsual", { week: fmtH(t, loc, ctx.weekMin), usual: fmtH(t, loc, ctx.usualWeekMin) })
                      : t("clock.weekTotal", { week: fmtH(t, loc, ctx.weekMin) })),
                  ctx.next && t("clock.nextShift", { when: shiftWhen(t, loc, ctx.next) }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </>
        )}
      </div>

      {open ? (
        open.onBreak ? (
          /* On break: end break is the only action (matches previous behavior). */
          /* Amber once the break runs past its expected end. */
          <div
            className={cn(
              "flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border px-6 py-5",
              overrun ? "border-amber-500/40 bg-amber-500/10" : "border-border bg-card",
            )}
          >
            <div className={cn("flex items-center gap-2", overrun && "text-amber-700 dark:text-amber-300")}>
              <Coffee className="size-5" aria-hidden="true" />
              {open.onBreak.paid ? t("clock.onBreakPaid") : t("clock.onBreakUnpaid")} ·{" "}
              <span className="font-mono tabular-nums">{breakTimer}</span>
            </div>
            {breakEndsAt && (
              <div className={cn("text-sm", overrun ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                {t(open.onBreak.paid ? "clock.restEnds" : "clock.mealEnds", { time: loc.time(breakEndsAt, HM) })}
                {overrun && <> · {t("clock.breakOverrun", { n: overrunMin })}</>}
              </div>
            )}
            <Button
              disabled={busy}
              onClick={() => breakEnd.mutate()}
              className={cn(
                "h-16 w-full rounded-xl text-xl font-semibold",
                overrun && "bg-amber-500 text-amber-950 hover:bg-amber-400 active:bg-amber-400/90",
              )}
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
              onClick={startClockOut}
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
              onValueChange={(v) => {
                setJobTouched(true);
                setJobId(v === NO_JOB ? "" : v);
              }}
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
            onClick={startClockIn}
            className="h-20 w-full rounded-xl text-2xl font-semibold"
          >
            <LogIn className="size-7" aria-hidden="true" /> {locating ? t("clock.locating") : t("clock.clockIn")}
          </Button>
          {requires?.photo && <p className="text-center text-xs text-muted-foreground">{t("clock.photoHint")}</p>}
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                clockIn.mutate(await toJpeg(f));
              } catch {
                toast.error(t("error.photo_not_jpeg"));
              }
            }}
          />
        </div>
      )}

      {queued > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <CloudOff className="size-4" aria-hidden="true" />
          {t(queued === 1 ? "clock.offlinePending.one" : "clock.offlinePending.other", { n: queued })}
          {lastQueued && <> · {loc.time(lastQueued.queuedAt)}</>}
        </div>
      )}

      {/* Kiosk auto sign-out: covers the screen so the cancelling tap can't hit a button. */}
      {done && (
        <button
          type="button"
          onClick={() => setDone(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center"
        >
          <span className="text-3xl font-semibold">
            {{
              in: t("clock.clockedIn"),
              out: t("clock.clockedOut"),
              breakStart: t("toast.breakStarted"),
              breakEnd: t("toast.breakEnded"),
            }[done.kind]}{" "}
            · {t("clock.todayTotal", { total: fmtHm(t, todayMin) })}
          </span>
          <span className="text-base text-muted-foreground">{t("kiosk.signingOut", { n: done.left })}</span>
        </button>
      )}

      {/* Clock-out would trigger the auto-deducted meal break: say so first. */}
      <Dialog open={confirmOut > 0} onOpenChange={(o) => !o && setConfirmOut(0)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("clock.noMealTitle")}</DialogTitle>
            <DialogDescription>{t("clock.noMealBody", { n: confirmOut })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirmOut(0);
                breakStart.mutate(false);
              }}
            >
              <UtensilsCrossed aria-hidden="true" /> {t("clock.takeMealNow")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmOut(0);
                clockOut.mutate();
              }}
            >
              <LogOut aria-hidden="true" /> {t("clock.outAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
