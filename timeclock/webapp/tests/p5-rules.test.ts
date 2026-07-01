import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { getPool } from "@/db/client";
import { resetDb, bootstrapWorld, jsonHeaders } from "./helpers";
import {
  nzPublicHolidays,
  easterSunday,
  holidayOn,
} from "@/server/domain/holidays/nz-public-holidays";
import { assessStatDay } from "@/server/domain/holidays/stat-pay";
import { computeWeekOvertime, payWeightedMinutes } from "@/server/domain/overtime/engine";
import { roundInstant, roundedSpanMinutes } from "@/server/domain/time/rounding";
import { breakComplianceFlags } from "@/server/domain/compliance/breaks-compliance";
import { autoDeductMinutes } from "@/server/domain/time/breaks";

const RULES = {
  dailyThresholdMin: 480,
  weeklyThresholdMin: 2400,
  multiplier1: 1.5,
  multiplier2: 2,
  daily2ThresholdMin: null as number | null,
};

describe("P5 NZ public holidays (unit)", () => {
  it("Easter computus matches known years", () => {
    expect(easterSunday(2025)).toEqual([2025, 4, 20]);
    expect(easterSunday(2026)).toEqual([2026, 4, 5]);
    expect(easterSunday(2027)).toEqual([2027, 3, 28]);
  });

  it("2026 calendar: fixed + computed + Matariki", () => {
    const h = nzPublicHolidays(2026);
    const byName = Object.fromEntries(h.map((x) => [x.name, x.date]));
    expect(byName["New Year's Day"]).toBe("2026-01-01"); // Thursday, no shift
    expect(byName["Auckland Anniversary"]).toBe("2026-01-26"); // closest Mon to Jan 29
    expect(byName["Good Friday"]).toBe("2026-04-03");
    expect(byName["Easter Monday"]).toBe("2026-04-06");
    expect(byName["ANZAC Day"]).toBe("2026-04-27"); // Sat 25th -> Mondayised
    expect(byName["King's Birthday"]).toBe("2026-06-01");
    expect(byName["Matariki"]).toBe("2026-07-10");
    expect(byName["Labour Day"]).toBe("2026-10-26");
  });

  it("Mondayisation pairs: Christmas/Boxing 2027 (Sat/Sun) -> Mon/Tue", () => {
    const h = nzPublicHolidays(2027);
    const byName = Object.fromEntries(h.map((x) => [x.name, x.date]));
    expect(byName["Christmas Day"]).toBe("2027-12-27");
    expect(byName["Boxing Day"]).toBe("2027-12-28");
    expect(byName["Waitangi Day"]).toBe("2027-02-08"); // Sat 6th -> Mon 8th
  });

  it("holidayOn observed-date lookup", () => {
    expect(holidayOn("2026-07-10")?.name).toBe("Matariki");
    expect(holidayOn("2026-07-09")).toBeNull();
  });

  it("stat day assessment: t1.5 + alt holiday when otherwise-working-day", () => {
    const onHoliday = assessStatDay({
      clockIn: new Date("2026-07-10T08:00:00+12:00"), // Matariki
      workedMin: 450,
      otherwiseWorkingDay: true,
    });
    expect(onHoliday.isPublicHoliday).toBe(true);
    expect(onHoliday.timeAndAHalfMin).toBe(450);
    expect(onHoliday.altHolidayEarned).toBe(true);

    const casual = assessStatDay({
      clockIn: new Date("2026-07-10T08:00:00+12:00"),
      workedMin: 450,
      otherwiseWorkingDay: false,
    });
    expect(casual.altHolidayEarned).toBe(false); // paid 1.5x, no lieu day

    const normalDay = assessStatDay({
      clockIn: new Date("2026-07-09T08:00:00+12:00"),
      workedMin: 450,
      otherwiseWorkingDay: true,
    });
    expect(normalDay.isPublicHoliday).toBe(false);
    expect(normalDay.timeAndAHalfMin).toBe(0);
  });
});

describe("P5 overtime engine (unit)", () => {
  it("daily >8h carves OT1", () => {
    const r = computeWeekOvertime([600, 480, 480, 480, 480, 0, 0], RULES); // 10,8,8,8,8
    expect(r.ot1Min).toBe(120);
    expect(r.ordinaryMin).toBe(40 * 60);
  });

  it("weekly >40h assigns OT from the end of the week, no double count", () => {
    const r = computeWeekOvertime([480, 480, 480, 480, 480, 480, 0], RULES); // 6x8h = 48h
    expect(r.ordinaryMin).toBe(2400);
    expect(r.ot1Min).toBe(480);
    expect(r.perDay[5].ot1Min).toBe(480); // Saturday carries the weekly OT
    expect(r.perDay[0].ot1Min).toBe(0);
  });

  it("daily2 threshold routes the top hours to OT2", () => {
    const rules = { ...RULES, daily2ThresholdMin: 720 }; // >12h at 2x
    const r = computeWeekOvertime([13 * 60, 0, 0, 0, 0, 0, 0], rules);
    expect(r.ot2Min).toBe(60); // 12h->13h
    expect(r.ot1Min).toBe(240); // 8h->12h
    expect(r.ordinaryMin).toBe(480);
  });

  it("pay-weighted minutes apply multipliers", () => {
    const r = computeWeekOvertime([600, 480, 480, 480, 480, 0, 0], RULES);
    // 2400 ordinary + 120*1.5 = 2580
    expect(payWeightedMinutes(r, RULES)).toBe(2580);
  });
});

describe("P5 rounding (unit)", () => {
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 0, 5, h, m, 0));

  it("nearest 15: 8:07->8:00, 8:08->8:15", () => {
    expect(roundInstant(at(8, 7), { incrementMin: 15, mode: "nearest" }).getUTCMinutes()).toBe(0);
    expect(roundInstant(at(8, 8), { incrementMin: 15, mode: "nearest" }).getUTCMinutes()).toBe(15);
  });

  it("up / down modes", () => {
    expect(roundInstant(at(8, 1), { incrementMin: 15, mode: "up" }).getUTCMinutes()).toBe(15);
    expect(roundInstant(at(8, 14), { incrementMin: 15, mode: "down" }).getUTCMinutes()).toBe(0);
  });

  it("increment 1 = no rounding; span math", () => {
    expect(roundInstant(at(8, 7), { incrementMin: 1, mode: "nearest" }).getUTCMinutes()).toBe(7);
    expect(
      roundedSpanMinutes(at(8, 7), at(16, 3), { incrementMin: 15, mode: "nearest" }),
    ).toBe(8 * 60); // 8:00 -> 16:00
  });
});

describe("P5 break compliance (unit)", () => {
  const b = (paid: boolean, min: number) => ({
    paid,
    startAt: new Date(Date.UTC(2026, 0, 1, 12, 0)),
    endAt: new Date(Date.UTC(2026, 0, 1, 12, min)),
  });

  it("3h no breaks -> missing rest", () => {
    const flags = breakComplianceFlags(180, []);
    expect(flags.map((f) => f.code)).toEqual(["missing_rest_break"]);
  });

  it("5h with rest but no meal -> missing meal", () => {
    const flags = breakComplianceFlags(300, [b(true, 10)]);
    expect(flags.map((f) => f.code)).toEqual(["missing_meal_break"]);
  });

  it("8h fully compliant -> clean", () => {
    const flags = breakComplianceFlags(480, [b(true, 10), b(true, 10), b(false, 30)]);
    expect(flags).toEqual([]);
  });

  it("under 2h -> no entitlement", () => {
    expect(breakComplianceFlags(90, [])).toEqual([]);
  });
});

describe("P5 auto-deduct rule param (unit)", () => {
  it("settings-driven thresholds respected; 0 disables", () => {
    expect(autoDeductMinutes(500, 0, { autoDeductAfterMin: 480, autoDeductMin: 45 })).toBe(45);
    expect(autoDeductMinutes(500, 0, { autoDeductAfterMin: 600, autoDeductMin: 45 })).toBe(0);
    expect(autoDeductMinutes(500, 0, { autoDeductAfterMin: 480, autoDeductMin: 0 })).toBe(0);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const run = URL ? describe : describe.skip;

run("P5 settings API (real Postgres)", () => {
  let admin: Pool;
  let app: typeof import("@/server/hono").app;
  let w: Awaited<ReturnType<typeof bootstrapWorld>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL;
    admin = new Pool({ connectionString: URL });
    await resetDb(admin, URL!);
    ({ app } = await import("@/server/hono"));
    w = await bootstrapWorld(app);
  }, 60_000);

  afterAll(async () => {
    await admin.end();
    await getPool().end();
  });

  it("GET settings returns fully-defaulted doc", async () => {
    const res = await app.request("/api/admin/settings", { headers: jsonHeaders(w.adminCookie) });
    expect(res.status).toBe(200);
    const { settings } = await res.json();
    expect(settings.overtime.dailyThresholdMin).toBe(480);
    expect(settings.payPeriod.type).toBe("fortnightly");
  });

  it("PATCH deep-merges, persists, audits; invalid rejected", async () => {
    const res = await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ overtime: { multiplier1: 1.75 }, rounding: { incrementMin: 15 } }),
    });
    expect(res.status).toBe(200);
    const { settings } = await res.json();
    expect(settings.overtime.multiplier1).toBe(1.75);
    expect(settings.overtime.dailyThresholdMin).toBe(480); // untouched
    expect(settings.rounding.incrementMin).toBe(15);

    const bad = await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: jsonHeaders(w.adminCookie),
      body: JSON.stringify({ rounding: { incrementMin: 7 } }),
    });
    expect(bad.status).toBe(400);

    const audit = await admin.query("SELECT count(*)::int n FROM audit_log WHERE entity_type='settings'");
    expect(audit.rows[0].n).toBe(1);
  });

  it("employee cannot read/write settings (403)", async () => {
    const res = await app.request("/api/admin/settings", { headers: jsonHeaders(w.employeeCookie) });
    expect(res.status).toBe(403);
  });

  it("holidays endpoint serves the year", async () => {
    const res = await app.request("/api/holidays?year=2026", { headers: jsonHeaders(w.employeeCookie) });
    const body = await res.json();
    expect(body.holidays.length).toBeGreaterThanOrEqual(12);
  });
});
