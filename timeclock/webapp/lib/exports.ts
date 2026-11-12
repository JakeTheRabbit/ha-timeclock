/** Pay-period export menu: one primary payroll export + the rest. Pure. */

export interface PayrollAdapter {
  id: string;
  label: string;
  implemented: boolean;
}

export interface ExportFormat {
  id: string;
  label: string;
  /** Path under /api (caller prefixes the base path). */
  path: string;
}

export function exportFormats(
  periodId: string,
  adapters: PayrollAdapter[],
  configured: string | undefined,
): { primary: ExportFormat; others: ExportFormat[] } {
  const payroll = (a: PayrollAdapter): ExportFormat => ({
    id: a.id,
    label: `Payroll ${a.label}`,
    path: `/reports/payroll?periodId=${periodId}&adapter=${a.id}`,
  });
  const usable = adapters.filter((a) => a.implemented);
  // A configured-but-stubbed adapter would 501, so fall back to CSV.
  const main =
    usable.find((a) => a.id === configured) ??
    usable.find((a) => a.id === "csv") ?? { id: "csv", label: "CSV", implemented: true };
  return {
    primary: payroll(main),
    others: [
      ...usable.filter((a) => a.id !== main.id).map(payroll),
      { id: "timesheet.csv", label: "Timesheet CSV", path: `/reports/timesheet.csv?periodId=${periodId}` },
      { id: "timesheet.pdf", label: "Timesheet PDF", path: `/reports/timesheet.pdf?periodId=${periodId}` },
    ],
  };
}

/** Readable name for an audited export format id. */
export function exportFormatLabel(format: string | null, adapters: PayrollAdapter[]): string {
  if (!format) return "export";
  if (format === "timesheet.csv") return "Timesheet CSV";
  if (format === "timesheet.pdf") return "Timesheet PDF";
  const a = adapters.find((x) => x.id === format);
  return `Payroll ${a?.label ?? format}`;
}
