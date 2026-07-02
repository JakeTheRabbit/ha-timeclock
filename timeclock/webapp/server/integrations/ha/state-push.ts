import { buildTimeclockSummary, type EmployeeSummary } from "./summary";

/**
 * Publishes time-clock state into Home Assistant via the Supervisor Core API
 * proxy (homeassistant_api: true injects SUPERVISOR_TOKEN):
 *
 *   sensor.timeclock_summary       state = people clocked in; SLIM per-employee
 *                                  attributes (status + period totals). Pushed
 *                                  every 5 min + after punches.
 *   sensor.timeclock_history       heavy series (42-day daily, 26-week weekly,
 *                                  recent punches) for the card's graphs.
 *                                  Pushed only after punches + hourly — big
 *                                  attributes, so keep recorder churn low
 *                                  (exclude it from recorder ideally).
 *   sensor.timeclock_<slug>        state = in|break|out per employee, with
 *                                  today/week/month/quarter/year attributes.
 *   sensor.timeclock_<slug>_today  numeric hours today (native HA graphs,
 *                                  template automations, companion widgets).
 *
 * When nobody is clocked in and nothing changed, pushes are attribute-stable
 * so the recorder dedupes them. No-op outside HA (no SUPERVISOR_TOKEN).
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

export async function pushTimeclockStates(opts?: { includeHistory?: boolean }): Promise<void> {
  if (!process.env.SUPERVISOR_TOKEN) return; // dev/test: nothing to talk to
  const summary = await buildTimeclockSummary();
  const anyoneIn = summary.clockedIn > 0;

  await setState("sensor.timeclock_summary", String(summary.clockedIn), {
    friendly_name: "Time Clock",
    icon: "mdi:clock-check-outline",
    unit_of_measurement: "people",
    // `updated` drives the card's live tickers; omit while idle so repeated
    // pushes are attribute-identical and the recorder stores nothing new.
    ...(anyoneIn ? { updated: summary.updated } : {}),
    employees: summary.employees.map(({ daily, weekly, punches, ...slim }) => {
      void daily, weekly, punches;
      return slim;
    }),
  });

  if (opts?.includeHistory) {
    await setState("sensor.timeclock_history", summary.updated.slice(0, 10), {
      friendly_name: "Time Clock history",
      icon: "mdi:chart-bar",
      updated: summary.updated,
      employees: summary.employees.map((e) => ({
        id: e.id,
        slug: e.slug,
        name: e.name,
        daily: e.daily,
        weekly: e.weekly,
        punches: e.punches,
      })),
    });
  }

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
// (switch-job closes + opens) collapse into one push. Punches change history,
// so these pushes include it. ----
let pending: ReturnType<typeof setTimeout> | null = null;

export function schedulePush(delayMs = 1500): void {
  if (!process.env.SUPERVISOR_TOKEN) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    pushTimeclockStates({ includeHistory: true }).catch((e) =>
      console.error("[ha-push] failed:", e instanceof Error ? e.message : e),
    );
  }, delayMs);
}

// Injectable for tests.
export let fetchImpl: typeof fetch = fetch;
export function setFetchImpl(f: typeof fetch) {
  fetchImpl = f;
}
