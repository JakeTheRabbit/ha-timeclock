"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CircleHelp, Download, RefreshCw, Save, TriangleAlert, X } from "lucide-react";
import { apiGet, api, ApiError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Pragmatic v1 config surface: the validated settings document as editable
 * JSON. Zod on the server rejects anything malformed; the audit log records
 * every change (old -> new).
 */
export default function SettingsPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const [text, setText] = useState("");
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
    mutationFn: () => api("/admin/settings", { method: "PATCH", body: text }),
    onSuccess: () => {
      toast.success("Settings saved (audited).");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? `Rejected (${e.status}): invalid settings document.`
          : "Save failed.",
      ),
  });

  if (isLoading)
    return (
      <Container>
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-80 w-full" />
      </Container>
    );

  if (!isAdmin)
    return (
      <Container>
        <Card>
          <CardContent>
            <p className="text-sm text-destructive">Admin role required.</p>
          </CardContent>
        </Card>
      </Container>
    );

  let parseError: string | null = null;
  try {
    JSON.parse(text || "{}");
  } catch (e) {
    parseError = e instanceof Error ? e.message : "invalid JSON";
  }

  return (
    <Container>
      <IntegrationSection />

      <Card>
        <CardHeader>
          <CardTitle>Advanced</CardTitle>
          <CardDescription>
            Raw settings document: overtime thresholds/multipliers, rounding, break
            auto-deduct, pay-period anchor, auto-clockout, notifications (HA + SMTP),
            anti-fraud (geofence / IP allowlist / photo-on-punch). Server validates;
            every save is audited.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={28}
            className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {parseError && <p className="text-xs text-destructive">JSON: {parseError}</p>}
          <div>
            <Button onClick={() => save.mutate()} disabled={!!parseError || save.isPending}>
              <Save /> Save settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </Container>
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
  const info = useQuery({
    queryKey: ["integration"],
    queryFn: () => apiGet<IntegrationInfo>("/admin/integration"),
  });

  const install = useMutation({
    mutationFn: () => api("/admin/integration/install", { method: "POST" }),
    onSuccess: () => {
      toast.success("Installed. If this is the first install, restart Home Assistant once.");
      qc.invalidateQueries({ queryKey: ["integration"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? `Install failed (${e.status}) — is the add-on updated with config access?`
          : "Install failed — is the add-on updated with config access?",
      ),
  });

  const rotate = useMutation({
    mutationFn: () => api("/admin/integration/key", { method: "POST" }),
    onSuccess: () => {
      toast.success("New API key generated; installed package updated.");
      qc.invalidateQueries({ queryKey: ["integration"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? `Error ${e.status}: ${JSON.stringify(e.body)}`
          : "Request failed",
      ),
  });

  const s = info.data?.status;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home Assistant integration</CardTitle>
        <CardDescription>
          Installs the <span className="font-mono">timeclock-card</span> dashboard card and
          per-employee clock in/out scripts (used by Android companion-app widgets).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {info.isLoading && <Skeleton className="h-6 w-full" />}
        {s && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge ok={s.haConfigMounted} label="Config access" />
            <StatusBadge ok={s.packageInstalled} label="Package" />
            <StatusBadge ok={s.cardInstalled} label="Card" />
            <StatusBadge ok={s.packagesIncludeConfigured} label="Packages include" />
          </div>
        )}
        {s?.packagesIncludeConfigured === false && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              Add this line under <span className="font-mono">homeassistant:</span> in
              configuration.yaml, then restart HA once:{" "}
              <span className="font-mono">packages: !include_dir_named packages</span>
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => install.mutate()} disabled={install.isPending}>
            <Download />
            {s?.packageInstalled ? "Reinstall / refresh" : "Install into Home Assistant"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending}
          >
            <RefreshCw />
            {info.data?.apiKey ? "Rotate API key" : "Generate API key"}
          </Button>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer py-2 font-medium">
            Setup checklist &amp; manual YAML
          </summary>
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
            <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono">
              {info.data.packageYaml}
            </pre>
          )}
        </details>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  const Icon = ok ? Check : ok === false ? X : CircleHelp;
  return (
    <Badge variant={ok ? "secondary" : ok === false ? "destructive" : "outline"}>
      <Icon />
      {label}
    </Badge>
  );
}

function Container({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">{children}</div>;
}
