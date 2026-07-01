"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLiveTimer } from "@/hooks/use-live-timer";
import { enqueuePunch, flushQueue, queuedPunches, isNetworkError } from "@/lib/offline-queue";
import { t } from "@/lib/i18n";

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

export default function ClockPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const [jobId, setJobId] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);

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
    setQueued(queuedPunches().length);
    const flush = () =>
      flushQueue().then((n) => {
        setQueued(queuedPunches().length);
        if (n > 0) {
          setMsg(t("synced_punches", { n }));
          qc.invalidateQueries({ queryKey: ["clock-status"] });
        }
      });
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [qc]);

  const act = (path: string, data?: Record<string, unknown>) =>
    apiPost(path, data)
      .then((r) => {
        setMsg(null);
        qc.invalidateQueries({ queryKey: ["clock-status"] });
        return r;
      })
      .catch((e) => {
        // Network down: queue clock in/out punches for replay (P12).
        if (isNetworkError(e) && (path === "/clock/in" || path === "/clock/out")) {
          enqueuePunch(path, data ?? {});
          setQueued(queuedPunches().length);
          setMsg(t("offline_queued"));
          return {};
        }
        setMsg(e instanceof ApiError ? `${(e.body as { error?: string })?.error ?? e.status}` : "failed");
        throw e;
      });

  const clockIn = useMutation({ mutationFn: () => act("/clock/in", { jobId: jobId || null }) });
  const clockOut = useMutation({
    mutationFn: () =>
      act("/clock/out").then((r) => {
        const out = r as { workedMinutes: number; autoDeductedMin: number };
        setMsg(
          `Worked ${(out.workedMinutes / 60).toFixed(2)}h` +
            (out.autoDeductedMin > 0 ? ` (auto-deducted ${out.autoDeductedMin}min break)` : ""),
        );
      }),
  });
  const breakStart = useMutation({ mutationFn: () => act("/clock/break/start", { paid: false }) });
  const breakEnd = useMutation({ mutationFn: () => act("/clock/break/end") });
  const switchJob = useMutation({ mutationFn: (id: string) => act("/clock/switch-job", { jobId: id }) });

  if (isLoading)
    return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!session)
    return (
      <Shell>
        <p className="text-slate-400">
          Not signed in. <Link className="underline" href="/pin">PIN sign-in</Link> first.
        </p>
      </Shell>
    );

  return (
    <Shell>
      <p className="text-lg">
        <span className="font-semibold">{session.employee.displayName}</span>{" "}
        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs uppercase text-slate-400">
          {session.employee.role}
        </span>
      </p>

      {open ? (
        <div className="flex flex-col items-center gap-5">
          <div className="text-center">
            <div className="font-mono text-6xl tabular-nums">{timer}</div>
            <div className="mt-1 text-sm text-slate-400">
              since {new Date(open.clockIn).toLocaleTimeString("en-NZ")}
              {open.job ? <> · job: <span className="text-slate-200">{open.job.name}</span></> : null}
              {open.unpaidBreakMin > 0 ? <> · {open.unpaidBreakMin}min break taken</> : null}
            </div>
          </div>

          {open.onBreak ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-8 py-4">
              <div className="text-amber-300">
                On {open.onBreak.paid ? "paid" : "unpaid"} break · {breakTimer}
              </div>
              <Btn onClick={() => breakEnd.mutate()} color="amber">End break</Btn>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-3">
              <Btn onClick={() => breakStart.mutate()} color="slate">Start break</Btn>
              {jobList.data && jobList.data.jobs.length > 0 && (
                <select
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm"
                  value=""
                  onChange={(e) => e.target.value && switchJob.mutate(e.target.value)}
                >
                  <option value="">Switch job…</option>
                  {jobList.data.jobs
                    .filter((j) => j.id !== open.job?.id)
                    .map((j) => (
                      <option key={j.id} value={j.id}>{j.name}</option>
                    ))}
                </select>
              )}
              <Btn onClick={() => clockOut.mutate()} color="rose">Clock out</Btn>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          {jobList.data && jobList.data.jobs.length > 0 && (
            <select
              className="rounded-lg bg-slate-800 px-4 py-3"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">No job / general</option>
              {jobList.data.jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.name}</option>
              ))}
            </select>
          )}
          <Btn onClick={() => clockIn.mutate()} color="sky" big>Clock in</Btn>
        </div>
      )}

      {msg && <p className="text-sm text-slate-300">{msg}</p>}
      {queued > 0 && (
        <p className="rounded bg-amber-500/20 px-3 py-1 text-xs text-amber-300">
          {queued} offline punch(es) pending sync
        </p>
      )}
      <nav className="flex gap-4 text-sm text-slate-500">
        <Link href="/my-hours" className="underline">My hours</Link>
        <Link href="/roster" className="underline">Roster</Link>
        <Link href="/leave" className="underline">Leave</Link>
      </nav>
    </Shell>
  );
}

function Btn({
  children,
  onClick,
  color,
  big,
}: {
  children: React.ReactNode;
  onClick: () => void;
  color: "sky" | "rose" | "slate" | "amber";
  big?: boolean;
}) {
  const colors = {
    sky: "bg-sky-500 text-slate-950 hover:bg-sky-400",
    rose: "bg-rose-500 text-slate-950 hover:bg-rose-400",
    slate: "bg-slate-800 text-slate-100 hover:bg-slate-700",
    amber: "bg-amber-500 text-slate-950 hover:bg-amber-400",
  };
  return (
    <button
      onClick={onClick}
      className={`rounded-xl font-semibold transition active:scale-95 ${colors[color]} ${
        big ? "px-12 py-6 text-2xl" : "px-6 py-3"
      }`}
    >
      {children}
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-6 text-slate-100">
      <h1 className="text-xl font-semibold">🕐 Time Clock</h1>
      {children}
    </main>
  );
}
