"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface Mine {
  balances: Record<string, number>;
  requests: {
    id: string;
    type: string;
    startDate: string;
    endDate: string;
    hours: string;
    status: string;
    note: string | null;
  }[];
}

export default function LeavePage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const [form, setForm] = useState({ type: "annual", startDate: "", endDate: "", hours: "8", note: "" });
  const [msg, setMsg] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ["leave-mine"],
    queryFn: () => apiGet<Mine>("/leave/mine"),
    enabled: !!session,
  });

  const submit = useMutation({
    mutationFn: () =>
      apiPost("/leave", {
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        hours: Number(form.hours),
        note: form.note || undefined,
      }),
    onSuccess: () => {
      setMsg("Requested — awaiting approval.");
      qc.invalidateQueries({ queryKey: ["leave-mine"] });
    },
    onError: (e) =>
      setMsg(
        e instanceof ApiError && (e.body as { error?: string })?.error === "insufficient_balance"
          ? `Not enough balance (${(e.body as { available?: number }).available?.toFixed(1)}h available).`
          : "Request failed.",
      ),
  });

  if (isLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!session)
    return <Shell><p className="text-slate-400">Not signed in — <Link className="underline" href="/pin">PIN sign-in</Link>.</p></Shell>;

  return (
    <Shell>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(mine.data?.balances ?? {}).map(([type, hours]) => (
          <div key={type} className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3">
            <div className="text-xs uppercase text-slate-500">{type.replace("_", " ")}</div>
            <div className="font-mono text-xl">{hours.toFixed(1)}h</div>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4 text-sm">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Type
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="rounded bg-slate-800 px-3 py-2 text-slate-100">
            {["annual", "sick", "bereavement", "alt_holiday", "unpaid"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          From
          <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="rounded bg-slate-800 px-3 py-2 text-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          To
          <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="rounded bg-slate-800 px-3 py-2 text-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Hours
          <input inputMode="decimal" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}
            className="w-20 rounded bg-slate-800 px-3 py-2 text-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Note
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="rounded bg-slate-800 px-3 py-2 text-slate-100" />
        </label>
        <button
          onClick={() => submit.mutate()}
          disabled={!form.startDate || submit.isPending}
          className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
        >
          Request leave
        </button>
      </section>

      {msg && <p className="text-sm text-slate-300">{msg}</p>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-3">Type</th><th className="py-2 pr-3">Dates</th>
            <th className="py-2 pr-3">Hours</th><th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {mine.data?.requests.map((r) => (
            <tr key={r.id} className="border-b border-slate-900">
              <td className="py-2 pr-3">{r.type}</td>
              <td className="py-2 pr-3">{r.startDate} → {r.endDate}</td>
              <td className="py-2 pr-3 font-mono">{r.hours}</td>
              <td className="py-2">
                <span className={`rounded px-2 py-0.5 text-xs ${
                  r.status === "approved" ? "bg-emerald-500/20 text-emerald-300"
                  : r.status === "rejected" ? "bg-rose-500/20 text-rose-300"
                  : "bg-slate-700 text-slate-300"}`}>
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Link href="/clock" className="text-sm text-slate-500 underline">← clock</Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <h1 className="text-xl font-semibold">Leave</h1>
        {children}
      </div>
    </main>
  );
}
