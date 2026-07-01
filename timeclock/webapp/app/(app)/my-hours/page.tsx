"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

interface EntryRow {
  id: string;
  clockIn: string;
  clockOut: string | null;
  edited: boolean;
  note: string | null;
  job: { id: string; name: string } | null;
  workedMinutes: number | null;
  breaks: { id: string; startAt: string; endAt: string | null; paid: boolean; autoDeducted: boolean }[];
}

type Range = "today" | "week" | "fortnight";

function rangeDates(r: Range): { from: Date; to: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (r === "week") {
    const day = (start.getDay() + 6) % 7; // Monday start
    start.setDate(start.getDate() - day);
  } else if (r === "fortnight") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day - 7);
  }
  const to = new Date(now.getTime() + 24 * 3600_000);
  return { from: start, to };
}

const fmtT = (s: string) => new Date(s).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
const fmtD = (s: string) => new Date(s).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
const hrs = (min: number | null) => (min == null ? "—" : (min / 60).toFixed(2) + "h");

export default function MyHoursPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const [range, setRange] = useState<Range>("week");
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const { from, to } = useMemo(() => rangeDates(range), [range]);
  const list = useQuery({
    queryKey: ["my-hours", range],
    queryFn: () =>
      apiGet<{ entries: EntryRow[] }>(
        `/entries/mine?from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
    enabled: !!session,
  });

  const totalMin = list.data?.entries.reduce((a, e) => a + (e.workedMinutes ?? 0), 0) ?? 0;

  if (isLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!session)
    return (
      <Shell>
        <p className="text-slate-400">
          Not signed in — <Link className="underline" href="/pin">PIN sign-in</Link>.
        </p>
      </Shell>
    );

  return (
    <Shell>
      <div className="flex items-center gap-2">
        {(["today", "week", "fortnight"] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-lg px-4 py-2 text-sm capitalize ${
              range === r ? "bg-sky-500 font-semibold text-slate-950" : "bg-slate-800 hover:bg-slate-700"
            }`}
          >
            {r}
          </button>
        ))}
        <span className="ml-auto text-sm text-slate-400">
          Total: <span className="font-mono text-slate-100">{hrs(totalMin)}</span>
        </span>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-3">Day</th>
            <th className="py-2 pr-3">In</th>
            <th className="py-2 pr-3">Out</th>
            <th className="py-2 pr-3">Breaks</th>
            <th className="py-2 pr-3">Job</th>
            <th className="py-2 pr-3">Worked</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {list.data?.entries.map((e) => (
            <tr key={e.id} className="border-b border-slate-900">
              <td className="py-2 pr-3">{fmtD(e.clockIn)}</td>
              <td className="py-2 pr-3 font-mono">{fmtT(e.clockIn)}</td>
              <td className="py-2 pr-3 font-mono">{e.clockOut ? fmtT(e.clockOut) : "open"}</td>
              <td className="py-2 pr-3 text-xs text-slate-400">
                {e.breaks.length === 0
                  ? "—"
                  : e.breaks
                      .map(
                        (b) =>
                          `${b.autoDeducted ? "auto " : ""}${b.paid ? "paid" : "unpaid"} ${
                            b.endAt
                              ? Math.round((+new Date(b.endAt) - +new Date(b.startAt)) / 60000) + "m"
                              : "open"
                          }`,
                      )
                      .join(", ")}
              </td>
              <td className="py-2 pr-3">{e.job?.name ?? "—"}</td>
              <td className="py-2 pr-3 font-mono">
                {hrs(e.workedMinutes)}
                {e.edited && (
                  <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">
                    edited
                  </span>
                )}
              </td>
              <td className="py-2 text-right">
                {e.clockOut && (
                  <button
                    onClick={() => setEditing(e)}
                    className="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
                  >
                    fix times
                  </button>
                )}
              </td>
            </tr>
          ))}
          {list.data?.entries.length === 0 && (
            <tr><td colSpan={7} className="py-6 text-center text-slate-500">No entries in range.</td></tr>
          )}
        </tbody>
      </table>

      {msg && <p className="text-sm text-slate-300">{msg}</p>}
      {editing && (
        <EditDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onDone={(m) => {
            setMsg(m);
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["my-hours"] });
          }}
        />
      )}
      <Link href="/clock" className="text-sm text-slate-500 underline">← back to clock</Link>
    </Shell>
  );
}

function EditDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: EntryRow;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const toLocal = (iso: string | null) =>
    iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const [cin, setCin] = useState(toLocal(entry.clockIn));
  const [cout, setCout] = useState(toLocal(entry.clockOut));
  const [reason, setReason] = useState("");
  const [asCorrection, setAsCorrection] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const clockIn = cin ? new Date(cin).toISOString() : undefined;
      const clockOut = cout ? new Date(cout).toISOString() : undefined;
      if (asCorrection) {
        await apiPost("/corrections", {
          timeEntryId: entry.id,
          requested: { clockIn, clockOut },
          reason,
        });
        return "Correction requested — awaiting approval.";
      }
      await apiPatch(`/entries/${entry.id}`, { clockIn, clockOut, reason });
      return "Times updated (flagged as edited).";
    },
    onSuccess: onDone,
    onError: (e) =>
      setErr(
        e instanceof ApiError
          ? ((e.body as { error?: string })?.error ?? `error ${e.status}`)
          : "failed",
      ),
  });

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-slate-700 bg-slate-900 p-5">
        <h2 className="font-semibold">Fix times · {fmtD(entry.clockIn)}</h2>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Clock in
          <input type="datetime-local" value={cin} onChange={(e) => setCin(e.target.value)}
            className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Clock out
          <input type="datetime-local" value={cout} onChange={(e) => setCout(e.target.value)}
            className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Reason (required)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. forgot to clock out"
            className="rounded bg-slate-800 px-3 py-2 text-sm text-slate-100" />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={asCorrection} onChange={(e) => setAsCorrection(e.target.checked)} />
          Send as correction request (manager approves) instead of direct edit
        </label>
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">Cancel</button>
          <button
            onClick={() => submit.mutate()}
            disabled={reason.trim().length < 3 || submit.isPending}
            className="rounded bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <h1 className="text-xl font-semibold">My hours</h1>
        {children}
      </div>
    </main>
  );
}
