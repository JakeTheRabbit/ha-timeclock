import { describe, expect, it } from "vitest";
import { missedUsualDay, monthGrid, shiftTime, weekDays } from "@/components/entries/month-calendar";
import { localDay } from "@/components/entries/edit-entry-dialog";
import { formatTime } from "@/lib/format";

describe("weekDays", () => {
  it("Monday-start week containing a Thursday", () => {
    expect(weekDays("2026-11-12", 1)).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15",
    ]);
  });
  it("Sunday-start week; a Sunday starts its own week", () => {
    expect(weekDays("2026-11-15", 0)[0]).toBe("2026-11-15");
    expect(weekDays("2026-11-14", 0)).toEqual([
      "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14",
    ]);
  });
  it("crosses a month boundary", () => {
    expect(weekDays("2026-12-01", 1)).toEqual([
      "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06",
    ]);
  });
});

describe("monthGrid", () => {
  it("starts on the configured weekday", () => {
    // Nov 2026: the 1st is a Sunday.
    expect(localDay(monthGrid(new Date(2026, 10, 1), 1).start)).toBe("2026-10-26");
    expect(localDay(monthGrid(new Date(2026, 10, 1), 0).start)).toBe("2026-11-01");
    expect(localDay(monthGrid(new Date(2026, 10, 1)).start)).toBe("2026-10-26"); // default Monday
  });
});

describe("missedUsualDay", () => {
  const usual = [1, 2, 3, 4, 5];
  it("past usual weekday with nothing is missed", () => {
    expect(missedUsualDay("2026-11-10", "2026-11-13", usual, false)).toBe(true);
  });
  it("not when it has hours, is today/future, a weekend, or leave/holiday", () => {
    expect(missedUsualDay("2026-11-10", "2026-11-13", usual, true)).toBe(false);
    expect(missedUsualDay("2026-11-13", "2026-11-13", usual, false)).toBe(false);
    expect(missedUsualDay("2026-11-16", "2026-11-13", usual, false)).toBe(false);
    expect(missedUsualDay("2026-11-08", "2026-11-13", usual, false)).toBe(false); // Sunday
    expect(missedUsualDay("2026-11-10", "2026-11-13", usual, false, new Set(["2026-11-10"]))).toBe(false);
  });
});

describe("shiftTime", () => {
  const loc = (bcp47: string) => ({ time: (v: string | number | Date, o?: Intl.DateTimeFormatOptions) => formatTime(v, bcp47, o) });
  it("formats minutes-into-day as wall clock, honouring the locale's 12/24h", () => {
    expect(shiftTime(loc("en-GB"), 8 * 60 + 5)).toBe("08:05");
    expect(shiftTime(loc("en-GB"), 16 * 60 + 30)).toBe("16:30");
    expect(shiftTime(loc("en-US"), 16 * 60 + 30)).toMatch(/04:30\s?PM/i);
  });
});
