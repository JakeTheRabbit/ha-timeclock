import type { PayPeriod } from "@/db/schema";
import type { TimesheetRow } from "@/server/domain/payperiod/timesheet";
import { toCsv } from "@/server/export/csv";
import type { PayrollExporter, PayrollExport } from "./adapter";

const h = (min: number) => (min / 60).toFixed(2);

/** WORKING adapter: employee-level pay-period totals, payroll-import friendly. */
export const csvExporter: PayrollExporter = {
  id: "csv",
  label: "Generic CSV (working)",
  exportPeriod(period: PayPeriod, rows: TimesheetRow[]): PayrollExport {
    const start = period.startAt.toISOString().slice(0, 10);
    const end = period.endAt.toISOString().slice(0, 10);
    const csv = toCsv(
      [
        "employee",
        "period_start",
        "period_end",
        "ordinary_hours",
        "overtime_1_5_hours",
        "overtime_2_0_hours",
        "stat_day_t1_5_hours",
        "alt_holidays_earned",
        "edited_days",
        "compliance_flags",
      ],
      rows.map((r) => [
        r.employeeName,
        start,
        end,
        h(r.totals.ordinaryMin),
        h(r.totals.ot1Min),
        h(r.totals.ot2Min),
        h(r.totals.statT15Min),
        r.totals.altHolidaysEarned,
        r.totals.editedDays,
        r.totals.complianceFlagCount,
      ]),
    );
    return {
      filename: `payroll_${start}_${end}.csv`,
      mime: "text/csv; charset=utf-8",
      data: csv,
    };
  },
};
