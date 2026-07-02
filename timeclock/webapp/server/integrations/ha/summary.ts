import { eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, breaks, employees, jobs, type TimeEntry, type Break } from "@/db/schema";
import { unpaidBreakMinutes } from "@/server/domain/time/breaks";
import { nzDateOf } from "@/server/domain/holidays/stat-pay";

/**
 * Live per-employee summary powering the HA sensors and the dashboard card.
 * All aggregation happens here so the card stays a dumb renderer: totals for
 * today / this week / month / quarter / year, a daily series (42 days), a
 * weekly series (26 ISO weeks), and recent punches. Open entries count up to
 * `now`, so "today" ticks while someone is clocked in.
 */

export interface EmployeeSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  status: "in" | "break" | "out";
  /** ISO instant the current state began (clock-in or break start). */
  since: string | null;
  job: string | null;
  todayMin: number;
  weekMin: number;
  monthMin: number;
  quarterMin: number;
  yearMin: number;
  /** Last 42 NZ days, oldest first. */
  daily: { d: string; min: number }[];
  /** Last 26 Mon-anchored weeks, oldest first. */
  weekly: { w: string; min: number }[];
  /** Most recent punches, newest first. */
  punches: { in: string; out: string | null; min: number; job: string | null; edited: boolean }[];
}

export interface TimeclockSummary {
  updated: string;
  clockedIn: number;
  employees: EmployeeSummary[];
}

const DAILY_DAYS = 42;
const WEEKLY_WEEKS = 26;
const MAX_PUNCHES = 50;

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "employee"
  );
}

/** Monday (NZ date string) of the week containing the given NZ date. */
function mondayOf(nzDate: string): string {
  const dt = new Date(nzDate + "T00:00:00Z");
  const dow = (dt.getUTCDay() + 6) % 7; // Mon=0
  return new Date(dt.getTime() - dow * 24 * 3600_000).toISOString().slice(0, 10);
}

function addDays(nzDate: string, days: number): string {
  const dt = new Date(nzDate + "T00:00:00Z");
  return new Date(dt.getTime() + days * 24 * 3600_000).toISOString().slice(0, 10);
}

/** Worked minutes of one entry (open entries measured to `now`). */
function entryMinutes(e: TimeEntry, bs: Break[], now: Date): number {
  const out = e.clockOut ?? now;
  const span = (out.getTime() - e.clockIn.getTime()) / 60_000;
  return Math.max(0, Math.round(span - unpaidBreakMinutes(bs, out)));
}

export async function buildTimeclockSummary(now = new Date()): Promise<TimeclockSummary> {
  const db = getDb();
  const staff = await db.select().from(employees).where(eq(employees.active, true));

  const today = nzDateOf(now);
  const yearStart = today.slice(0, 4) + "-01-01";
  const weeklyStart = mondayOf(addDays(today, -7 * (WEEKLY_WEEKS - 1)));
  const horizon = yearStart < weeklyStart ? yearStart : weeklyStart;
  // NZ is ahead of UTC; pad one day so the horizon's first NZ day is complete.
  const horizonUtc = new Date(addDays(horizon, -1) + "T00:00:00Z");

  const entryRows = await db
    .select()
    .from(timeEntries)
    .where(gte(timeEntries.clockIn, horizonUtc));
  const entryIds = entryRows.map((e) => e.id);
  const allBreaks = entryIds.length
    ? await db.select().from(breaks).where(inArray(breaks.timeEntryId, entryIds))
    : [];
  const jobRows = await db.select().from(jobs);
  const jobName = (id: string | null) => jobRows.find((j) => j.id === id)?.name ?? null;

  const monthStart = today.slice(0, 8) + "01";
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const quarterStart = `${today.slice(0, 4)}-${String(quarter * 3 + 1).padStart(2, "0")}-01`;
  const weekStart = mondayOf(today);

  const result: EmployeeSummary[] = [];
  for (const emp of staff) {
    const mine = entryRows
      .filter((e) => e.employeeId === emp.id)
      .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());

    // Per-NZ-day worked minutes (attributed to the clock-in day).
    const dayMin = new Map<string, number>();
    for (const e of mine) {
      const bs = allBreaks.filter((b) => b.timeEntryId === e.id);
      const d = nzDateOf(e.clockIn);
      dayMin.set(d, (dayMin.get(d) ?? 0) + entryMinutes(e, bs, now));
    }

    const sumFrom = (start: string) =>
      [...dayMin.entries()].reduce((a, [d, m]) => (d >= start && d <= today ? a + m : a), 0);

    const daily: EmployeeSummary["daily"] = [];
    for (let i = DAILY_DAYS - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      daily.push({ d, min: dayMin.get(d) ?? 0 });
    }

    const weekly: EmployeeSummary["weekly"] = [];
    for (let i = WEEKLY_WEEKS - 1; i >= 0; i--) {
      const w = mondayOf(addDays(today, -7 * i));
      let min = 0;
      for (let d = 0; d < 7; d++) min += dayMin.get(addDays(w, d)) ?? 0;
      weekly.push({ w, min });
    }

    const open = mine.find((e) => e.clockOut == null);
    const openBreak = open
      ? allBreaks.find((b) => b.timeEntryId === open.id && b.endAt == null)
      : undefined;

    const punches = [...mine]
      .reverse()
      .slice(0, MAX_PUNCHES)
      .map((e) => ({
        in: e.clockIn.toISOString(),
        out: e.clockOut?.toISOString() ?? null,
        min: entryMinutes(e, allBreaks.filter((b) => b.timeEntryId === e.id), now),
        job: jobName(e.jobId),
        edited: e.edited,
      }));

    result.push({
      id: emp.id,
      name: emp.displayName,
      slug: slugify(emp.displayName),
      role: emp.role,
      status: openBreak ? "break" : open ? "in" : "out",
      since: openBreak?.startAt.toISOString() ?? open?.clockIn.toISOString() ?? null,
      job: open ? jobName(open.jobId) : null,
      todayMin: dayMin.get(today) ?? 0,
      weekMin: sumFrom(weekStart),
      monthMin: sumFrom(monthStart),
      quarterMin: sumFrom(quarterStart),
      yearMin: sumFrom(yearStart),
      daily,
      weekly,
      punches,
    });
  }

  return {
    updated: now.toISOString(),
    clockedIn: result.filter((e) => e.status !== "out").length,
    employees: result,
  };
}
