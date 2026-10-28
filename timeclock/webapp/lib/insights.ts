import { APP_TZ } from "@/lib/tz";

// Pure aggregation for the manager dashboard. Everything is computed from the
// one slice the API returns (GET /manager/insights), in facility time, so the
// tiles, charts, table, calendar and timeline can never disagree.

export interface SliceEmployee {
  id: string;
  displayName: string;
  active: boolean;
  slot: number; // stable categorical colour slot (0-7)
  payTracking?: boolean;
  hourlyRateCents?: number | null;
}
export interface SliceEntry {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  workedMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  edited: boolean;
  fraudFlags: string[];
  paid: boolean;
  costCents?: number | null;
}
export interface SliceRoster {
  employeeId: string;
  shiftDate: string;
  startMin: number;
  endMin: number;
}
export interface SliceActivity {
  at: string;
  action: string;
  entityType: string;
  actor: string;
  subject: string | null;
  reason: string | null;
}
export interface Slice {
  employees: SliceEmployee[];
  entries: SliceEntry[];
  rosters: SliceRoster[];
  activity: SliceActivity[];
  withPay: boolean;
}

const LATE_GRACE_MIN = 5;
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ });
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TZ,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Facility-local calendar day, YYYY-MM-DD. */
export const dayKey = (d: Date | string) => dayFmt.format(new Date(d));

/** Facility-local weekday (0 = Mon) and minute of day. */
export function localParts(d: Date | string): { weekday: number; minute: number } {
  const p = partsFmt.formatToParts(new Date(d));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { weekday: WEEKDAYS.indexOf(get("weekday")), minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Every local day from `from` up to (not including) `to`, as YYYY-MM-DD. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface WorkerStats {
  employee: SliceEmployee;
  minutes: number;
  shifts: number;
  daysWorked: number;
  avgShiftMin: number | null;
  avgStartMin: number | null; // local minute of day
  paidBreakMin: number;
  unpaidBreakMin: number;
  edits: number;
  noDoorSwipe: number;
  late: number; // clock-ins > 5 min after a rostered start that day
  rostered: number;
  onShiftNow: boolean;
  costCents: number | null;
}

/** Per-person stats, busiest first. People with no entries are left out. */
export function workerStats(slice: Slice): WorkerStats[] {
  const byEmp = new Map<string, SliceEntry[]>();
  for (const e of slice.entries) byEmp.set(e.employeeId, [...(byEmp.get(e.employeeId) ?? []), e]);

  return slice.employees
    .filter((emp) => byEmp.has(emp.id))
    .map((emp) => {
      const es = byEmp.get(emp.id)!;
      const closed = es.filter((e) => e.clockOut);
      const minutes = es.reduce((a, e) => a + e.workedMinutes, 0);
      const rosterByDay = new Map(
        slice.rosters.filter((r) => r.employeeId === emp.id).map((r) => [r.shiftDate, r.startMin]),
      );
      const late = es.filter((e) => {
        const start = rosterByDay.get(dayKey(e.clockIn));
        return start != null && localParts(e.clockIn).minute > start + LATE_GRACE_MIN;
      }).length;
      const costs = es.map((e) => e.costCents).filter((c): c is number => c != null);
      return {
        employee: emp,
        minutes,
        shifts: es.length,
        daysWorked: new Set(es.map((e) => dayKey(e.clockIn))).size,
        avgShiftMin: closed.length ? Math.round(closed.reduce((a, e) => a + e.workedMinutes, 0) / closed.length) : null,
        avgStartMin: Math.round(es.reduce((a, e) => a + localParts(e.clockIn).minute, 0) / es.length),
        paidBreakMin: es.reduce((a, e) => a + e.paidBreakMinutes, 0),
        unpaidBreakMin: es.reduce((a, e) => a + e.unpaidBreakMinutes, 0),
        edits: es.filter((e) => e.edited).length,
        noDoorSwipe: es.filter((e) => e.fraudFlags.includes("no_door_access")).length,
        late,
        rostered: rosterByDay.size,
        onShiftNow: es.some((e) => !e.clockOut),
        costCents: slice.withPay && costs.length ? costs.reduce((a, c) => a + c, 0) : null,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

export interface Totals {
  minutes: number;
  shifts: number;
  people: number;
  avgShiftMin: number | null;
  noDoorSwipe: number;
  edits: number;
  late: number;
  costCents: number | null;
}

export function totals(stats: WorkerStats[], withPay: boolean): Totals {
  const sum = (f: (s: WorkerStats) => number) => stats.reduce((a, s) => a + f(s), 0);
  const shifts = sum((s) => s.shifts);
  const minutes = sum((s) => s.minutes);
  return {
    minutes,
    shifts,
    people: stats.length,
    avgShiftMin: shifts ? Math.round(minutes / shifts) : null,
    noDoorSwipe: sum((s) => s.noDoorSwipe),
    edits: sum((s) => s.edits),
    late: sum((s) => s.late),
    costCents: withPay ? sum((s) => s.costCents ?? 0) : null,
  };
}

/**
 * Worked minutes per local day per person (a shift counts on the day it
 * started — an overnight shift sits on its start day).
 */
export function dailyMinutes(slice: Slice, days: string[]): Map<string, Map<string, number>> {
  const out = new Map(days.map((d) => [d, new Map<string, number>()]));
  for (const e of slice.entries) {
    const day = out.get(dayKey(e.clockIn));
    if (day) day.set(e.employeeId, (day.get(e.employeeId) ?? 0) + e.workedMinutes);
  }
  return out;
}

/**
 * On-site person-minutes by local weekday × hour (7 × 24), from shift spans.
 * NZ offsets are whole hours, so UTC hour boundaries are local ones too.
 */
export function heatmap(slice: Slice, now: Date = new Date()): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const e of slice.entries) {
    let t = new Date(e.clockIn).getTime();
    const end = (e.clockOut ? new Date(e.clockOut) : now).getTime();
    while (t < end) {
      const next = Math.min(end, Math.floor(t / 3600_000) * 3600_000 + 3600_000);
      const { weekday, minute } = localParts(new Date(t));
      grid[weekday][Math.floor(minute / 60)] += (next - t) / 60_000;
      t = next;
    }
  }
  return grid;
}

/** "07:45" from a minute of day. */
export const hhmm = (min: number | null) =>
  min == null ? "—" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const hours = (min: number | null) => (min == null ? "—" : `${(min / 60).toFixed(2)}h`);

export const money = (cents: number | null | undefined) =>
  cents == null ? "—" : new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);

/** Human line for an audit action in the activity feed. */
export function describeActivity(a: SliceActivity): string {
  const who = a.subject && a.subject !== a.actor ? ` (${a.subject})` : "";
  const map: Record<string, string> = {
    clock_in: "clocked in",
    clock_out: "clocked out",
    break_start: "started a break",
    break_end: "ended a break",
    auto_clockout: "auto clock-out",
    auto_deduct: "auto meal-break deduction",
    self_edit: "edited their times",
    self_edit_break: "edited a break",
    self_edit_break_add: "added a break",
    manager_edit: "edited times",
    manager_edit_break: "edited a break",
    manager_edit_break_add: "added a break",
    correction_approved: "correction approved",
    request: "requested a correction",
    approve: "approved a correction",
    reject: "rejected a correction",
    mark_paid: a.entityType === "bonus" ? "marked a bonus paid" : "marked time paid",
    mark_unpaid: a.entityType === "bonus" ? "marked a bonus unpaid" : "marked time unpaid",
    void: "voided a bonus",
    create: a.entityType === "bonus" ? "added a bonus" : `created ${a.entityType}`,
    update: `updated ${a.entityType}`,
    pin_set: "set a PIN",
    lock: "locked a pay period",
    unlock: "unlocked a pay period",
  };
  return `${map[a.action] ?? a.action.replaceAll("_", " ")}${who}`;
}
