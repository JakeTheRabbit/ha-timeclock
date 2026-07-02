import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { employees, timeEntries } from "@/db/schema";
import { getSettings, type Settings } from "@/server/domain/settings";
import { slugify } from "./summary";

/**
 * Presence-based clock reminders, run ENTIRELY inside the add-on — no HA
 * automations per employee, so nothing on the facility box reloads when the
 * roster changes. Each tick reads the presence entities from HA, debounces
 * transitions, and sends an ACTIONABLE notification ("Clock in" / "Clock out")
 * to the person's companion app. The single static handler automation in the
 * package turns the button tap back into a punch (see install.ts).
 *
 * It never auto-punches — staff asked to keep control (supply runs etc.); this
 * only nudges, the human taps.
 */

const CORE_API = process.env.HA_CORE_API || "http://supervisor/core/api";

// Values that mean "no signal" for a sensor-type presence entity.
const DISCONNECTED = new Set([
  "",
  "unavailable",
  "unknown",
  "none",
  "not connected",
  "<not connected>",
  "<disconnected>",
  "disconnected",
  "not_home",
  "off",
]);

/**
 * Is this entity's raw state "present" (at work)? Returns null when the state
 * is missing/unknown so the caller can skip the tick instead of guessing.
 *   device_tracker / person -> "home"
 *   binary_sensor           -> "on"
 *   sensor (Wi-Fi SSID)     -> state === ssid (if configured), else any
 *                              connected-looking SSID string
 */
export function isPresent(
  entity: string,
  raw: string | undefined,
  ssid: string,
): boolean | null {
  if (raw == null) return null;
  const domain = entity.split(".")[0];
  const s = raw.trim();
  if (domain === "device_tracker" || domain === "person") {
    if (s === "unavailable" || s === "unknown" || s === "") return null;
    return s === "home";
  }
  if (domain === "binary_sensor") {
    if (s === "unavailable" || s === "unknown" || s === "") return null;
    return s === "on";
  }
  // sensor / other: treat as a Wi-Fi SSID string.
  if (ssid) {
    if (DISCONNECTED.has(s.toLowerCase())) return false;
    return s === ssid;
  }
  if (DISCONNECTED.has(s.toLowerCase())) return false;
  return true; // connected to *some* network and no SSID filter set
}

export interface PresenceMemory {
  present: boolean | null; // committed state; null = not yet observed
  candidate: boolean | null; // pending opposite state awaiting grace
  candidateSince: number;
}

export function initialMemory(): PresenceMemory {
  return { present: null, candidate: null, candidateSince: 0 };
}

/**
 * Pure transition evaluator (unit-tested). Given the committed memory, the
 * freshly-read presence, whether the employee is currently clocked in, the
 * settings, and now(), returns the next memory and whether to notify.
 *
 * - Cold start (present === null): adopt the current reading silently — never
 *   notify the instant the add-on boots.
 * - A change must persist for the arrive/depart grace before it commits.
 * - Notify only when the punch is actually needed (arrive & clocked-out, or
 *   depart & clocked-in), and only once per committed transition.
 */
export function evalPresence(
  prev: PresenceMemory,
  presentNow: boolean | null,
  clockedIn: boolean,
  cfg: Pick<Settings["presence"], "arriveGraceSec" | "departGraceSec" | "notifyOnArrive" | "notifyOnDepart">,
  now: number,
): { mem: PresenceMemory; notify: "in" | "out" | null } {
  if (presentNow == null) return { mem: prev, notify: null }; // no signal this tick

  if (prev.present == null) {
    return { mem: { present: presentNow, candidate: null, candidateSince: now }, notify: null };
  }

  if (presentNow === prev.present) {
    // Back to the committed state before grace elapsed — cancel any pending flip.
    return { mem: { ...prev, candidate: null, candidateSince: 0 }, notify: null };
  }

  // A change from the committed state: start / continue the grace timer.
  const candidate = prev.candidate === presentNow ? prev.candidate : presentNow;
  const candidateSince = prev.candidate === presentNow ? prev.candidateSince : now;
  const graceMs = (presentNow ? cfg.arriveGraceSec : cfg.departGraceSec) * 1000;

  if (now - candidateSince < graceMs) {
    return { mem: { present: prev.present, candidate, candidateSince }, notify: null };
  }

  // Commit the flip.
  const mem: PresenceMemory = { present: presentNow, candidate: null, candidateSince: now };
  if (presentNow && !clockedIn && cfg.notifyOnArrive) return { mem, notify: "in" };
  if (!presentNow && clockedIn && cfg.notifyOnDepart) return { mem, notify: "out" };
  return { mem, notify: null };
}

const memory = new Map<string, PresenceMemory>();

async function fetchStates(): Promise<Map<string, string>> {
  const token = process.env.SUPERVISOR_TOKEN!;
  const res = await fetchImpl(`${CORE_API}/states`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HA states ${res.status}`);
  const rows = (await res.json()) as { entity_id: string; state: string }[];
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.entity_id, r.state);
  return map;
}

async function clockedInSet(): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: timeEntries.employeeId })
    .from(timeEntries)
    .where(isNull(timeEntries.clockOut));
  return new Set(rows.map((r) => r.id));
}

async function sendPresenceNotification(
  service: string,
  name: string,
  slug: string,
  employeeId: string,
  verb: "in" | "out",
): Promise<void> {
  const token = process.env.SUPERVISOR_TOKEN!;
  const [domain, svc, ...rest] = service.split(".");
  // Domain MUST be notify, and the service name must be a bare HA object id
  // ([a-z0-9_]) — it is interpolated straight into the request URL path, so
  // reject anything with a dot, slash, or other path-significant character.
  if (domain !== "notify" || rest.length > 0 || !svc || !/^[a-z0-9_]+$/.test(svc)) {
    throw new Error(`bad notify service: ${service}`);
  }
  const body = {
    title: verb === "in" ? "Clock in?" : "Clock out?",
    message:
      verb === "in"
        ? `You're at work, ${name}. Tap to start your shift.`
        : `Looks like you've left, ${name}. Tap to end your shift.`,
    data: {
      tag: `timeclock_${slug}`,
      // Consumed by the static handler automation -> rest_command.timeclock_punch.
      actions: [
        {
          action: `TIMECLOCK_${verb.toUpperCase()}__${employeeId}`,
          title: verb === "in" ? "Clock in" : "Clock out",
        },
      ],
    },
  };
  const res = await fetchImpl(`${CORE_API}/services/notify/${svc}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`notify ${service}: ${res.status}`);
}

/** One presence sweep. Safe to call when disabled / outside HA (no-ops). */
export async function pollPresenceOnce(now = Date.now()): Promise<void> {
  if (!process.env.SUPERVISOR_TOKEN) return;
  const { presence } = await getSettings();
  if (!presence.enabled) return;

  const staff = await getDb()
    .select()
    .from(employees)
    .where(
      and(eq(employees.active, true), isNotNull(employees.presenceEntity), isNotNull(employees.notifyService)),
    );
  if (staff.length === 0) return;

  const states = await fetchStates();
  const inSet = await clockedInSet();

  for (const e of staff) {
    const present = isPresent(e.presenceEntity!, states.get(e.presenceEntity!), presence.ssid);
    const prev = memory.get(e.id) ?? initialMemory();
    const { mem, notify } = evalPresence(prev, present, inSet.has(e.id), presence, now);
    memory.set(e.id, mem);
    if (notify) {
      try {
        await sendPresenceNotification(e.notifyService!, e.displayName, slugify(e.displayName), e.id, notify);
      } catch (err) {
        console.error(`[presence] notify ${e.displayName} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic presence sweep (idempotent). Interval from settings. */
export function startPresenceWatcher(): void {
  if (timer || !process.env.SUPERVISOR_TOKEN) return;
  const tick = () =>
    void pollPresenceOnce().catch((e) =>
      console.error("[presence] sweep failed:", e instanceof Error ? e.message : e),
    );
  getSettings()
    .then((s) => {
      timer = setInterval(tick, Math.max(15, s.presence.pollSec) * 1000);
      tick(); // first sweep just seeds memory (cold start never notifies)
      console.log(`[presence] watcher started (every ${Math.max(15, s.presence.pollSec)}s)`);
    })
    .catch((e) => console.error("[presence] start failed:", e instanceof Error ? e.message : e));
}

// Injectable for tests.
export let fetchImpl: typeof fetch = fetch;
export function setFetchImpl(f: typeof fetch) {
  fetchImpl = f;
}

/** Test helper: clear in-memory presence state. */
export function _resetMemory() {
  memory.clear();
}
