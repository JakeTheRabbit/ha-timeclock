import PDFDocument from "pdfkit";
import type { PayPeriod } from "@/db/schema";
import type { TimesheetRow } from "@/server/domain/payperiod/timesheet";

const h = (min: number) => (min / 60).toFixed(2);

/** Timesheet summary PDF (per-employee totals + per-day detail). */
export function timesheetPdf(period: PayPeriod, rows: TimesheetRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const start = period.startAt.toISOString().slice(0, 10);
    const end = period.endAt.toISOString().slice(0, 10);

    doc.fontSize(16).text("Timesheet report", { continued: false });
    doc.fontSize(10).fillColor("#555").text(`Pay period ${start} → ${end}`);
    doc.moveDown();

    for (const r of rows) {
      doc.fillColor("#000").fontSize(12).text(r.employeeName, { underline: true });
      doc.fontSize(9).fillColor("#333");
      doc.text(
        `Ordinary ${h(r.totals.ordinaryMin)}h · OT1.5 ${h(r.totals.ot1Min)}h · OT2 ${h(
          r.totals.ot2Min,
        )}h · Stat(T1.5) ${h(r.totals.statT15Min)}h · Alt holidays ${r.totals.altHolidaysEarned}` +
          ` · Edited days ${r.totals.editedDays} · Compliance flags ${r.totals.complianceFlagCount}`,
      );
      doc.moveDown(0.3);
      for (const d of r.days) {
        doc.text(
          `  ${d.date}  ${h(d.workedMin)}h` +
            (d.publicHoliday ? `  [${d.publicHoliday}]` : "") +
            (d.edited ? "  [edited]" : "") +
            (d.complianceFlags.length ? `  [${d.complianceFlags.join(", ")}]` : ""),
        );
      }
      doc.moveDown();
    }
    if (rows.length === 0) doc.text("No worked time in this period.");
    doc.end();
  });
}
