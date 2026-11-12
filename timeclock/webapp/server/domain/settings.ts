import { settingsSchema, type Settings } from "./settings-schema";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { settings } from "@/db/schema";
import { appendAudit } from "@/server/domain/audit/writer";

export { settingsSchema, settingsIssues, zodIssues, type Settings, type SettingsIssue } from "./settings-schema";

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
