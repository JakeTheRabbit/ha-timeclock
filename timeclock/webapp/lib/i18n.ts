/**
 * i18n seam (P12). v1 ships en-NZ only; UI strings that matter for future
 * translation route through t(). Adding a locale = add a table + a picker,
 * no component changes.
 */
const EN_NZ: Record<string, string> = {
  clock_in: "Clock in",
  clock_out: "Clock out",
  start_break: "Start break",
  end_break: "End break",
  offline_queued: "Offline — punch saved, will sync when back online",
  synced_punches: "Synced {n} offline punch(es)",
};

export type MessageKey = keyof typeof EN_NZ;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = EN_NZ[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}
