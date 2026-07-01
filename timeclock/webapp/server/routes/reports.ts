import { Hono } from "hono";
import { getDb } from "@/db/client";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { buildTimesheet } from "@/server/domain/payperiod/timesheet";
import { timesheetPdf } from "@/server/export/pdf";
import { toCsv } from "@/server/export/csv";
import { csvExporter } from "@/server/integrations/payroll/csv";
import { xeroExporter } from "@/server/integrations/payroll/xero";
import { iPayrollExporter } from "@/server/integrations/payroll/ipayroll";
import { NotImplementedError, type PayrollExporter } from "@/server/integrations/payroll/adapter";

const ADAPTERS: Record<string, PayrollExporter> = {
  [csvExporter.id]: csvExporter,
  [xeroExporter.id]: xeroExporter,
  [iPayrollExporter.id]: iPayrollExporter,
};

const h = (min: number) => (min / 60).toFixed(2);

async function loadPeriod(id: string) {
  return getDb().query.payPeriods.findFirst({ where: (p, { eq }) => eq(p.id, id) });
}

export const reports = new Hono<AppEnv>()
  .use(requireRole("lead"))

  .get("/adapters", (c) =>
    c.json({
      adapters: Object.values(ADAPTERS).map((a) => ({
        id: a.id,
        label: a.label,
        implemented: a.id === "csv",
      })),
    }),
  )

  // Day-level timesheet CSV.
  .get("/timesheet.csv", async (c) => {
    const period = await loadPeriod(c.req.query("periodId") ?? "");
    if (!period) return c.json({ error: "period_not_found" }, 404);
    const rows = await buildTimesheet(period);

    const csv = toCsv(
      ["employee", "date", "hours", "raw_hours", "public_holiday", "t1_5_hours", "alt_holiday", "edited", "flags"],
      rows.flatMap((r) =>
        r.days.map((d) => [
          r.employeeName,
          d.date,
          h(d.workedMin),
          h(d.rawWorkedMin),
          d.publicHoliday ?? "",
          h(d.timeAndAHalfMin),
          d.altHolidayEarned ? "yes" : "",
          d.edited ? "yes" : "",
          d.complianceFlags.join("; "),
        ]),
      ),
    );
    c.header("content-type", "text/csv; charset=utf-8");
    c.header(
      "content-disposition",
      `attachment; filename="timesheet_${period.startAt.toISOString().slice(0, 10)}.csv"`,
    );
    return c.body(csv);
  })

  // Timesheet summary PDF.
  .get("/timesheet.pdf", async (c) => {
    const period = await loadPeriod(c.req.query("periodId") ?? "");
    if (!period) return c.json({ error: "period_not_found" }, 404);
    const rows = await buildTimesheet(period);
    const pdf = await timesheetPdf(period, rows);
    c.header("content-type", "application/pdf");
    c.header(
      "content-disposition",
      `attachment; filename="timesheet_${period.startAt.toISOString().slice(0, 10)}.pdf"`,
    );
    return c.body(new Uint8Array(pdf));
  })

  // Payroll export via adapter (csv working; xero/ipayroll stubbed -> 501).
  .get("/payroll", async (c) => {
    const adapter = ADAPTERS[c.req.query("adapter") ?? "csv"];
    if (!adapter) return c.json({ error: "unknown_adapter" }, 400);
    const period = await loadPeriod(c.req.query("periodId") ?? "");
    if (!period) return c.json({ error: "period_not_found" }, 404);

    try {
      const out = adapter.exportPeriod(period, await buildTimesheet(period));
      c.header("content-type", out.mime);
      c.header("content-disposition", `attachment; filename="${out.filename}"`);
      return c.body(typeof out.data === "string" ? out.data : new Uint8Array(out.data));
    } catch (e) {
      if (e instanceof NotImplementedError) return c.json({ error: e.message }, 501);
      throw e;
    }
  });
