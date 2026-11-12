"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, CircleHelp, Download, RefreshCw, Save, TriangleAlert, Undo2, X } from "lucide-react";
import { apiGet, apiPatch, api, ApiError } from "@/lib/api-client";
import { apiErrorText } from "@/lib/api-errors";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyCountryPreset,
  COUNTRIES,
  type CountryCode,
} from "@/server/domain/locale/countries";
import { settingsSchema, zodIssues, type Settings } from "@/server/domain/settings-schema";
import {
  deepMerge,
  diffDoc,
  fromUnits,
  issuesAt,
  issuesFromBody,
  setPath,
  toUnits,
  type Issue,
} from "@/lib/settings-form";
import { ThemeControls } from "@/components/theme/theme-controls";
import { useT } from "@/lib/i18n";

/** What every section gets: the draft, a setter by dotted path, and server issues. */
interface SectionProps {
  doc: Settings;
  set: (path: string, value: unknown) => void;
  issues: Issue[];
}

/**
 * One save model: every section edits a single draft of the settings document;
 * a sticky bar saves only what changed (one audited PATCH) or discards it.
 * Zod on the server still has the last word — its issue paths are shown on the
 * matching field. Theme is per-device and applies immediately.
 */
export default function SettingsPage() {
  const qc = useQueryClient();
  const { session, isLoading } = useSession();
  const isAdmin = session?.employee.role === "admin";
  const [doc, setDoc] = useState<{ base: Settings; draft: Settings } | null>(null);
  // Raw Advanced (JSON) text while it is being typed; null = derived from the draft.
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);

  const current = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ settings: Settings }>("/admin/settings"),
    enabled: !!isAdmin,
  });

  // Server copy changed (first load, save, key rotation): keep unsaved edits on top of it.
  useEffect(() => {
    const fresh = current.data?.settings;
    if (!fresh) return;
    setDoc((d) => ({
      base: fresh,
      draft: d ? (deepMerge(fresh, diffDoc(d.base, d.draft)) as Settings) : fresh,
    }));
  }, [current.data]);

  const set = (path: string, value: unknown) => {
    setDoc((d) => (d ? { ...d, draft: setPath(d.draft, path, value) } : d));
    setJsonText(null);
  };
  const merge = (patch: unknown) => {
    setDoc((d) => (d ? { ...d, draft: deepMerge(d.draft, patch) as Settings } : d));
    setJsonText(null);
  };
  const discard = () => {
    setDoc((d) => (d ? { ...d, draft: d.base } : d));
    setJsonText(null);
    setIssues([]);
  };

  const patch = doc ? diffDoc(doc.base, doc.draft) : undefined;

  const save = useMutation({
    mutationFn: () => apiPatch<{ settings: Settings }>("/admin/settings", patch ?? {}),
    onSuccess: (res) => {
      setDoc({ base: res.settings, draft: res.settings });
      setJsonText(null);
      setIssues([]);
      toast.success("Settings saved (audited).");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["locale"] });
    },
    onError: (e) => {
      const found = e instanceof ApiError ? issuesFromBody(e.body) : [];
      setIssues(found);
      toast.error(found.length ? "Not saved — fix the highlighted settings." : apiErrorText(e));
    },
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

  // Typed JSON is checked against the same schema the server uses before it
  // reaches the draft, so the forms above never see a malformed document.
  let parseError: string | null = null;
  let jsonIssues: Issue[] = [];
  if (jsonText != null && doc) {
    const r = readJson(jsonText, doc.base);
    if (typeof r === "string") parseError = r;
    else if (Array.isArray(r)) jsonIssues = r;
  }
  if (jsonIssues.length) parseError = "fix the problems below";
  const dirty = patch !== undefined || parseError != null;
  const props = doc ? { doc: doc.draft, set, issues } : null;

  return (
    <Container>
      <ThemeSection />

      {!props ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <>
          <LocaleSection {...props} merge={merge} />
          <PayRulesSection {...props} />
          <IntegrationSection />
          <PresenceSection {...props} />

          <details className="group rounded-xl border border-border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              Advanced (JSON)
              <span className="text-xs font-normal text-muted-foreground">
                notifications, door access, anti-fraud, kiosk, everything else
              </span>
              <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-3 border-t border-border p-4">
              <p className="text-xs text-muted-foreground">
                The whole settings document, including the fields above. Edits here join the same
                unsaved changes; the server validates and audits every save.
              </p>
              <textarea
                value={jsonText ?? JSON.stringify(props.doc, null, 2)}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  const r = readJson(e.target.value, doc!.base);
                  // Only a valid document replaces the draft; otherwise Save stays disabled.
                  if (typeof r === "object" && !Array.isArray(r))
                    setDoc((d) => (d ? { ...d, draft: r.settings } : d));
                }}
                spellCheck={false}
                rows={28}
                className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              {parseError && <p className="text-xs text-destructive">JSON: {parseError}</p>}
              {jsonIssues.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs text-destructive">
                  {jsonIssues.map((i) => (
                    <li key={i.path + i.message}>
                      <span className="font-mono">{i.path}</span>: {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </>
      )}

      {dirty && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 flex flex-col gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Unsaved changes</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={discard} disabled={save.isPending}>
                <Undo2 /> Discard
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={parseError != null || patch === undefined || save.isPending}
              >
                <Save /> Save
              </Button>
            </div>
          </div>
          {issues.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-destructive">
              {issues.map((i) => (
                <li key={i.path + i.message}>
                  <span className="font-mono">{i.path || "(document)"}</span>: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Container>
  );
}

/**
 * Parse the Advanced JSON text: an error string, the schema's issues, or the
 * full document (merged over the saved one, like the server's PATCH).
 */
function readJson(text: string, base: Settings): string | Issue[] | { settings: Settings } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    return e instanceof Error ? e.message : "invalid JSON";
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return "must be a JSON object";
  const r = settingsSchema.safeParse(deepMerge(base, v));
  return r.success ? { settings: r.data } : zodIssues(r.error);
}

/**
 * Appearance: native-HA dark/light/system + accent picker. Per-device
 * (localStorage), so it is not part of the server settings document.
 */
function ThemeSection() {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("theme.title")}</CardTitle>
        <CardDescription>{t("theme.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ThemeControls />
      </CardContent>
    </Card>
  );
}

type Language = Settings["locale"]["language"];

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "German (Deutsch)" },
  { value: "fr", label: "French (Français)" },
  { value: "sv", label: "Swedish (Svenska)" },
  { value: "da", label: "Danish (Dansk)" },
];

/**
 * Region and language presets. Choosing a country applies documented DEFAULTS
 * (locale formatting, week start, currency, timezone, and a starting overtime
 * rule) via applyCountryPreset — which is a pure function, safe to import in a
 * client component. NZ keeps its tuned computed holiday engine + Holidays Act
 * stat-pay; all other countries route holidays through date-holidays and use
 * the worked-public-holiday premium below. Every derived field stays editable.
 */
function LocaleSection({ doc, set, issues, merge }: SectionProps & { merge: (patch: unknown) => void }) {
  const l = doc.locale;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Region and language</CardTitle>
        <CardDescription>
          Pick a country to load documented defaults for date/number formatting, week start,
          currency, timezone, public holidays, and a starting overtime rule. Every field below
          stays editable.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field
          id="locale-country"
          label="Country"
          issues={issuesAt(issues, "locale.country")}
          hint="Choosing a country fills in its locale and overtime defaults (review them below before saving). NZ keeps its built-in holiday engine and statutory holiday pay; other countries use date-holidays."
        >
          <Select
            value={l.country}
            onValueChange={(v) => {
              merge(applyCountryPreset(v as CountryCode));
              toast.info(`${COUNTRIES[v as CountryCode].name} defaults filled in — Save to apply.`);
            }}
          >
            <SelectTrigger id="locale-country">
              <SelectValue placeholder="Select a country" />
            </SelectTrigger>
            <SelectContent>
              {Object.values(COUNTRIES).map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Field
            id="locale-language"
            label="Language"
            issues={issuesAt(issues, "locale.language")}
            hint="Interface language. Some admin pages are still English only."
          >
            <Select value={l.language} onValueChange={(v) => set("locale.language", v as Language)}>
              <SelectTrigger id="locale-language">
                <SelectValue placeholder="Select a language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((x) => (
                  <SelectItem key={x.value} value={x.value}>
                    {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="locale-weekstart"
            label="Week starts on"
            issues={issuesAt(issues, "locale.weekStart")}
            hint="Used for calendar display. Note: weekly overtime is currently always calculated on a Monday–Sunday week regardless of this setting."
          >
            <Select
              value={l.weekStart.toString()}
              onValueChange={(v) => set("locale.weekStart", Number(v) === 0 ? 0 : 1)}
            >
              <SelectTrigger id="locale-weekstart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Monday</SelectItem>
                <SelectItem value="0">Sunday</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="locale-currency"
            label="Currency"
            issues={issuesAt(issues, "locale.currency")}
            hint="ISO 4217 code, display only. This is not tax or payroll software."
          >
            <Input
              id="locale-currency"
              value={l.currency}
              placeholder="e.g. NZD"
              onChange={(e) => set("locale.currency", e.target.value)}
            />
          </Field>

          <Field
            id="locale-bcp47"
            label="Formatting locale"
            issues={issuesAt(issues, "locale.bcp47")}
            hint="BCP-47 tag for date and number formatting (e.g. en-GB, de-DE, fr-FR)."
          >
            <Input
              id="locale-bcp47"
              value={l.bcp47}
              placeholder="e.g. en-NZ"
              onChange={(e) => set("locale.bcp47", e.target.value)}
            />
          </Field>

          <Field
            id="locale-region"
            label="Holiday region"
            issues={issuesAt(issues, "locale.holidayRegion")}
            hint="Optional state / province / canton for public holidays — e.g. US state (CA), CA province (ON), CH canton (ZH), DE Bundesland (BY). Leave blank for country-level holidays only."
          >
            <Input
              id="locale-region"
              value={l.holidayRegion}
              placeholder="optional"
              onChange={(e) => set("locale.holidayRegion", e.target.value)}
            />
          </Field>

          <Field
            id="locale-holidaypay"
            label="Worked-public-holiday premium"
            issues={issuesAt(issues, "locale.holidayPayMultiplier")}
            hint="NZ uses its own statutory holiday pay; this applies to other countries. 1 = no premium."
          >
            <NumField
              id="locale-holidaypay"
              value={l.holidayPayMultiplier}
              onChange={(v) => set("locale.holidayPayMultiplier", v)}
              suffix="×"
            />
          </Field>
        </div>

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          Overtime and holiday defaults are starting points — verify them against your local
          law, awards, or collective agreements before relying on them. This add-on does not
          calculate income tax or withholding; that is your payroll system&apos;s job.
        </p>
      </CardContent>
    </Card>
  );
}

/** The rules people actually change: pay period, overtime, rounding, breaks, auto clock-out. */
function PayRulesSection({ doc, set, issues }: SectionProps) {
  const at = (p: string) => issuesAt(issues, p);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay rules</CardTitle>
        <CardDescription>
          How hours are cut into pay periods, when overtime starts, rounding, automatic
          breaks and forgotten clock-outs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Group title="Pay period">
          <Field id="pp-type" label="Length" issues={at("payPeriod.type")}>
            <Select value={doc.payPeriod.type} onValueChange={(v) => set("payPeriod.type", v)}>
              <SelectTrigger id="pp-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="fortnightly">Fortnightly</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            id="pp-anchor"
            label="Starts on (anchor)"
            issues={at("payPeriod.anchor")}
            hint="Any first day of a pay period, usually a Monday; periods repeat forwards and backwards from it."
          >
            <Input
              id="pp-anchor"
              type="date"
              value={doc.payPeriod.anchor}
              onChange={(e) => set("payPeriod.anchor", e.target.value)}
            />
          </Field>
        </Group>

        <Group title="Overtime">
          <Field id="ot-daily" label="Daily overtime after" issues={at("overtime.dailyThresholdMin")}>
            <NumField
              id="ot-daily"
              value={doc.overtime.dailyThresholdMin}
              scale={60}
              suffix="h"
              onChange={(v) => set("overtime.dailyThresholdMin", v)}
            />
          </Field>
          <Field id="ot-weekly" label="Weekly overtime after" issues={at("overtime.weeklyThresholdMin")}>
            <NumField
              id="ot-weekly"
              value={doc.overtime.weeklyThresholdMin}
              scale={60}
              suffix="h"
              onChange={(v) => set("overtime.weeklyThresholdMin", v)}
            />
          </Field>
          <Field id="ot-m1" label="Overtime rate" issues={at("overtime.multiplier1")}>
            <NumField
              id="ot-m1"
              value={doc.overtime.multiplier1}
              suffix="×"
              onChange={(v) => set("overtime.multiplier1", v)}
            />
          </Field>
          <div className="hidden sm:block" />
          <Field
            id="ot-daily2"
            label="Second tier after (daily)"
            issues={at("overtime.daily2ThresholdMin")}
            hint="Optional, e.g. 12h at 2×. Blank = no second tier."
          >
            <NumField
              id="ot-daily2"
              value={doc.overtime.daily2ThresholdMin}
              scale={60}
              suffix="h"
              nullable
              onChange={(v) => set("overtime.daily2ThresholdMin", v)}
            />
          </Field>
          <Field id="ot-m2" label="Second tier rate" issues={at("overtime.multiplier2")}>
            <NumField
              id="ot-m2"
              value={doc.overtime.multiplier2}
              suffix="×"
              onChange={(v) => set("overtime.multiplier2", v)}
            />
          </Field>
        </Group>

        <Group title="Rounding">
          <Field id="rnd-inc" label="Round punches to" issues={at("rounding.incrementMin")}>
            <Select
              value={String(doc.rounding.incrementMin)}
              onValueChange={(v) => set("rounding.incrementMin", Number(v))}
            >
              <SelectTrigger id="rnd-inc">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 minute (no rounding)</SelectItem>
                <SelectItem value="5">5 minutes</SelectItem>
                <SelectItem value="10">10 minutes</SelectItem>
                <SelectItem value="15">15 minutes</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="rnd-mode" label="Direction" issues={at("rounding.mode")}>
            <Select value={doc.rounding.mode} onValueChange={(v) => set("rounding.mode", v)}>
              <SelectTrigger id="rnd-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nearest">Nearest</SelectItem>
                <SelectItem value="up">Up</SelectItem>
                <SelectItem value="down">Down</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Group>

        <Group title="Automatic break">
          <Field
            id="brk-after"
            label="For shifts longer than"
            issues={at("breaks.autoDeductAfterMin")}
            hint="When nobody took a break, this much is deducted."
          >
            <NumField
              id="brk-after"
              value={doc.breaks.autoDeductAfterMin}
              scale={60}
              suffix="h"
              onChange={(v) => set("breaks.autoDeductAfterMin", v)}
            />
          </Field>
          <Field id="brk-min" label="Deduct" issues={at("breaks.autoDeductMin")}>
            <NumField
              id="brk-min"
              value={doc.breaks.autoDeductMin}
              suffix="min"
              onChange={(v) => set("breaks.autoDeductMin", v)}
            />
          </Field>
        </Group>

        <Group title="Forgotten clock-out">
          <div className="sm:col-span-2">
            <ToggleRow
              id="aco-enabled"
              label="Clock people out automatically after a very long shift"
              checked={doc.autoClockout.enabled}
              onCheckedChange={(v) => set("autoClockout.enabled", v)}
            />
          </div>
          <Field id="aco-max" label="Longest shift" issues={at("autoClockout.maxShiftHours")}>
            <NumField
              id="aco-max"
              value={doc.autoClockout.maxShiftHours}
              suffix="h"
              disabled={!doc.autoClockout.enabled}
              onChange={(v) => set("autoClockout.maxShiftHours", v)}
            />
          </Field>
        </Group>
      </CardContent>
    </Card>
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
 * config; the YAML preview covers manual installs. These are actions, not
 * settings, so they run straight away.
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
    mutationFn: () => api<{ apiKey: string; haReloaded: boolean | null }>("/admin/integration/key", { method: "POST" }),
    onSuccess: (res) => {
      if (res.haReloaded === false) {
        toast.warning("New API key generated, but Home Assistant didn't reload it — restart HA once so clock buttons keep working.");
      } else {
        toast.success("New API key generated; installed package updated.");
      }
      qc.invalidateQueries({ queryKey: ["integration"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) => toast.error(apiErrorText(e)),
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

/**
 * Friendly editor for the settings.presence block. Grace windows are shown in
 * minutes (stored as seconds) since sub-minute anti-flap tuning isn't useful
 * here; the raw poll interval lives under an Advanced disclosure. Per-person
 * notify service + presence entity are edited on the Employees page.
 */
function PresenceSection({ doc, set, issues }: SectionProps) {
  const p = doc.presence;
  const at = (k: string) => issuesAt(issues, `presence.${k}`);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Presence reminders</CardTitle>
        <CardDescription>
          Nudge staff to clock in when their phone joins the work network and to clock out when
          it leaves. Notify-only — this never punches automatically. Each person&apos;s notify
          service and presence entity are set on the{" "}
          <span className="font-medium text-foreground">Employees</span> page.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ToggleRow
          id="presence-enabled"
          label="Notify staff to clock in/out based on presence"
          checked={p.enabled}
          onCheckedChange={(v) => set("presence.enabled", v)}
        />

        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <ToggleRow
            id="presence-arrive"
            label="Remind to clock in on arrival"
            checked={p.notifyOnArrive}
            onCheckedChange={(v) => set("presence.notifyOnArrive", v)}
          />
          <ToggleRow
            id="presence-depart"
            label="Remind to clock out on departure"
            checked={p.notifyOnDepart}
            onCheckedChange={(v) => set("presence.notifyOnDepart", v)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Field
            id="presence-arrive-grace"
            label="Arrival grace"
            issues={at("arriveGraceSec")}
            hint="How long they must stay on-network before we send a clock-in reminder."
          >
            <NumField
              id="presence-arrive-grace"
              value={p.arriveGraceSec}
              scale={60}
              suffix="min"
              onChange={(v) => set("presence.arriveGraceSec", v)}
            />
          </Field>
          <Field
            id="presence-depart-grace"
            label="Departure grace"
            issues={at("departGraceSec")}
            hint="How long they must be gone before we send a clock-out reminder."
          >
            <NumField
              id="presence-depart-grace"
              value={p.departGraceSec}
              scale={60}
              suffix="min"
              onChange={(v) => set("presence.departGraceSec", v)}
            />
          </Field>
        </div>

        <div className="border-t border-border pt-4">
          <Field
            id="presence-ssid"
            label="Wi-Fi SSID"
            issues={at("ssid")}
            hint="Only needed if you picked a Wi-Fi SSID sensor as someone's presence entity."
          >
            <Input
              id="presence-ssid"
              value={p.ssid}
              placeholder="e.g. WorkWiFi"
              onChange={(e) => set("presence.ssid", e.target.value)}
            />
          </Field>
        </div>

        <details className="border-t border-border pt-4 text-sm" open={at("pollSec").length > 0}>
          <summary className="cursor-pointer py-1 font-medium text-muted-foreground">
            Advanced
          </summary>
          <div className="mt-3 sm:max-w-48">
            <Field
              id="presence-poll"
              label="Poll interval"
              issues={at("pollSec")}
              hint="How often we check Home Assistant for presence (15–600s). Takes effect after the add-on restarts."
            >
              <NumField
                id="presence-poll"
                value={p.pollSec}
                suffix="s"
                onChange={(v) => set("presence.pollSec", v)}
              />
            </Field>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="text-sm font-medium">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Label + control + hint, with the server's validation message underneath. */
function Field({
  id,
  label,
  hint,
  issues,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  issues: Issue[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className={cn(issues.length > 0 && "rounded-md ring-2 ring-destructive/60")}>{children}</div>
      {issues.map((i) => (
        <p key={i.path + i.message} className="text-xs text-destructive">
          {i.message}
        </p>
      ))}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Number input in display units (scale 60 = stored minutes shown as hours).
 * Keeps its own text so "7." can be typed; blank → null when `nullable`,
 * otherwise blank / junk becomes NaN and the server names the field on Save.
 */
function NumField({
  id,
  value,
  onChange,
  scale = 1,
  suffix,
  nullable,
  disabled,
}: {
  id: string;
  value: number | null;
  onChange: (v: number | null) => void;
  scale?: number;
  suffix?: string;
  nullable?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(toUnits(value, scale));
  useEffect(() => {
    // Re-sync when the value changes from outside (preset, discard, JSON edit).
    setText((t) => {
      const parsed = fromUnits(t, scale);
      const same = parsed === value || (Number.isNaN(parsed) && Number.isNaN(value));
      return same ? t : toUnits(value, scale);
    });
  }, [value, scale]);

  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const v = fromUnits(e.target.value, scale);
          onChange(v === null && !nullable ? Number.NaN : v);
        }}
        className={cn(suffix && "pr-12")}
        autoComplete="off"
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="cursor-pointer font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
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
