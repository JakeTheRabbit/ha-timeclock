import { z } from "zod";

/**
 * Whole-app settings document. Every field has a default, so an empty DB doc
 * parses to a fully-populated config and new fields never need migrations.
 */
export const settingsSchema = z.object({
  locale: z
    .object({
      // ISO-3166 alpha-2 country preset. NZ keeps the computed holiday engine +
      // its tuned stat-pay logic; all other codes route holidays via date-holidays.
      country: z.enum(["NZ", "US", "GB", "IE", "CA", "AU", "DE", "FR", "CH", "SE", "DK"]).default("NZ"),
      // Consumed by the later i18n task; UI is NOT translated yet. Default en.
      language: z.enum(["en", "de", "fr", "sv", "da"]).default("en"),
      // BCP-47 locale tag for Intl date/number/currency formatting.
      bcp47: z.string().default("en-NZ"),
      // ISO 4217 currency code (display only — this is NOT tax/payroll software).
      currency: z.string().default("NZD"),
      // First day of the week for calendars/timesheet grouping. 0=Sun, 1=Mon.
      weekStart: z.union([z.literal(0), z.literal(1)]).default(1),
      // Optional state/province/canton passed to date-holidays (e.g. "CA" for
      // California under country "US"). Empty = country-level holidays only.
      holidayRegion: z.string().default(""),
      // Worked-public-holiday pay premium for NON-NZ countries (NZ keeps its own
      // Holidays Act stat-pay logic). 1 = no premium (statutory default in most
      // of the presets below); admins can raise it per their agreement.
      holidayPayMultiplier: z.number().min(1).default(1),
    })
    .default({}),
  overtime: z
    .object({
      dailyThresholdMin: z.number().int().min(0).default(8 * 60), // NZ spec: daily > 8h
      weeklyThresholdMin: z.number().int().min(0).default(40 * 60), // weekly > 40h
      multiplier1: z.number().min(1).default(1.5),
      multiplier2: z.number().min(1).default(2.0),
      daily2ThresholdMin: z.number().int().min(0).nullable().default(null), // e.g. >12h at 2x
    })
    .default({}),
  rounding: z
    .object({
      incrementMin: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(15)]).default(1),
      mode: z.enum(["nearest", "up", "down"]).default("nearest"),
    })
    .default({}),
  breaks: z
    .object({
      autoDeductAfterMin: z.number().int().min(0).default(6 * 60),
      autoDeductMin: z.number().int().min(0).default(30),
    })
    .default({}),
  payPeriod: z
    .object({
      type: z.enum(["weekly", "fortnightly"]).default("fortnightly"),
      // Anchor Monday; periods tile forward/backward from here (NZ dates).
      anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2026-01-05"),
    })
    .default({}),
  autoClockout: z
    .object({
      enabled: z.boolean().default(true),
      maxShiftHours: z.number().min(1).max(24).default(14),
    })
    .default({}),
  // Flag clock-ins with no card swipe on the employee's door readers within
  // lookbackMin before (or graceAfterMin after) the clock-in.
  doorAccess: z
    .object({
      enabled: z.boolean().default(true),
      lookbackMin: z.number().int().min(5).max(720).default(180),
      graceAfterMin: z.number().int().min(0).max(120).default(15),
    })
    .default({}),
  notifications: z
    .object({
      haNotifyEnabled: z.boolean().default(true),
      haNotifyService: z.string().default("notify.notify"),
      smtp: z
        .object({
          enabled: z.boolean().default(false), // creds DEFERRED — interface wired
          host: z.string().default(""),
          port: z.number().int().default(587),
          user: z.string().default(""),
          from: z.string().default(""),
        })
        .default({}),
    })
    .default({}),
  kiosk: z
    .object({
      // Off by default: every panel request already carries HA auth via
      // Ingress. On = PIN login only works on admin-bound kiosk devices.
      requireDeviceBinding: z.boolean().default(false),
    })
    .default({}),
  integration: z
    .object({
      // API key for the external clock API (dashboard card actions + Android
      // companion widgets). Empty = external API disabled; generate it from
      // Admin → Settings → Integration.
      apiKey: z.string().default(""),
    })
    .default({}),
  presence: z
    .object({
      // Presence-based reminders: when someone's phone joins the work network
      // (presence entity → present) offer a "clock in" notification; when it
      // leaves, offer "clock out". Notify-only — never auto-punches.
      enabled: z.boolean().default(false),
      pollSec: z.number().int().min(15).max(600).default(60),
      // How long presence must be stable before we act (anti-flap).
      arriveGraceSec: z.number().int().min(0).default(120),
      departGraceSec: z.number().int().min(0).default(300),
      // For sensor-type presence entities (e.g. a companion-app Wi-Fi SSID
      // sensor): "present" means state === this SSID. Ignored for
      // device_tracker/person/binary_sensor entities.
      ssid: z.string().default(""),
      notifyOnArrive: z.boolean().default(true),
      notifyOnDepart: z.boolean().default(true),
    })
    .default({}),
  antifraud: z
    .object({
      geofence: z
        .object({
          enabled: z.boolean().default(false),
          // Placeholder (Auckland CBD). Set the real facility coordinates in
          // Settings; the geofence is disabled by default anyway.
          lat: z.number().default(-36.8485),
          lng: z.number().default(174.7633),
          radiusM: z.number().min(10).default(250),
          enforce: z.boolean().default(false), // false = flag only
        })
        .default({}),
      ipAllowlist: z.array(z.string()).default([]), // CIDR or exact; empty = off
      ipEnforce: z.boolean().default(false),
      photoOnPunch: z.boolean().default(false),
    })
    .default({}),
});

export type Settings = z.infer<typeof settingsSchema>;

/** One validation problem, e.g. `{ path: "overtime.multiplier1", message }`. */
export interface SettingsIssue {
  path: string;
  message: string;
}

export const zodIssues = (e: z.ZodError): SettingsIssue[] =>
  e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

/** Problems with a whole settings document; [] when it is valid. */
export function settingsIssues(doc: unknown): SettingsIssue[] {
  const r = settingsSchema.safeParse(doc);
  return r.success ? [] : zodIssues(r.error);
}
