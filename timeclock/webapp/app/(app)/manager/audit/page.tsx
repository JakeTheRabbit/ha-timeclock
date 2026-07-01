"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface AuditRow {
  id: number;
  createdAt: string;
  entityType: string;
  entityId: string;
  action: string;
  actorId: string | null;
  reason: string | null;
  oldValue: string | null;
  newValue: string | null;
  hash: string;
}

export default function AuditPage() {
  const { session, isLoading } = useSession();
  const [entityType, setEntityType] = useState("");
  const canSee = session && ["lead", "manager", "admin"].includes(session.employee.role);

  const verify = useQuery({
    queryKey: ["audit-verify"],
    queryFn: () => apiGet<{ ok: boolean; broken_at: number | null; detail: string }>("/manager/audit/verify"),
    enabled: !!canSee,
  });
  const rows = useQuery({
    queryKey: ["audit-rows", entityType],
    queryFn: () =>
      apiGet<{ rows: AuditRow[] }>(
        `/manager/audit?limit=200${entityType ? `&entityType=${entityType}` : ""}`,
      ),
    enabled: !!canSee,
  });

  if (isLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!canSee) return <Shell><p className="text-rose-400">Lead role or above required.</p></Shell>;

  return (
    <Shell>
      <div className="flex items-center gap-3">
        {verify.data && (
          <span
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              verify.data.ok ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
            }`}
          >
            {verify.data.ok ? "⛓ hash chain intact" : `⚠ CHAIN BROKEN at #${verify.data.broken_at}`}
          </span>
        )}
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="rounded bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="">all entities</option>
          {["time_entry", "break", "employee", "correction", "leave_request", "leave_ledger", "roster", "pay_period", "device", "settings", "job"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        {rows.data?.rows.map((r) => (
          <details key={r.id} className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
            <summary className="cursor-pointer">
              <span className="font-mono text-xs text-slate-500">#{r.id}</span>{" "}
              <span className="text-slate-400">{new Date(r.createdAt).toLocaleString("en-NZ")}</span>{" "}
              <span className="font-medium">{r.entityType}</span> ·{" "}
              <span className="text-sky-300">{r.action}</span>
              {r.reason && <span className="text-slate-400"> — {r.reason}</span>}
            </summary>
            <div className="mt-2 grid gap-1 font-mono text-xs text-slate-400">
              <div>entity: {r.entityId}</div>
              {r.actorId && <div>actor: {r.actorId}</div>}
              {r.oldValue && <div className="text-rose-300/70">old: {r.oldValue}</div>}
              {r.newValue && <div className="text-emerald-300/70">new: {r.newValue}</div>}
              <div>hash: {r.hash.slice(0, 16)}…</div>
            </div>
          </details>
        ))}
      </div>
      <Link href="/manager" className="text-sm text-slate-500 underline">← manager</Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <h1 className="text-xl font-semibold">Compliance audit</h1>
        {children}
      </div>
    </main>
  );
}
