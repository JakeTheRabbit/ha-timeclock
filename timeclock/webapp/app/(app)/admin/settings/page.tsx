"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CircleHelp, Download, RefreshCw, Save, TriangleAlert, X } from "lucide-react";
import { apiGet, apiPatch, api, ApiError } from "@/lib/api-client";
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
import { ThemeControls } from "@/components/theme/theme-controls";
import { useT } from "@/lib/i18n";

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
      <ThemeSection />

      <LocaleSection />

      <IntegrationSection />

      <PresenceSection />

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

interface LocaleConfig {
  country: CountryCode;
  language: "en" | "de" | "fr" | "sv" | "da";
  bcp47: string;
  currency: string;
  weekStart: 0 | 1;
  holidayRegion: string;
  holidayPayMultiplier: number;
}

const LOCALE_DEFAULTS: LocaleConfig = {
  country: "NZ",
  language: "en",
  bcp47: "en-NZ",
  currency: "NZD",
  weekStart: 1,
  holidayRegion: "",
  holidayPayMultiplier: 1,
};

const LANGUAGES: { value: LocaleConfig["language"]; label: string }[] = [
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
function LocaleSection() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ settings: { locale?: Partial<LocaleConfig> } }>("/admin/settings"),
  });

  const [form, setForm] = useState<LocaleConfig>(LOCALE_DEFAULTS);

  useEffect(() => {
    const l = settings.data?.settings.locale;
    if (l) setForm({ ...LOCALE_DEFAULTS, ...l });
  }, [settings.data]);

  // Applying a country preset patches locale.* AND overtime defaults.
  const applyPreset = useMutation({
    mutationFn: (country: CountryCode) =>
      apiPatch("/admin/settings", applyCountryPreset(country)),
    onSuccess: (_res, country) => {
      toast.success(`Applied ${COUNTRIES[country].name} defaults.`);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? `Rejected (${e.status}): could not apply country defaults.`
          : "Could not apply country defaults.",
      ),
  });

  // Editing an individual derived field only patches locale.* (never overtime).
  const saveLocale = useMutation({
    mutationFn: (patch: Partial<LocaleConfig>) =>
      apiPatch("/admin/settings", { locale: patch }),
    onSuccess: () => {
      toast.success("Region settings saved (audited).");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? `Rejected (${e.status}): invalid region settings.`
          : "Save failed.",
      ),
  });

  // Update local form immediately, persist the single changed field.
  const setField = <K extends keyof LocaleConfig>(key: K, value: LocaleConfig[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    saveLocale.mutate({ [key]: value } as Partial<LocaleConfig>);
  };

  const busy = applyPreset.isPending || saveLocale.isPending;

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
        {settings.isLoading && <Skeleton className="h-64 w-full" />}
        {!settings.isLoading && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="locale-country">Country</Label>
              <Select
                value={form.country}
                onValueChange={(v) => applyPreset.mutate(v as CountryCode)}
                disabled={busy}
              >
                <SelectTrigger id="locale-country">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.values(COUNTRIES)).map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Choosing a country applies its locale and overtime defaults. NZ keeps its built-in
                holiday engine and statutory holiday pay; other countries use date-holidays.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locale-language">Language</Label>
                <Select
                  value={form.language}
                  onValueChange={(v) => setField("language", v as LocaleConfig["language"])}
                  disabled={busy}
                >
                  <SelectTrigger id="locale-language">
                    <SelectValue placeholder="Select a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  UI translations, see docs. The interface is not translated yet.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locale-weekstart">Week starts on</Label>
                <Select
                  value={form.weekStart.toString()}
                  onValueChange={(v) => setField("weekStart", (Number(v) === 0 ? 0 : 1))}
                  disabled={busy}
                >
                  <SelectTrigger id="locale-weekstart">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Monday</SelectItem>
                    <SelectItem value="0">Sunday</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used for calendar display. Note: weekly overtime is currently
                  always calculated on a Monday–Sunday week regardless of this
                  setting.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locale-currency">Currency</Label>
                <Input
                  id="locale-currency"
                  value={form.currency}
                  placeholder="e.g. NZD"
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  onBlur={(e) => saveLocale.mutate({ currency: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  ISO 4217 code, display only. This is not tax or payroll software.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locale-bcp47">Formatting locale</Label>
                <Input
                  id="locale-bcp47"
                  value={form.bcp47}
                  placeholder="e.g. en-NZ"
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, bcp47: e.target.value }))}
                  onBlur={(e) => saveLocale.mutate({ bcp47: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  BCP-47 tag for date and number formatting (e.g. en-GB, de-DE, fr-FR).
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locale-region">Holiday region</Label>
                <Input
                  id="locale-region"
                  value={form.holidayRegion}
                  placeholder="optional"
                  disabled={busy}
                  onChange={(e) => setForm((f) => ({ ...f, holidayRegion: e.target.value }))}
                  onBlur={(e) => saveLocale.mutate({ holidayRegion: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Optional state / province / canton for public holidays — e.g. US state (CA),
                  CA province (ON), CH canton (ZH), DE Bundesland (BY). Leave blank for
                  country-level holidays only.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="locale-holidaypay">Worked-public-holiday premium</Label>
                <Input
                  id="locale-holidaypay"
                  type="number"
                  min={1}
                  step="0.1"
                  inputMode="decimal"
                  value={form.holidayPayMultiplier.toString()}
                  disabled={busy}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      holidayPayMultiplier: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  onBlur={(e) =>
                    saveLocale.mutate({
                      holidayPayMultiplier: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  NZ uses its own statutory holiday pay; this applies to other countries. 1 = no
                  premium.
                </p>
              </div>
            </div>

            <p className="border-t border-border pt-4 text-xs text-muted-foreground">
              Overtime and holiday defaults are starting points — verify them against your local
              law, awards, or collective agreements before relying on them. This add-on does not
              calculate income tax or withholding; that is your payroll system&apos;s job.
            </p>
          </>
        )}
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
    mutationFn: () => api<{ apiKey: string; haReloaded: boolean | null }>("/admin/integration/key", { method: "POST" }),
    onSuccess: (res) => {
      if (res.haReloaded === false) {
        toast.warning("New API key generated, but Home Assistant didn't reload it — restart HA once so clock buttons keep working.");
      } else {
        toast.success("New API key generated; installed package updated.");
      }
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

interface PresenceConfig {
  enabled: boolean;
  pollSec: number;
  arriveGraceSec: number;
  departGraceSec: number;
  ssid: string;
  notifyOnArrive: boolean;
  notifyOnDepart: boolean;
}

const PRESENCE_DEFAULTS: PresenceConfig = {
  enabled: false,
  pollSec: 60,
  arriveGraceSec: 120,
  departGraceSec: 300,
  ssid: "",
  notifyOnArrive: true,
  notifyOnDepart: true,
};

/**
 * Friendly editor for the settings.presence block. Grace windows are shown in
 * minutes (stored as seconds) since sub-minute anti-flap tuning isn't useful
 * here; the raw poll interval lives under an Advanced disclosure. Per-person
 * notify service + presence entity are edited on the Employees page.
 */
function PresenceSection() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<{ settings: { presence?: Partial<PresenceConfig> } }>("/admin/settings"),
  });

  const [form, setForm] = useState<PresenceConfig>(PRESENCE_DEFAULTS);

  useEffect(() => {
    const p = settings.data?.settings.presence;
    if (p) setForm({ ...PRESENCE_DEFAULTS, ...p });
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (presence: PresenceConfig) =>
      apiPatch("/admin/settings", { presence }),
    onSuccess: () => {
      toast.success("Presence reminders saved (audited).");
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? `Rejected (${e.status}): invalid presence settings.`
          : "Save failed.",
      ),
  });

  const set = <K extends keyof PresenceConfig>(key: K, value: PresenceConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Grace windows edited in minutes; stored as seconds.
  const minutesField = (secs: number) => (secs / 60).toString();
  const parseMinutes = (v: string) => Math.max(0, Math.round((Number(v) || 0) * 60));

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
        {settings.isLoading && <Skeleton className="h-40 w-full" />}
        {!settings.isLoading && (
          <>
            <ToggleRow
              id="presence-enabled"
              label="Notify staff to clock in/out based on presence"
              checked={form.enabled}
              onCheckedChange={(v) => set("enabled", v)}
            />

            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <ToggleRow
                id="presence-arrive"
                label="Remind to clock in on arrival"
                checked={form.notifyOnArrive}
                onCheckedChange={(v) => set("notifyOnArrive", v)}
              />
              <ToggleRow
                id="presence-depart"
                label="Remind to clock out on departure"
                checked={form.notifyOnDepart}
                onCheckedChange={(v) => set("notifyOnDepart", v)}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="presence-arrive-grace">Arrival grace (minutes)</Label>
                <Input
                  id="presence-arrive-grace"
                  type="number"
                  min={0}
                  step="0.5"
                  inputMode="decimal"
                  value={minutesField(form.arriveGraceSec)}
                  onChange={(e) => set("arriveGraceSec", parseMinutes(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  How long they must stay on-network before we send a clock-in reminder.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="presence-depart-grace">Departure grace (minutes)</Label>
                <Input
                  id="presence-depart-grace"
                  type="number"
                  min={0}
                  step="0.5"
                  inputMode="decimal"
                  value={minutesField(form.departGraceSec)}
                  onChange={(e) => set("departGraceSec", parseMinutes(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  How long they must be gone before we send a clock-out reminder.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border pt-4">
              <Label htmlFor="presence-ssid">Wi-Fi SSID</Label>
              <Input
                id="presence-ssid"
                value={form.ssid}
                placeholder="e.g. WorkWiFi"
                onChange={(e) => set("ssid", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Only needed if you picked a Wi-Fi SSID sensor as someone&apos;s presence entity.
              </p>
            </div>

            <details className="border-t border-border pt-4 text-sm">
              <summary className="cursor-pointer py-1 font-medium text-muted-foreground">
                Advanced
              </summary>
              <div className="mt-3 flex flex-col gap-1.5">
                <Label htmlFor="presence-poll">Poll interval (seconds)</Label>
                <Input
                  id="presence-poll"
                  type="number"
                  min={15}
                  max={600}
                  inputMode="numeric"
                  value={form.pollSec.toString()}
                  onChange={(e) =>
                    set("pollSec", Math.min(600, Math.max(15, Number(e.target.value) || 0)))
                  }
                  className="sm:max-w-40"
                />
                <p className="text-xs text-muted-foreground">
                  How often we check Home Assistant for presence (15–600s). Takes effect after
                  the add-on restarts.
                </p>
              </div>
            </details>

            <div>
              <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
                <Save /> Save presence settings
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
