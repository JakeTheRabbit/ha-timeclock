"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, api, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";

/**
 * Pragmatic v1 config surface: the validated settings document as editable
 * JSON. Zod on the server rejects anything malformed; the audit log records
 * every change (old -> new).
 */
export default function SettingsPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const isAdmin = session?.employee.role === "admin";

  const current = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ settings: unknown }>("/admin/settings"),
    enabled: !!isAdmin,
  });

  useEffect(() => {
    if (current.data) setText(JSON.stringify(current.data.settings, null, 2));
  }, [current.data]);

  const save = useMutation({
    mutationFn: () =>
      api("/admin/settings", { method: "PATCH", body: text }),
    onSuccess: () => {
      setMsg("Saved (audited).");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      setMsg(e instanceof ApiError ? "Rejected: invalid settings document." : "Save failed."),
  });

  if (isLoading) return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (!isAdmin) return <Shell><p className="text-rose-400">Admin role required.</p></Shell>;

  let parseError: string | null = null;
  try {
    JSON.parse(text || "{}");
  } catch (e) {
    parseError = e instanceof Error ? e.message : "invalid JSON";
  }

  return (
    <Shell>
      <p className="text-sm text-slate-400">
        Overtime thresholds/multipliers, rounding, break auto-deduct, pay-period anchor,
        auto-clockout, notifications (HA + SMTP), anti-fraud (geofence / IP allowlist /
        photo-on-punch). Server validates; every save is audited.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={28}
        className="w-full rounded-lg border border-slate-800 bg-slate-900 p-4 font-mono text-xs text-slate-100"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={() => save.mutate()}
          disabled={!!parseError || save.isPending}
          className="rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
        >
          Save settings
        </button>
        {parseError && <span className="text-xs text-rose-400">JSON: {parseError}</span>}
        {msg && <span className="text-sm text-slate-400">{msg}</span>}
      </div>
      <Link href="/manager" className="text-sm text-slate-500 underline">← manager</Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h1 className="text-xl font-semibold">Admin · Settings</h1>
        {children}
      </div>
    </main>
  );
}
