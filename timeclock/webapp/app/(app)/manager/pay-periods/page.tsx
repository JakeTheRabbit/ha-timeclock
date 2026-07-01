"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface Period {
  id: string;
  startAt: string;
  endAt: string;
  lockedAt: string | null;
}
interface TimesheetRow {
  employeeId: string;
  employeeName: string;
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
const d = (iso: string) => new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short" });

export default function PayPeriodsPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canSee = session && ["lead", "manager", "admin"].includes(session.employee.role);

  const periods = useQuery({
    queryKey: ["pay-periods"],
    queryFn: () => apiGet<{ periods: Period[] }>("/manager/pay-periods"),
    enabled: !!canSee,
  });
  const timesheet = useQuery({
    queryKey: ["timesheet", selected],
    queryFn: () => apiGet<{ period: Period; rows: TimesheetRow[] }>(`/manager/pay-periods/${selected}/timesheet`),
    enabled: !!selected,
  });

  const lock = useMutation({
    mutationFn: (id: string) => apiPost(`/manager/pay-periods/${id}/lock`),
    onSuccess: () => {
      setMsg("Period locked — entries inside are now immutable.");
      qc.invalidateQueries({ queryKey: ["pay-periods"] });
    },
    onError: (e) =>
      setMsg(
        e instanceof ApiError
          ? `Lock refused: ${(e.body as { error?: string })?.error}`
          : "Lock failed",
      ),
  });

  if (isLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!canSee) return <Shell><p className="text-rose-400">Lead role or above required.</p></Shell>;

  return (
    <Shell>
      <div className="flex flex-wrap gap-2">
        {periods.data?.periods.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelected(p.id)}
            className={`rounded-lg px-3 py-2 text-sm ${
              selected === p.id ? "bg-sky-500 font-semibold text-slate-950" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            {d(p.startAt)} – {d(p.endAt)} {p.lockedAt && "🔒"}
          </button>
        ))}
      </div>

      {selected && timesheet.data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {!timesheet.data.period.lockedAt ? (
              <button
                onClick={() => lock.mutate(selected)}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-500"
              >
                Sign off + LOCK period
              </button>
            ) : (
              <span className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-300">
                🔒 locked {new Date(timesheet.data.period.lockedAt).toLocaleString("en-NZ")}
              </span>
            )}
            <a
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
              href={`${BASE}/api/reports/timesheet.csv?periodId=${selected}`}
            >
              ⬇ timesheet CSV
            </a>
            <a
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
              href={`${BASE}/api/reports/timesheet.pdf?periodId=${selected}`}
            >
              ⬇ PDF
            </a>
            <a
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700"
              href={`${BASE}/api/reports/payroll?periodId=${selected}&adapter=csv`}
            >
              ⬇ payroll CSV
            </a>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                <th className="py-2 pr-3">Employee</th>
                <th className="py-2 pr-3">Worked</th>
                <th className="py-2 pr-3">Ordinary</th>
                <th className="py-2 pr-3">OT 1.5</th>
                <th className="py-2 pr-3">OT 2.0</th>
                <th className="py-2 pr-3">Stat T1.5</th>
                <th className="py-2 pr-3">Alt hol.</th>
                <th className="py-2 pr-3">Edited</th>
                <th className="py-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {timesheet.data.rows.map((r) => (
                <tr key={r.employeeId} className="border-b border-slate-900">
                  <td className="py-2 pr-3 font-medium">{r.employeeName}</td>
                  <td className="py-2 pr-3 font-mono">{h(r.totals.workedMin)}</td>
                  <td className="py-2 pr-3 font-mono">{h(r.totals.ordinaryMin)}</td>
                  <td className="py-2 pr-3 font-mono">{h(r.totals.ot1Min)}</td>
                  <td className="py-2 pr-3 font-mono">{h(r.totals.ot2Min)}</td>
                  <td className="py-2 pr-3 font-mono">{h(r.totals.statT15Min)}</td>
                  <td className="py-2 pr-3">{r.totals.altHolidaysEarned || "—"}</td>
                  <td className="py-2 pr-3">
                    {r.totals.editedDays > 0 ? (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                        {r.totals.editedDays}d
                      </span>
                    ) : "—"}
                  </td>
                  <td className="py-2">
                    {r.totals.complianceFlagCount > 0 ? (
                      <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-xs text-rose-300">
                        {r.totals.complianceFlagCount}
                      </span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
              {timesheet.data.rows.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-slate-500">No worked time in this period.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {msg && <p className="text-sm text-slate-400">{msg}</p>}
      <Link href="/manager" className="text-sm text-slate-500 underline">← manager</Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <h1 className="text-xl font-semibold">Pay periods</h1>
        {children}
      </div>
    </main>
  );
}
