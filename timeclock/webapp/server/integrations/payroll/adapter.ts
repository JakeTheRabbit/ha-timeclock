import type { PayPeriod } from "@/db/schema";
import type { TimesheetRow } from "@/server/domain/payperiod/timesheet";

export interface PayrollExport {
  filename: string;
  mime: string;
  data: string | Buffer;
}

/**
 * Payroll destination seam. CSV ships working now; Xero/iPayroll implement the
 * same interface later (API push) without touching report routes.
 */
export interface PayrollExporter {
  id: string;
  label: string;
  /** Throws NotImplementedError for stub adapters. */
  exportPeriod(period: PayPeriod, rows: TimesheetRow[]): PayrollExport;
}

export class NotImplementedError extends Error {
  constructor(adapter: string) {
    super(`${adapter} export is not implemented yet — use the CSV adapter and import manually.`);
  }
}
