import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { timeEntries, breaks, employees, rosters, type PayPeriod } from "@/db/schema";
import { getSettings } from "@/server/domain/settings";
import { workedMinutes, unpaidBreakMinutes } from "@/server/domain/time/breaks";
import { roundedSpanMinutes } from "@/server/domain/time/rounding";
import { computeWeekOvertime, payWeightedMinutes } from "@/server/domain/overtime/engine";
import { breakComplianceFlags } from "@/server/domain/compliance/breaks-compliance";
import { assessStatDay, nzDateOf } from "@/server/domain/holidays/stat-pay";

export interface TimesheetDay {
  date: string; // NZ date
  workedMin: number; // rounded per policy, breaks deducted
  rawWorkedMin: number;
  edited: boolean;
  entryIds: string[];
  publicHoliday: string | null;
  timeAndAHalfMin: number;
  altHolidayEarned: boolean;
  complianceFlags: string[];
}

export interface TimesheetRow {
  employeeId: string;
  employeeName: string;
  days: TimesheetDay[];
  totals: {
    workedMin: number;
    ordinaryMin: number;
    ot1Min: number;
    ot2Min: number;
    payWeightedMin: number;
    statT15Min: number;
    altHolidaysEarned: number;
    editedDays: number;
    complianceFlagCount: number;
  };
}

/**
 * The payroll pre-run for one pay period: per employee, per NZ day —
 * rounded worked time, weekly OT attribution, stat-day pay, compliance flags,
 * edited-entry flags. Pure read; raw punches never mutated.
 */
export async function buildTimesheet(period: PayPeriod): Promise<TimesheetRow[]> {
  const db = getDb();
  const settings = await getSettings();

  const staff = await db.select().from(employees).where(eq(employees.active, true));
  const entryRows = await db
    .select()
    .from(timeEntries)
    .where(
      and(
        gte(timeEntries.clockIn, period.startAt),
        lt(timeEntries.clockIn, period.endAt),
        isNotNull(timeEntries.clockOut),
      ),
    );
  const entryIds = entryRows.map((e) => e.id);
  const allBreaks = entryIds.length
    ? await db.select().from(breaks).where(inArray(breaks.timeEntryId, entryIds))
    : [];
  const periodRosters = await db
    .select()
    .from(rosters)
    .where(and(eq(rosters.cancelled, false)));

  const rows: TimesheetRow[] = [];

  for (const emp of staff) {
    const mine = entryRows
      .filter((e) => e.employeeId === emp.id)
      .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
    if (mine.length === 0) continue;

    // Group by NZ calendar day.
    const byDay = new Map<string, typeof mine>();
    for (const e of mine) {
      const day = nzDateOf(e.clockIn);
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }

    const days: TimesheetDay[] = [];
    for (const [date, dayEntries] of [...byDay.entries()].sort()) {
      let raw = 0;
      let rounded = 0;
      let edited = false;
      const dayBreaks = allBreaks.filter((b) => dayEntries.some((e) => e.id === b.timeEntryId));
      for (const e of dayEntries) {
        const bs = allBreaks.filter((b) => b.timeEntryId === e.id);
        raw += workedMinutes(e.clockIn, e.clockOut!, bs);
        rounded +=
          roundedSpanMinutes(e.clockIn, e.clockOut!, settings.rounding) -
          unpaidBreakMinutes(bs, e.clockOut!);
        edited ||= e.edited;
      }
      rounded = Math.max(0, rounded);

      // Otherwise-working-day: rostered that date, else worked ≥2 of the last
      // 4 same weekdays (approximation documented in DOCS).
      const rostered = periodRosters.some(
        (r) => r.employeeId === emp.id && r.shiftDate === date,
      );
      let owd = rostered;
      if (!owd) {
        const target = new Date(dayEntries[0].clockIn);
        let hits = 0;
        for (let wk = 1; wk <= 4; wk++) {
          const probe = nzDateOf(new Date(target.getTime() - wk * 7 * 24 * 3600_000));
          if (mine.some((e) => nzDateOf(e.clockIn) === probe)) hits++;
        }
        owd = hits >= 2;
      }

      const stat = assessStatDay({
        clockIn: dayEntries[0].clockIn,
        workedMin: rounded,
        otherwiseWorkingDay: owd,
      });
      const flags = breakComplianceFlags(raw, dayBreaks).map((f) => f.code);

      days.push({
        date,
        workedMin: rounded,
        rawWorkedMin: raw,
        edited,
        entryIds: dayEntries.map((e) => e.id),
        publicHoliday: stat.holidayName,
        timeAndAHalfMin: stat.timeAndAHalfMin,
        altHolidayEarned: stat.altHolidayEarned,
        complianceFlags: flags,
      });
    }

    // Weekly OT: split period days into Mon-Sun weeks by date.
    const weeks = new Map<string, number[]>(); // weekKey -> 7 worked-min slots
    for (const d of days) {
      const dt = new Date(d.date + "T00:00:00Z");
      const dow = (dt.getUTCDay() + 6) % 7; // Mon=0
      const monday = new Date(dt.getTime() - dow * 24 * 3600_000).toISOString().slice(0, 10);
      const slots = weeks.get(monday) ?? [0, 0, 0, 0, 0, 0, 0];
      slots[dow] += d.workedMin;
      weeks.set(monday, slots);
    }
    let ordinaryMin = 0;
    let ot1Min = 0;
    let ot2Min = 0;
    let payWeighted = 0;
    for (const slots of weeks.values()) {
      const r = computeWeekOvertime(slots, settings.overtime);
      ordinaryMin += r.ordinaryMin;
      ot1Min += r.ot1Min;
      ot2Min += r.ot2Min;
      payWeighted += payWeightedMinutes(r, settings.overtime);
    }

    rows.push({
      employeeId: emp.id,
      employeeName: emp.displayName,
      days,
      totals: {
        workedMin: days.reduce((a, d) => a + d.workedMin, 0),
        ordinaryMin,
        ot1Min,
        ot2Min,
        payWeightedMin: payWeighted,
        statT15Min: days.reduce((a, d) => a + d.timeAndAHalfMin, 0),
        altHolidaysEarned: days.filter((d) => d.altHolidayEarned).length,
        editedDays: days.filter((d) => d.edited).length,
        complianceFlagCount: days.reduce((a, d) => a + d.complianceFlags.length, 0),
      },
    });
  }
  return rows;
}
