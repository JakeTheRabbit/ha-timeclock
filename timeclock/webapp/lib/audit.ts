// Pure helpers for the audit viewer: readable labels and a field-level diff of
// the stored old ⇒ new JSON.

const ENTITY_LABELS: Record<string, string> = {
  time_entry: "Time entry",
  break: "Break",
  employee: "Employee",
  correction: "Correction",
  modification: "Staff change",
  day: "Day approval",
  leave_request: "Leave request",
  leave_ledger: "Leave balance",
  roster: "Roster shift",
  pay_period: "Pay period",
  bonus: "Bonus",
  device: "Device",
  settings: "Settings",
  job: "Job",
};

/** "clock_in" / "clockIn" → "Clock in". */
export function humanise(key: string): string {
  const s = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll(".", " › ")
    .toLowerCase()
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const entityLabel = (t: string) => ENTITY_LABELS[t] ?? humanise(t);
export const actionLabel = (a: string) => humanise(a);

/** Parse a stored audit value: JSON when it is JSON, else the raw string. */
export function parseValue(v: string | null): unknown {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Flatten nested objects to dotted paths ({a:{b:1}} → {"a.b": 1}); arrays stay leaves. */
export function flatten(v: unknown, prefix = ""): Record<string, unknown> {
  if (!isPlain(v)) return prefix ? { [prefix]: v } : { value: v };
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlain(x) && Object.keys(x).length) Object.assign(out, flatten(x, path));
    else out[path] = x;
  }
  return out;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Field-level diff of old ⇒ new. With both sides only changed fields are
 * listed; a create (no old) or delete (no new) lists every field it has.
 */
export function diffFields(oldRaw: string | null, newRaw: string | null): FieldChange[] {
  const o = oldRaw == null ? null : flatten(parseValue(oldRaw));
  const n = newRaw == null ? null : flatten(parseValue(newRaw));
  const keys = [...new Set([...Object.keys(o ?? {}), ...Object.keys(n ?? {})])];
  return keys
    .map((field) => ({ field, before: o?.[field], after: n?.[field] }))
    .filter((c) => !o || !n || JSON.stringify(c.before) !== JSON.stringify(c.after));
}

const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Display a diff value. `fmt` carries the locale formatters (useLocale()). */
export function formatValue(
  v: unknown,
  field: string,
  fmt: { dateTime: (v: string) => string; money: (n: number) => string },
): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") {
    if (/cents$/i.test(field)) return fmt.money(v / 100);
    if (/(min|minutes)$/i.test(field)) return `${v} min`;
    return String(v);
  }
  if (typeof v === "string") return ISO_DT.test(v) ? fmt.dateTime(v) : v;
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ") : "—";
  return JSON.stringify(v);
}
