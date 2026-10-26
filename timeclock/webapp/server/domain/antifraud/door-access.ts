import { getSettings } from "@/server/domain/settings";

export const NO_DOOR_ACCESS = "no_door_access";

const CORE_API = process.env.HA_CORE_API || "http://supervisor/core/api";

/**
 * Cross-check a clock-in against the employee's HA card readers: returns
 * "no_door_access" when none of them swiped ("on") between lookbackMin before
 * and graceAfterMin after `clockIn`. Returns null when the swipe is there, the
 * employee has no readers mapped, the check is off, or HA can't be reached —
 * a dead HA link must not flag (or block) honest punches; it is logged.
 */
export async function doorAccessFlag(entities: string[], clockIn: Date): Promise<string | null> {
  const { doorAccess } = await getSettings();
  const token = process.env.SUPERVISOR_TOKEN;
  if (!doorAccess.enabled || entities.length === 0 || !token) return null;

  const start = new Date(clockIn.getTime() - doorAccess.lookbackMin * 60_000);
  const end = new Date(clockIn.getTime() + doorAccess.graceAfterMin * 60_000);
  const url =
    `${CORE_API}/history/period/${start.toISOString()}?end_time=${end.toISOString()}` +
    `&filter_entity_id=${entities.map(encodeURIComponent).join(",")}&minimal_response&no_attributes`;
  try {
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HA history ${res.status}`);
    const series = (await res.json()) as { state: string; last_changed: string }[][];
    // The first row of each series is the state AT `start` — only count
    // genuine transitions to "on" inside the window.
    const swiped = series
      .flat()
      .some((s) => s.state === "on" && new Date(s.last_changed).getTime() > start.getTime());
    return swiped ? null : NO_DOOR_ACCESS;
  } catch (e) {
    console.error("[door-access] check skipped:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Replace the door flag in a flag list with a freshly computed one. */
export function withDoorFlag(flags: string[], flag: string | null): string[] {
  const rest = flags.filter((f) => f !== NO_DOOR_ACCESS);
  return flag ? [...rest, flag] : rest;
}

// Injectable for tests.
export let fetchImpl: typeof fetch = fetch;
export function setFetchImpl(f: typeof fetch) {
  fetchImpl = f;
}
