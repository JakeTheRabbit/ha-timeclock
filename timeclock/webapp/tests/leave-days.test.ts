import { describe, it, expect } from "vitest";
import {
  addDays,
  calendarDays,
  formatLeaveRange,
  groupRequests,
  nextWorkday,
  pendingHoursByType,
  usualDailyHours,
  workdaysBetween,
} from "@/lib/leave-days";

const MON_FRI = [1, 2, 3, 4, 5];
const none = new Set<string>();

describe("leave-days", () => {
  it("addDays crosses month/year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("nextWorkday skips weekends and holidays", () => {
    // 2026-11-13 is a Friday → next is Mon 16th.
    expect(nextWorkday("2026-11-13", MON_FRI, none)).toBe("2026-11-16");
    expect(nextWorkday("2026-11-13", MON_FRI, new Set(["2026-11-16"]))).toBe("2026-11-17");
    // Weekend worker.
    expect(nextWorkday("2026-11-13", [0, 6], none)).toBe("2026-11-14");
  });

  it("workdaysBetween counts usual days only, inclusive", () => {
    // Mon 16 – Sun 22 Nov 2026: 5 weekdays.
    expect(workdaysBetween("2026-11-16", "2026-11-22", MON_FRI, none)).toBe(5);
    expect(workdaysBetween("2026-11-16", "2026-11-22", MON_FRI, new Set(["2026-11-18"]))).toBe(4);
    expect(workdaysBetween("2026-11-21", "2026-11-22", MON_FRI, none)).toBe(0);
    expect(workdaysBetween("2026-11-20", "2026-11-16", MON_FRI, none)).toBe(0);
    // Christmas week NZ: 25 + 28 (Mondayised Boxing) are holidays.
    expect(workdaysBetween("2026-12-21", "2026-12-31", MON_FRI, new Set(["2026-12-25", "2026-12-28"]))).toBe(7);
  });

  it("calendarDays is inclusive", () => {
    expect(calendarDays("2026-11-16", "2026-11-16")).toBe(1);
    expect(calendarDays("2026-11-28", "2026-12-02")).toBe(5);
  });

  it("usualDailyHours = median day total, 8 when no history", () => {
    expect(usualDailyHours([])).toBe(8);
    expect(
      usualDailyHours([
        { day: "a", workedMinutes: 240 },
        { day: "a", workedMinutes: 240 }, // split shift → 8h day
        { day: "b", workedMinutes: 450 },
        { day: "c", workedMinutes: 600 },
        { day: "d", workedMinutes: null },
      ]),
    ).toBe(8);
    expect(usualDailyHours([{ day: "a", workedMinutes: 450 }, { day: "b", workedMinutes: 480 }])).toBe(7.75);
  });

  it("pendingHoursByType sums pending only", () => {
    expect(
      pendingHoursByType([
        { type: "annual", hours: "16.00", status: "pending" },
        { type: "annual", hours: "8", status: "pending" },
        { type: "annual", hours: "8", status: "approved" },
        { type: "sick", hours: 4, status: "pending" },
      ]),
    ).toEqual({ annual: 24, sick: 4 });
  });

  it("groupRequests splits pending / upcoming / past", () => {
    const r = (id: string, status: string, startDate: string, endDate = startDate) => ({ id, status, startDate, endDate });
    const g = groupRequests(
      [
        r("p2", "pending", "2026-12-10"),
        r("p1", "pending", "2026-12-01"),
        r("u", "approved", "2026-11-10", "2026-11-14"), // still running today
        r("old", "approved", "2026-10-01"),
        r("rej", "rejected", "2026-12-20"),
        r("can", "cancelled", "2026-11-01"),
      ],
      "2026-11-13",
    );
    expect(g.pending.map((x) => x.id)).toEqual(["p1", "p2"]);
    expect(g.upcoming.map((x) => x.id)).toEqual(["u"]);
    expect(g.past.map((x) => x.id)).toEqual(["rej", "can", "old"]);
  });

  it("formatLeaveRange reads like a human", () => {
    expect(formatLeaveRange("2026-12-07", "2026-12-09", "en-GB")).toBe("Mon 7 – Wed 9 Dec");
    expect(formatLeaveRange("2026-12-07", "2026-12-07", "en-GB")).toBe("Mon 7 Dec");
    expect(formatLeaveRange("2026-11-27", "2026-12-01", "en-GB")).toBe("Fri 27 Nov – Tue 1 Dec");
  });
});
