import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { appendAudit } from "@/server/domain/audit/writer";

/**
 * Whole-app settings document. Every field has a default, so an empty DB doc
 * parses to a fully-populated config and new fields never need migrations.
 */
export const settingsSchema = z.object({
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

let cache: { value: Settings; at: number } | null = null;
const CACHE_MS = 10_000;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await getDb().query.settings.findFirst();
  const value = settingsSchema.parse(row?.doc ?? {});
  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Deep-merge a partial patch into the stored doc (audited). */
export async function updateSettings(patch: unknown, actorId: string): Promise<Settings> {
  const db = getDb();
  const row = await db.query.settings.findFirst();
  const before = settingsSchema.parse(row?.doc ?? {});
  const merged = settingsSchema.parse(deepMerge(before, patch));

  await db.update(settings).set({ doc: merged, updatedAt: new Date() }).where(eq(settings.id, 1));
  invalidateSettingsCache();

  await appendAudit({
    entityType: "settings",
    entityId: "1",
    action: "update",
    actorId,
    oldValue: before,
    newValue: merged,
  });
  return merged;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (
    base && patch &&
    typeof base === "object" && typeof patch === "object" &&
    !Array.isArray(base) && !Array.isArray(patch)
  ) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return patch;
}
