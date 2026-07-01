"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface Shift {
  id: string;
  employeeId: string;
  employeeName?: string;
  shiftDate: string;
  startMin: number;
  endMin: number;
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

const t = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-emerald-500/20 text-emerald-300",
  in_progress: "bg-sky-500/20 text-sky-300",
  upcoming: "bg-slate-700 text-slate-300",
  late: "bg-amber-500/20 text-amber-300",
  no_show: "bg-rose-500/20 text-rose-300",
};

export default function RosterPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const isLead = session && ["lead", "manager", "admin"].includes(session.employee.role);
  const [date, setDate] = useState(todayISO());
  const [form, setForm] = useState({ employeeId: "", start: "08:00", end: "16:30" });
  const [msg, setMsg] = useState<string | null>(null);

  const week = useMemo(() => {
    const from = new Date(date + "T00:00:00");
    const to = new Date(from.getTime() + 6 * 86_400_000);
    return { from: date, to: to.toISOString().slice(0, 10) };
  }, [date]);

  const mine = useQuery({
    queryKey: ["roster-mine", week.from],
    queryFn: () => apiGet<{ shifts: Shift[] }>(`/roster/mine?from=${week.from}&to=${week.to}`),
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
      setMsg("Shift added.");
      qc.invalidateQueries();
    },
    onError: () => setMsg("Add failed."),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => apiPost(`/roster/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (isLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!session)
    return <Shell><p className="text-slate-400">Not signed in — <Link className="underline" href="/pin">PIN sign-in</Link>.</p></Shell>;

  const shifts = (isLead ? all.data?.shifts : mine.data?.shifts) ?? [];

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="rounded bg-slate-800 px-3 py-2 text-sm" />
        <span className="text-sm text-slate-500">week of {week.from}</span>
      </div>

      {isLead && (
        <section className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Employee
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="rounded bg-slate-800 px-3 py-2 text-slate-100">
              <option value="">choose…</option>
              {staff.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Start
            <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })}
              className="rounded bg-slate-800 px-3 py-2 text-slate-100" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            End
            <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })}
              className="rounded bg-slate-800 px-3 py-2 text-slate-100" />
          </label>
          <button
            onClick={() => add.mutate()}
            disabled={!form.employeeId || add.isPending}
            className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
          >
            Add shift on {date}
          </button>
        </section>
      )}

      {isLead && compare.data && compare.data.shifts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">Scheduled vs actual · {date}</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {compare.data.shifts.map((s) => (
                <tr key={s.rosterId} className="border-b border-slate-900">
                  <td className="py-2 pr-3 font-medium">{s.employeeName}</td>
                  <td className="py-2 pr-3 font-mono">{t(s.startMin)}–{t(s.endMin)}</td>
                  <td className="py-2 pr-3 font-mono text-slate-400">
                    {s.actualIn ? `in ${new Date(s.actualIn).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}` : "no punch"}
                  </td>
                  <td className="py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[s.status]}`}>
                      {s.status}{s.lateMin > 0 && ` +${s.lateMin}m`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">
          {isLead ? "All shifts this week" : "My shifts this week"}
        </h2>
        {shifts.length === 0 && <p className="text-sm text-slate-500">No shifts.</p>}
        <div className="flex flex-col gap-1">
          {shifts.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
              <span className="w-24 font-mono text-slate-400">{s.shiftDate}</span>
              <span className="font-mono">{t(s.startMin)}–{t(s.endMin)}</span>
              {isLead && <span className="font-medium">{s.employeeName}</span>}
              {s.note && <span className="text-slate-500">· {s.note}</span>}
              {isLead && (
                <button onClick={() => cancel.mutate(s.id)}
                  className="ml-auto rounded bg-slate-800 px-2 py-1 text-xs hover:bg-rose-600">
                  cancel
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {msg && <p className="text-sm text-slate-400">{msg}</p>}
      <Link href={isLead ? "/manager" : "/clock"} className="text-sm text-slate-500 underline">← back</Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <h1 className="text-xl font-semibold">Roster</h1>
        {children}
      </div>
    </main>
  );
}
