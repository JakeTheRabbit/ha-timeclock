import cron from "node-cron";
import { runAutoClockout } from "./auto-clockout";
import { runDbBackup } from "./db-backup";
import { runAccrual } from "@/server/domain/leave/accrual";
import { pushTimeclockStates } from "@/server/integrations/ha/state-push";
import { refreshIntegrationIfInstalled } from "@/server/integrations/ha/install";
import { startPresenceWatcher } from "@/server/integrations/ha/presence";
import { APP_TZ } from "@/lib/tz";

let started = false;

/** Registered once from instrumentation.ts when the server boots. */
export function startScheduler(): void {
  if (started) return;
  started = true;

  const opts = { timezone: APP_TZ };

  // Auto-clockout sweep every 15 minutes.
  cron.schedule("*/15 * * * *", () => void safe("auto-clockout", runAutoClockout), opts);

  // Daily 02:30 NZ: DB backup + verify.
  cron.schedule("30 2 * * *", () => void safe("db-backup", runDbBackup), opts);

  // Weekly Monday 03:00 NZ: leave accrual over newly closed entries.
  cron.schedule("0 3 * * 1", () => void safe("leave-accrual", () => runAccrual(null)), opts);

  // HA sensors: refresh every 5 minutes so live "today" totals keep ticking
  // between punches; punches themselves push immediately (schedulePush).
  cron.schedule("*/5 * * * *", () => void safe("ha-push", () => pushTimeclockStates()), opts);
  void safe("ha-push", () => pushTimeclockStates()); // once at boot
  // If the HA package/card were installed, refresh them on boot so add-on
  // updates ship new card versions and the scripts track the roster.
  void safe("ha-integration-refresh", () => refreshIntegrationIfInstalled());

  // Presence-based clock reminders (self-paced interval; no-op unless enabled
  // in settings and running under HA). Sends notifications from inside the
  // add-on — no per-employee HA automations.
  startPresenceWatcher();

  console.log("[cron] scheduler started (auto-clockout 15m, backup 02:30, accrual Mon 03:00, ha-push 5m)");
}

async function safe(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const res = await fn();
    console.log(`[cron] ${name} ok`, typeof res === "number" ? `(${res})` : "");
  } catch (e) {
    console.error(`[cron] ${name} FAILED:`, e instanceof Error ? e.message : e);
  }
}
