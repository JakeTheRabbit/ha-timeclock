import { buildTimeclockSummary, type EmployeeSummary } from "./summary";

/**
 * Publishes time-clock state into Home Assistant via the Supervisor Core API
 * proxy (homeassistant_api: true injects SUPERVISOR_TOKEN):
 *
 *   sensor.timeclock_summary       state = people currently clocked in;
 *                                  attributes carry the full per-employee
 *                                  summary the dashboard card renders.
 *   sensor.timeclock_<slug>        state = in|break|out per employee, with
 *                                  today/week/month/quarter/year attributes.
 *   sensor.timeclock_<slug>_today  numeric hours today (native HA graphs,
 *                                  template automations, companion widgets).
 *
 * Fire-and-forget from clock events (debounced) + refreshed by cron so live
 * totals keep ticking. No-op outside HA (no SUPERVISOR_TOKEN).
 */

const CORE_API = process.env.HA_CORE_API || "http://supervisor/core/api";

async function setState(entityId: string, state: string, attributes: Record<string, unknown>) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return false;
  const res = await fetchImpl(`${CORE_API}/states/${entityId}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ state, attributes }),
  });
  if (!res.ok) throw new Error(`HA set state ${entityId}: ${res.status}`);
  return true;
}

const STATUS_ICON: Record<EmployeeSummary["status"], string> = {
  in: "mdi:account-clock",
  break: "mdi:coffee",
  out: "mdi:account-off-outline",
};

const h = (min: number) => Math.round((min / 60) * 100) / 100;

export async function pushTimeclockStates(now = new Date()): Promise<void> {
  if (!process.env.SUPERVISOR_TOKEN) return; // dev/test: nothing to talk to
  const summary = await buildTimeclockSummary(now);

  await setState("sensor.timeclock_summary", String(summary.clockedIn), {
    friendly_name: "Time Clock",
    icon: "mdi:clock-check-outline",
    unit_of_measurement: "people",
    updated: summary.updated,
    // The dashboard card reads everything from here.
    employees: summary.employees,
  });

  for (const e of summary.employees) {
    await setState(`sensor.timeclock_${e.slug}`, e.status, {
      friendly_name: `Time Clock ${e.name}`,
      icon: STATUS_ICON[e.status],
      employee_id: e.id,
      since: e.since,
      job: e.job,
      today_hours: h(e.todayMin),
      week_hours: h(e.weekMin),
      month_hours: h(e.monthMin),
      quarter_hours: h(e.quarterMin),
      year_hours: h(e.yearMin),
    });
    await setState(`sensor.timeclock_${e.slug}_today`, h(e.todayMin).toFixed(2), {
      friendly_name: `Time Clock ${e.name} today`,
      icon: "mdi:timer-outline",
      unit_of_measurement: "h",
      state_class: "measurement",
      status: e.status,
    });
  }
}

// ---- Debounced trigger for clock events: several punches in quick succession
// (switch-job closes + opens) collapse into one push. ----
let pending: ReturnType<typeof setTimeout> | null = null;

export function schedulePush(delayMs = 1500): void {
  if (!process.env.SUPERVISOR_TOKEN) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    pushTimeclockStates().catch((e) =>
      console.error("[ha-push] failed:", e instanceof Error ? e.message : e),
    );
  }, delayMs);
}

// Injectable for tests.
export let fetchImpl: typeof fetch = fetch;
export function setFetchImpl(f: typeof fetch) {
  fetchImpl = f;
}
