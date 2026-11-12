import { Hono, type Context } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { auditLog, employees } from "@/db/schema";
import type { AppEnv } from "@/server/context";
import { requireRole } from "@/server/auth/rbac";
import { appendAudit } from "@/server/domain/audit/writer";
import { getSettings } from "@/server/domain/settings";
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

/** Every download is recorded so Pay periods can show "last exported". */
async function auditExport(
  c: Context<AppEnv>,
  period: { id: string; lockedAt: Date | null },
  format: string,
) {
  await appendAudit({
    entityType: "pay_period",
    entityId: period.id,
    action: "export",
    actorId: c.get("auth")!.employee.id,
    newValue: { format, locked: period.lockedAt != null },
  });
}

export const reports = new Hono<AppEnv>()
  .use(requireRole("lead"))

  .get("/adapters", async (c) => {
    const configured = (await getSettings()).payroll.adapter;
    return c.json({
      adapters: Object.values(ADAPTERS).map((a) => ({
        id: a.id,
        label: a.label,
        implemented: a.id === "csv",
      })),
      // Unknown ids fall back to csv so the primary button always works.
      configured: ADAPTERS[configured] ? configured : "csv",
    });
  })

  // Latest export of a period (any format), for the "last exported" stamp.
  .get("/last-export", async (c) => {
    const periodId = c.req.query("periodId") ?? "";
    const [row] = await getDb()
      .select({ at: auditLog.createdAt, newValue: auditLog.newValue, by: employees.displayName })
      .from(auditLog)
      .leftJoin(employees, eq(auditLog.actorId, employees.id))
      .where(
        and(eq(auditLog.entityType, "pay_period"), eq(auditLog.entityId, periodId), eq(auditLog.action, "export")),
      )
      .orderBy(desc(auditLog.id))
      .limit(1);
    if (!row) return c.json({ lastExport: null });
    const format = (JSON.parse(row.newValue ?? "{}") as { format?: string }).format ?? null;
    return c.json({ lastExport: { at: row.at, by: row.by, format } });
  })

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
    await auditExport(c, period, "timesheet.csv");
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
    await auditExport(c, period, "timesheet.pdf");
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
      await auditExport(c, period, adapter.id);
      c.header("content-type", out.mime);
      c.header("content-disposition", `attachment; filename="${out.filename}"`);
      return c.body(typeof out.data === "string" ? out.data : new Uint8Array(out.data));
    } catch (e) {
      if (e instanceof NotImplementedError) return c.json({ error: e.message }, 501);
      throw e;
    }
  });
