import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";
import { toCsv } from "@/server/export/csv";

describe("P9 CSV writer (unit)", () => {
  it("quotes commas/quotes/newlines, BOM prefix, CRLF", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["plain", 5]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x,y","say ""hi"""');
    expect(csv).toContain("plain,5");
    expect(csv).toContain("\r\n");
  });
});

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P9 reports + payroll adapters (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;
  let periodId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);

    const { rows } = await admin.query(
      `INSERT INTO pay_periods (start_at, end_at)
       VALUES ('2026-05-31T12:00:00Z', '2026-06-14T12:00:00Z') RETURNING id`,
    );
    periodId = rows[0].id;
    await admin.query(
      `INSERT INTO time_entries (employee_id, clock_in, clock_out)
       VALUES ($1, '2026-06-01T20:00:00Z', '2026-06-02T05:00:00Z')`,
      [w.employeeId],
    );
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("adapters list: csv implemented, xero/ipayroll stubbed", async () => {
    const res = await app.request("/api/reports/adapters", { headers: jsonHeaders(w.adminCookie) });
    const { adapters } = await res.json();
    expect(adapters.find((a: { id: string }) => a.id === "csv").implemented).toBe(true);
    expect(adapters.find((a: { id: string }) => a.id === "xero").implemented).toBe(false);
  });

  it("timesheet.csv downloads day-level rows", async () => {
    const res = await app.request(`/api/reports/timesheet.csv?periodId=${periodId}`, {
      headers: jsonHeaders(w.adminCookie),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("Stew");
    expect(csv).toContain("2026-06-02"); // NZ date of the shift
    expect(csv).toContain("9.00"); // 9h day
  });

  it("payroll csv adapter exports totals; stub adapters return 501", async () => {
    const csv = await app.request(`/api/reports/payroll?periodId=${periodId}&adapter=csv`, {
      headers: jsonHeaders(w.adminCookie),
    });
    expect(csv.status).toBe(200);
    const body = await csv.text();
    expect(body).toContain("ordinary_hours");
    expect(body).toContain("Stew");

    const xero = await app.request(`/api/reports/payroll?periodId=${periodId}&adapter=xero`, {
      headers: jsonHeaders(w.adminCookie),
    });
    expect(xero.status).toBe(501);
    expect((await xero.json()).error).toContain("not implemented");
  });

  it("timesheet.pdf returns a real PDF", async () => {
    const res = await app.request(`/api/reports/timesheet.pdf?periodId=${periodId}`, {
      headers: jsonHeaders(w.adminCookie),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });

  it("employee role denied reports (403)", async () => {
    const res = await app.request(`/api/reports/timesheet.csv?periodId=${periodId}`, {
      headers: jsonHeaders(w.employeeCookie),
    });
    expect(res.status).toBe(403);
  });
});
