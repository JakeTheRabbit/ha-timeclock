"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useLiveTimer } from "@/hooks/use-live-timer";

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
interface PendingCorrection {
  id: string;
  employeeName: string;
  reason: string;
  requested: { clockIn?: string; clockOut?: string; note?: string };
  createdAt: string;
}
interface PendingLeave {
  id: string;
  employeeName: string;
  type: string;
  startDate: string;
  endDate: string;
  hours: string;
  note: string | null;
}

function LiveRow({ e }: { e: Board["clockedIn"][number] }) {
  const timer = useLiveTimer(e.clockIn);
  return (
    <tr className="border-b border-slate-900">
      <td className="py-2 pr-3 font-medium">{e.employeeName}</td>
      <td className="py-2 pr-3 font-mono">{timer}</td>
      <td className="py-2 pr-3">
        {e.onBreak ? (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">on break</span>
        ) : (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">working</span>
        )}
      </td>
    </tr>
  );
}

export default function ManagerPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const [msg, setMsg] = useState<string | null>(null);
  const canSee = session && ["lead", "manager", "admin"].includes(session.employee.role);

  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => apiGet<Board>("/manager/board"),
    enabled: !!canSee,
    refetchInterval: 15_000,
  });
  const corrections = useQuery({
    queryKey: ["pending-corrections"],
    queryFn: () => apiGet<{ corrections: PendingCorrection[] }>("/corrections/pending"),
    enabled: !!canSee,
  });
  const leave = useQuery({
    queryKey: ["pending-leave"],
    queryFn: () => apiGet<{ requests: PendingLeave[] }>("/leave/pending"),
    enabled: !!canSee,
  });

  const act = (path: string) =>
    apiPost(path, {}).then(() => {
      setMsg("Done.");
      qc.invalidateQueries();
    }).catch(() => setMsg("Action failed."));

  if (isLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!canSee)
    return (
      <Shell>
        <p className="text-rose-400">Lead role or above required.</p>
        <Link className="text-sm underline" href="/pin">PIN sign-in</Link>
      </Shell>
    );

  return (
    <Shell>
      <nav className="flex flex-wrap gap-2 text-sm">
        <Tab href="/manager" active>Live board</Tab>
        <Tab href="/manager/pay-periods">Pay periods</Tab>
        <Tab href="/manager/audit">Audit</Tab>
        <Tab href="/admin/employees">Employees</Tab>
        <Tab href="/admin/settings">Settings</Tab>
      </nav>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">On the clock now</h2>
        {board.data?.clockedIn.length === 0 && <p className="text-slate-500">Nobody clocked in.</p>}
        {board.data && board.data.clockedIn.length > 0 && (
          <table className="w-full border-collapse text-sm">
            <tbody>{board.data.clockedIn.map((e) => <LiveRow key={e.entryId} e={e} />)}</tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">
          Correction requests ({corrections.data?.corrections.length ?? 0})
        </h2>
        {corrections.data?.corrections.map((cr) => (
          <div key={cr.id} className="mb-2 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
            <div className="flex-1">
              <span className="font-medium">{cr.employeeName}</span>{" "}
              <span className="text-slate-400">— {cr.reason}</span>
              <div className="text-xs text-slate-500">
                {cr.requested.clockIn && <>in → {new Date(cr.requested.clockIn).toLocaleString("en-NZ")} · </>}
                {cr.requested.clockOut && <>out → {new Date(cr.requested.clockOut).toLocaleString("en-NZ")}</>}
              </div>
            </div>
            <button onClick={() => act(`/corrections/${cr.id}/approve`)} className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold hover:bg-emerald-500">approve</button>
            <button onClick={() => act(`/corrections/${cr.id}/reject`)} className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold hover:bg-rose-500">reject</button>
          </div>
        ))}
        {corrections.data?.corrections.length === 0 && <p className="text-sm text-slate-500">None pending.</p>}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">
          Leave requests ({leave.data?.requests.length ?? 0})
        </h2>
        {leave.data?.requests.map((lr) => (
          <div key={lr.id} className="mb-2 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
            <div className="flex-1">
              <span className="font-medium">{lr.employeeName}</span>{" "}
              <span className="text-slate-400">
                — {lr.type} {lr.startDate}→{lr.endDate} ({lr.hours}h){lr.note ? ` · ${lr.note}` : ""}
              </span>
            </div>
            <button onClick={() => act(`/leave/${lr.id}/approve`)} className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold hover:bg-emerald-500">approve</button>
            <button onClick={() => act(`/leave/${lr.id}/reject`)} className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold hover:bg-rose-500">reject</button>
          </div>
        ))}
        {leave.data?.requests.length === 0 && <p className="text-sm text-slate-500">None pending.</p>}
      </section>

      {msg && <p className="text-sm text-slate-400">{msg}</p>}
    </Shell>
  );
}

function Tab({ href, children, active }: { href: string; children: React.ReactNode; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 ${active ? "bg-sky-500 font-semibold text-slate-950" : "bg-slate-800 hover:bg-slate-700"}`}
    >
      {children}
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <h1 className="text-xl font-semibold">Manager</h1>
        {children}
      </div>
    </main>
  );
}
