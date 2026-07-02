import { describe, it, expect } from "vitest";
import { publicHolidayOn, publicHolidays } from "@/server/domain/holidays/provider";

/**
 * Per-country public-holiday resolution via the provider (no DB).
 *
 * date-holidays covers all target countries; we assert well-known, stable dates.
 * Where the library's exact name could drift we assert on presence (non-null)
 * rather than a specific string. NZ must still route through the tuned computed
 * engine, not date-holidays.
 */

const YEAR = 2026;

describe("provider: date-holidays countries", () => {
  it("US: New Year, Independence Day, Christmas", () => {
    expect(publicHolidayOn("2026-01-01", "US")).not.toBeNull();
    expect(publicHolidayOn("2026-07-04", "US")).not.toBeNull();
    expect(publicHolidayOn("2026-12-25", "US")).not.toBeNull();
    // A plainly non-holiday weekday.
    expect(publicHolidayOn("2026-07-06", "US")).toBeNull();
  });

  it("GB: New Year, Christmas, Boxing Day", () => {
    expect(publicHolidayOn("2026-01-01", "GB")).not.toBeNull();
    expect(publicHolidayOn("2026-12-25", "GB")?.name).toMatch(/christmas/i);
    expect(publicHolidayOn("2026-12-26", "GB")).not.toBeNull();
  });

  it("DE: German Unity Day (Oct 3) + Christmas", () => {
    expect(publicHolidayOn("2026-10-03", "DE")).not.toBeNull();
    expect(publicHolidayOn("2026-12-25", "DE")).not.toBeNull();
  });

  it("FR: Bastille Day (Jul 14) + Labour Day (May 1)", () => {
    expect(publicHolidayOn("2026-07-14", "FR")).not.toBeNull();
    expect(publicHolidayOn("2026-05-01", "FR")).not.toBeNull();
  });

  it("SE: National Day (Jun 6)", () => {
    expect(publicHolidayOn("2026-06-06", "SE")).not.toBeNull();
  });

  it("DK: Christmas Day (public) resolves", () => {
    // Grundlovsdag (Jun 5) is an observance, not public — assert a solid one.
    expect(publicHolidayOn("2026-12-25", "DK")).not.toBeNull();
    // Good Friday is public in DK.
    expect(publicHolidayOn("2026-04-03", "DK")).not.toBeNull();
  });

  it("AU: Australia Day (Jan 26)", () => {
    expect(publicHolidayOn("2026-01-26", "AU")).not.toBeNull();
  });

  it("CA: Canada Day (Jul 1) — via getHolidays, not isHoliday", () => {
    expect(publicHolidayOn("2026-07-01", "CA")).not.toBeNull();
    expect(publicHolidayOn("2026-12-25", "CA")).not.toBeNull();
  });

  it("publicHolidays(year) returns a sorted non-trivial list per country", () => {
    for (const c of ["US", "GB", "DE", "FR", "SE", "DK", "AU", "CA"]) {
      const list = publicHolidays(YEAR, c);
      expect(list.length).toBeGreaterThanOrEqual(5);
      const dates = list.map((h) => h.date);
      expect([...dates].sort()).toEqual(dates); // already sorted
      // Only calendar dates, no time component.
      for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("region flows through: US California constructs without error", () => {
    // Region-specific lookups should not throw and still see federal holidays.
    expect(publicHolidayOn("2026-12-25", "US", "CA")).not.toBeNull();
  });
});

describe("provider: NZ still routes through the computed engine", () => {
  it("Waitangi Day (Feb 6) resolves for NZ", () => {
    const hit = publicHolidayOn("2026-02-06", "NZ");
    expect(hit).not.toBeNull();
    expect(hit?.name).toBe("Waitangi Day");
  });

  it("Matariki is present (computed engine only — date-holidays would not name it)", () => {
    const hit = publicHolidayOn("2026-07-10", "NZ");
    expect(hit?.name).toBe("Matariki");
    const list = publicHolidays(2026, "NZ");
    expect(list.some((h) => h.name === "Matariki")).toBe(true);
  });

  it("Auckland Anniversary present for NZ (computed engine)", () => {
    const list = publicHolidays(2026, "NZ");
    expect(list.some((h) => h.name === "Auckland Anniversary")).toBe(true);
  });
});
