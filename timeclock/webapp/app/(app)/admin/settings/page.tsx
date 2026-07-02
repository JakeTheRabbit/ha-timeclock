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
      <IntegrationSection />
      <Link href="/manager" className="text-sm text-slate-500 underline">← manager</Link>
    </Shell>
  );
}

interface IntegrationInfo {
  apiKey: string;
  status: {
    haConfigMounted: boolean;
    packageInstalled: boolean;
    cardInstalled: boolean;
    packagesIncludeConfigured: boolean | null;
    addonUrl: string;
  };
  packageYaml: string | null;
}

/**
 * Dashboard card + Android companion widgets. One click writes the generated
 * package (rest_command + per-employee toggle scripts) and the card into HA
 * config; the YAML preview covers manual installs.
 */
function IntegrationSection() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const info = useQuery({
    queryKey: ["integration"],
    queryFn: () => apiGet<IntegrationInfo>("/admin/integration"),
  });

  const install = useMutation({
    mutationFn: () => api("/admin/integration/install", { method: "POST" }),
    onSuccess: () => {
      setMsg("Installed. If this is the first install, restart Home Assistant once.");
      qc.invalidateQueries({ queryKey: ["integration"] });
    },
    onError: () => setMsg("Install failed — is the add-on updated with config access?"),
  });
  const rotate = useMutation({
    mutationFn: () => api("/admin/integration/key", { method: "POST" }),
    onSuccess: () => {
      setMsg("New API key generated; installed package updated.");
      qc.invalidateQueries({ queryKey: ["integration"] });
    },
  });

  const s = info.data?.status;
  const Badge = ({ ok, label }: { ok: boolean | null; label: string }) => (
    <span
      className={`rounded px-2 py-0.5 text-xs ${
        ok ? "bg-emerald-900 text-emerald-300" : ok === false ? "bg-rose-950 text-rose-400" : "bg-slate-800 text-slate-400"
      }`}
    >
      {label}: {ok ? "yes" : ok === false ? "no" : "?"}
    </span>
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="font-semibold">Home Assistant integration</h2>
      <p className="text-sm text-slate-400">
        Installs the <span className="font-mono">timeclock-card</span> dashboard card and
        per-employee clock in/out scripts (used by Android companion-app widgets).
      </p>
      {s && (
        <div className="flex flex-wrap gap-2">
          <Badge ok={s.haConfigMounted} label="config access" />
          <Badge ok={s.packageInstalled} label="package" />
          <Badge ok={s.cardInstalled} label="card" />
          <Badge ok={s.packagesIncludeConfigured} label="packages include" />
        </div>
      )}
      {s?.packagesIncludeConfigured === false && (
        <p className="rounded bg-amber-950/60 p-2 text-xs text-amber-300">
          Add this line under <span className="font-mono">homeassistant:</span> in
          configuration.yaml, then restart HA once:{" "}
          <span className="font-mono">packages: !include_dir_named packages</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => install.mutate()}
          disabled={install.isPending}
          className="rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-40"
        >
          {s?.packageInstalled ? "Reinstall / refresh" : "Install into Home Assistant"}
        </button>
        <button
          onClick={() => rotate.mutate()}
          disabled={rotate.isPending}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700 disabled:opacity-40"
        >
          {info.data?.apiKey ? "Rotate API key" : "Generate API key"}
        </button>
        {msg && <span className="text-sm text-slate-400">{msg}</span>}
      </div>
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer">Setup checklist & manual YAML</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Click Install (writes packages/timeclock.yaml + www/timeclock-card.js).</li>
          <li>
            First time only: ensure the packages include line above exists, add the dashboard
            resource <span className="font-mono">/local/timeclock-card.js</span> (JavaScript
            module), and restart HA.
          </li>
          <li>
            Add the card: type <span className="font-mono">custom:timeclock-card</span> in a
            manual card.
          </li>
          <li>
            Android widget: Companion app → Settings → Widgets → add a Template/Actions
            widget that runs <span className="font-mono">script.timeclock_&lt;name&gt;_toggle</span>.
          </li>
        </ol>
        {info.data?.packageYaml && (
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-3 font-mono">
            {info.data.packageYaml}
          </pre>
        )}
      </details>
    </section>
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
