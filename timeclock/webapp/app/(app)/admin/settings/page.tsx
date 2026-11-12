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
  const t = useT();
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
      toast.success(t("settings.saved"));
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["locale"] });
    },
    onError: (e) => {
      const found = e instanceof ApiError ? issuesFromBody(e.body) : [];
      setIssues(found);
      toast.error(found.length ? t("settings.notSaved") : apiErrorText(e));
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
            <p className="text-sm text-destructive">{t("common.adminRequired")}</p>
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
  if (jsonIssues.length) parseError = t("settings.jsonFixBelow");
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
              {t("settings.advancedJson")}
              <span className="text-xs font-normal text-muted-foreground">
                {t("settings.advancedJsonSub")}
              </span>
              <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-3 border-t border-border p-4">
              <p className="text-xs text-muted-foreground">{t("settings.advancedJsonHint")}</p>
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
            <span className="text-sm font-medium">{t("settings.unsaved")}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={discard} disabled={save.isPending}>
                <Undo2 /> {t("settings.discard")}
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={parseError != null || patch === undefined || save.isPending}
              >
                <Save /> {t("common.save")}
              </Button>
            </div>
          </div>
          {issues.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-destructive">
              {issues.map((i) => (
                <li key={i.path + i.message}>
                  <span className="font-mono">{i.path || t("settings.document")}</span>: {i.message}
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

// Each language in its own name, so it is findable whatever the UI language is.
const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "sv", label: "Svenska" },
  { value: "da", label: "Dansk" },
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
  const t = useT();
  const l = doc.locale;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.regionTitle")}</CardTitle>
        <CardDescription>{t("settings.regionHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Field
          id="locale-country"
          label={t("settings.country")}
          issues={issuesAt(issues, "locale.country")}
          hint={t("settings.countryHint")}
        >
          <Select
            value={l.country}
            onValueChange={(v) => {
              merge(applyCountryPreset(v as CountryCode));
              toast.info(t("settings.countryApplied", { country: COUNTRIES[v as CountryCode].name }));
            }}
          >
            <SelectTrigger id="locale-country">
              <SelectValue placeholder={t("settings.selectCountry")} />
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
            label={t("me.lang.title")}
            issues={issuesAt(issues, "locale.language")}
            hint={t("settings.languageHint")}
          >
            <Select value={l.language} onValueChange={(v) => set("locale.language", v as Language)}>
              <SelectTrigger id="locale-language">
                <SelectValue placeholder={t("settings.selectLanguage")} />
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
            label={t("settings.weekStart")}
            issues={issuesAt(issues, "locale.weekStart")}
            hint={t("settings.weekStartHint")}
          >
            <Select
              value={l.weekStart.toString()}
              onValueChange={(v) => set("locale.weekStart", Number(v) === 0 ? 0 : 1)}
            >
              <SelectTrigger id="locale-weekstart">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t("settings.monday")}</SelectItem>
                <SelectItem value="0">{t("settings.sunday")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="locale-currency"
            label={t("settings.currency")}
            issues={issuesAt(issues, "locale.currency")}
            hint={t("settings.currencyHint")}
          >
            <Input
              id="locale-currency"
              value={l.currency}
              placeholder={t("settings.eg", { example: "NZD" })}
              onChange={(e) => set("locale.currency", e.target.value)}
            />
          </Field>

          <Field
            id="locale-bcp47"
            label={t("settings.bcp47")}
            issues={issuesAt(issues, "locale.bcp47")}
            hint={t("settings.bcp47Hint")}
          >
            <Input
              id="locale-bcp47"
              value={l.bcp47}
              placeholder={t("settings.eg", { example: "en-NZ" })}
              onChange={(e) => set("locale.bcp47", e.target.value)}
            />
          </Field>

          <Field
            id="locale-region"
            label={t("settings.holidayRegion")}
            issues={issuesAt(issues, "locale.holidayRegion")}
            hint={t("settings.holidayRegionHint")}
          >
            <Input
              id="locale-region"
              value={l.holidayRegion}
              placeholder={t("settings.optional")}
              onChange={(e) => set("locale.holidayRegion", e.target.value)}
            />
          </Field>

          <Field
            id="locale-holidaypay"
            label={t("settings.holidayPremium")}
            issues={issuesAt(issues, "locale.holidayPayMultiplier")}
            hint={t("settings.holidayPremiumHint")}
          >
            <NumField
              id="locale-holidaypay"
              value={l.holidayPayMultiplier}
              onChange={(v) => set("locale.holidayPayMultiplier", v)}
              suffix="×"
            />
          </Field>
        </div>

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">{t("settings.legalNote")}</p>
      </CardContent>
    </Card>
  );
}

/** The rules people actually change: pay period, overtime, rounding, breaks, auto clock-out. */
function PayRulesSection({ doc, set, issues }: SectionProps) {
  const t = useT();
  const at = (p: string) => issuesAt(issues, p);
  const adapters = useQuery({
    queryKey: ["report-adapters"],
    queryFn: () =>
      apiGet<{ adapters: { id: string; label: string; implemented: boolean }[]; configured?: string }>(
        "/reports/adapters",
      ),
  });
  const adapterList = adapters.data?.adapters ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.payRulesTitle")}</CardTitle>
        <CardDescription>{t("settings.payRulesHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Group title={t("settings.payPeriod")}>
          <Field id="pp-type" label={t("settings.length")} issues={at("payPeriod.type")}>
            <Select value={doc.payPeriod.type} onValueChange={(v) => set("payPeriod.type", v)}>
              <SelectTrigger id="pp-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">{t("settings.weekly")}</SelectItem>
                <SelectItem value="fortnightly">{t("settings.fortnightly")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field
            id="pp-anchor"
            label={t("settings.anchor")}
            issues={at("payPeriod.anchor")}
            hint={t("settings.anchorHint")}
          >
            <Input
              id="pp-anchor"
              type="date"
              value={doc.payPeriod.anchor}
              onChange={(e) => set("payPeriod.anchor", e.target.value)}
            />
          </Field>
        </Group>

        <Group title={t("settings.overtime")}>
          <Field id="ot-daily" label={t("settings.otDaily")} issues={at("overtime.dailyThresholdMin")}>
            <NumField
              id="ot-daily"
              value={doc.overtime.dailyThresholdMin}
              scale={60}
              suffix="h"
              onChange={(v) => set("overtime.dailyThresholdMin", v)}
            />
          </Field>
          <Field id="ot-weekly" label={t("settings.otWeekly")} issues={at("overtime.weeklyThresholdMin")}>
            <NumField
              id="ot-weekly"
              value={doc.overtime.weeklyThresholdMin}
              scale={60}
              suffix="h"
              onChange={(v) => set("overtime.weeklyThresholdMin", v)}
            />
          </Field>
          <Field id="ot-m1" label={t("settings.otRate")} issues={at("overtime.multiplier1")}>
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
            label={t("settings.ot2After")}
            issues={at("overtime.daily2ThresholdMin")}
            hint={t("settings.ot2Hint")}
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
          <Field id="ot-m2" label={t("settings.ot2Rate")} issues={at("overtime.multiplier2")}>
            <NumField
              id="ot-m2"
              value={doc.overtime.multiplier2}
              suffix="×"
              onChange={(v) => set("overtime.multiplier2", v)}
            />
          </Field>
        </Group>

        <Group title={t("settings.rounding")}>
          <Field id="rnd-inc" label={t("settings.roundTo")} issues={at("rounding.incrementMin")}>
            <Select
              value={String(doc.rounding.incrementMin)}
              onValueChange={(v) => set("rounding.incrementMin", Number(v))}
            >
              <SelectTrigger id="rnd-inc">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">{t("settings.round1")}</SelectItem>
                <SelectItem value="5">{t("settings.roundN", { n: 5 })}</SelectItem>
                <SelectItem value="10">{t("settings.roundN", { n: 10 })}</SelectItem>
                <SelectItem value="15">{t("settings.roundN", { n: 15 })}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="rnd-mode" label={t("settings.direction")} issues={at("rounding.mode")}>
            <Select value={doc.rounding.mode} onValueChange={(v) => set("rounding.mode", v)}>
              <SelectTrigger id="rnd-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nearest">{t("settings.nearest")}</SelectItem>
                <SelectItem value="up">{t("settings.up")}</SelectItem>
                <SelectItem value="down">{t("settings.down")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Group>

        <Group title={t("settings.autoBreak")}>
          <Field
            id="brk-after"
            label={t("settings.shiftsLongerThan")}
            issues={at("breaks.autoDeductAfterMin")}
            hint={t("settings.autoBreakHint")}
          >
            <NumField
              id="brk-after"
              value={doc.breaks.autoDeductAfterMin}
              scale={60}
              suffix="h"
              onChange={(v) => set("breaks.autoDeductAfterMin", v)}
            />
          </Field>
          <Field id="brk-min" label={t("settings.deduct")} issues={at("breaks.autoDeductMin")}>
            <NumField
              id="brk-min"
              value={doc.breaks.autoDeductMin}
              suffix="min"
              onChange={(v) => set("breaks.autoDeductMin", v)}
            />
          </Field>
        </Group>

        <Group title={t("settings.forgottenOut")}>
          <div className="sm:col-span-2">
            <ToggleRow
              id="aco-enabled"
              label={t("settings.autoClockout")}
              checked={doc.autoClockout.enabled}
              onCheckedChange={(v) => set("autoClockout.enabled", v)}
            />
          </div>
          <Field id="aco-max" label={t("settings.longestShift")} issues={at("autoClockout.maxShiftHours")}>
            <NumField
              id="aco-max"
              value={doc.autoClockout.maxShiftHours}
              suffix="h"
              disabled={!doc.autoClockout.enabled}
              onChange={(v) => set("autoClockout.maxShiftHours", v)}
            />
          </Field>
        </Group>

        <Group title={t("settings.payrollExport")}>
          <Field
            id="payroll-adapter"
            label={t("settings.payrollFormat")}
            issues={at("payroll.adapter")}
            hint={t("settings.payrollFormatHint")}
          >
            <Select value={doc.payroll.adapter} onValueChange={(v) => set("payroll.adapter", v)}>
              <SelectTrigger id="payroll-adapter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {adapterList.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
                {/* Keep an unknown stored id selectable so it isn't silently dropped. */}
                {!adapterList.some((a) => a.id === doc.payroll.adapter) && (
                  <SelectItem value={doc.payroll.adapter}>{doc.payroll.adapter}</SelectItem>
                )}
              </SelectContent>
            </Select>
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
  const t = useT();
  const info = useQuery({
    queryKey: ["integration"],
    queryFn: () => apiGet<IntegrationInfo>("/admin/integration"),
  });

  const install = useMutation({
    mutationFn: () => api("/admin/integration/install", { method: "POST" }),
    onSuccess: () => {
      toast.success(t("settings.installed"));
      qc.invalidateQueries({ queryKey: ["integration"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiError
          ? t("settings.installFailedStatus", { status: e.status })
          : t("settings.installFailed"),
      ),
  });

  const rotate = useMutation({
    mutationFn: () => api<{ apiKey: string; haReloaded: boolean | null }>("/admin/integration/key", { method: "POST" }),
    onSuccess: (res) => {
      if (res.haReloaded === false) {
        toast.warning(t("settings.keyNoReload"));
      } else {
        toast.success(t("settings.keyRotated"));
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
        <CardTitle>{t("settings.haTitle")}</CardTitle>
        <CardDescription>{t("settings.haHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {info.isLoading && <Skeleton className="h-6 w-full" />}
        {s && (
          <div className="flex flex-wrap gap-2">
            <CheckBadge ok={s.haConfigMounted} label={t("settings.checkConfig")} />
            <CheckBadge ok={s.packageInstalled} label={t("settings.checkPackage")} />
            <CheckBadge ok={s.cardInstalled} label={t("settings.checkCard")} />
            <CheckBadge ok={s.packagesIncludeConfigured} label={t("settings.checkInclude")} />
          </div>
        )}
        {s?.packagesIncludeConfigured === false && (
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              {t("settings.includeHint", { key: "homeassistant:" })}{" "}
              <span className="font-mono">packages: !include_dir_named packages</span>
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => install.mutate()} disabled={install.isPending}>
            <Download />
            {s?.packageInstalled ? t("settings.reinstall") : t("settings.install")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending}
          >
            <RefreshCw />
            {info.data?.apiKey ? t("settings.rotateKey") : t("settings.generateKey")}
          </Button>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer py-2 font-medium">{t("settings.checklist")}</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>{t("settings.step1")}</li>
            <li>{t("settings.step2", { resource: "/local/timeclock-card.js" })}</li>
            <li>{t("settings.step3", { type: "custom:timeclock-card" })}</li>
            <li>{t("settings.step4", { script: "script.timeclock_<name>_toggle" })}</li>
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
  const t = useT();
  const p = doc.presence;
  const at = (k: string) => issuesAt(issues, `presence.${k}`);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.presenceTitle")}</CardTitle>
        <CardDescription>{t("settings.presenceHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ToggleRow
          id="presence-enabled"
          label={t("settings.presenceEnabled")}
          checked={p.enabled}
          onCheckedChange={(v) => set("presence.enabled", v)}
        />

        <div className="flex flex-col gap-4 border-t border-border pt-4">
          <ToggleRow
            id="presence-arrive"
            label={t("settings.remindArrive")}
            checked={p.notifyOnArrive}
            onCheckedChange={(v) => set("presence.notifyOnArrive", v)}
          />
          <ToggleRow
            id="presence-depart"
            label={t("settings.remindDepart")}
            checked={p.notifyOnDepart}
            onCheckedChange={(v) => set("presence.notifyOnDepart", v)}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Field
            id="presence-arrive-grace"
            label={t("settings.arriveGrace")}
            issues={at("arriveGraceSec")}
            hint={t("settings.arriveGraceHint")}
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
            label={t("settings.departGrace")}
            issues={at("departGraceSec")}
            hint={t("settings.departGraceHint")}
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
            label={t("settings.ssid")}
            issues={at("ssid")}
            hint={t("settings.ssidHint")}
          >
            <Input
              id="presence-ssid"
              value={p.ssid}
              placeholder={t("settings.eg", { example: "WorkWiFi" })}
              onChange={(e) => set("presence.ssid", e.target.value)}
            />
          </Field>
        </div>

        <details className="border-t border-border pt-4 text-sm" open={at("pollSec").length > 0}>
          <summary className="cursor-pointer py-1 font-medium text-muted-foreground">
            {t("settings.advanced")}
          </summary>
          <div className="mt-3 sm:max-w-48">
            <Field
              id="presence-poll"
              label={t("settings.pollInterval")}
              issues={at("pollSec")}
              hint={t("settings.pollHint")}
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

function CheckBadge({ ok, label }: { ok: boolean | null; label: string }) {
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
