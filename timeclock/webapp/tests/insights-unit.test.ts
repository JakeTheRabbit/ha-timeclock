import { describe, it, expect } from "vitest";
import { dailyMinutes, daysBetween, heatmap, localParts, totals, workerStats, type Slice } from "@/lib/insights";

// Facility TZ = Pacific/Auckland (NZDT, UTC+13 in late October).
const slice: Slice = {
  withPay: true,
  employees: [
    { id: "a", displayName: "Ann", active: true, slot: 0 },
    { id: "b", displayName: "Bob", active: true, slot: 1 },
    { id: "c", displayName: "Cat", active: true, slot: 2 }, // no entries
  ],
  entries: [
    // Ann Mon 26 Oct 09:00–17:00 NZ, 30m unpaid break -> 450 min, flagged + edited
    {
      id: "1", employeeId: "a", clockIn: "2026-10-25T20:00:00Z", clockOut: "2026-10-26T04:00:00Z",
      workedMinutes: 450, paidBreakMinutes: 10, unpaidBreakMinutes: 30, edited: true,
      fraudFlags: ["no_door_access"], paid: false, costCents: 11250,
    },
    // Ann Tue 27 Oct 09:10 NZ (rostered 09:00 -> late), 4h
    {
      id: "2", employeeId: "a", clockIn: "2026-10-26T20:10:00Z", clockOut: "2026-10-27T00:10:00Z",
      workedMinutes: 240, paidBreakMinutes: 0, unpaidBreakMinutes: 0, edited: false,
      fraudFlags: [], paid: true, costCents: 6000,
    },
    // Bob overnight Mon 26 Oct 22:00 -> Tue 02:00 NZ
    {
      id: "3", employeeId: "b", clockIn: "2026-10-26T09:00:00Z", clockOut: "2026-10-26T13:00:00Z",
      workedMinutes: 240, paidBreakMinutes: 0, unpaidBreakMinutes: 0, edited: false,
      fraudFlags: [], paid: false, costCents: null,
    },
  ],
  rosters: [{ employeeId: "a", shiftDate: "2026-10-27", startMin: 540, endMin: 1020 }],
  activity: [],
};

describe("dashboard aggregation", () => {
  it("local parts are facility time", () => {
    expect(localParts("2026-10-25T20:00:00Z")).toEqual({ weekday: 0, minute: 540 }); // Mon 09:00
  });

  it("per-worker stats, busiest first, idle people left out", () => {
    const s = workerStats(slice);
    expect(s.map((x) => x.employee.id)).toEqual(["a", "b"]);
    const ann = s[0];
    expect(ann).toMatchObject({
      minutes: 690, shifts: 2, daysWorked: 2, avgShiftMin: 345, edits: 1, noDoorSwipe: 1,
      late: 1, rostered: 1, paidBreakMin: 10, unpaidBreakMin: 30, costCents: 17250, onShiftNow: false,
    });
    expect(ann.avgStartMin).toBe(545); // (09:00 + 09:10) / 2
    expect(s[1].costCents).toBeNull();
  });

  it("totals across people", () => {
    expect(totals(workerStats(slice), true)).toMatchObject({
      minutes: 930, shifts: 3, people: 2, avgShiftMin: 310, noDoorSwipe: 1, late: 1, costCents: 17250,
    });
    expect(totals(workerStats(slice), false).costCents).toBeNull();
  });

  it("daily minutes put an overnight shift on its start day", () => {
    const days = daysBetween("2026-10-26", "2026-10-28");
    expect(days).toEqual(["2026-10-26", "2026-10-27"]);
    const d = dailyMinutes(slice, days);
    expect(d.get("2026-10-26")!.get("b")).toBe(240);
    expect(d.get("2026-10-27")!.get("b")).toBeUndefined();
    expect(d.get("2026-10-27")!.get("a")).toBe(240);
  });

  it("heatmap spreads on-site minutes over local hours, across midnight", () => {
    const g = heatmap(slice);
    expect(g[0][9]).toBe(60); // Mon 09:00 hour: Ann
    expect(g[0][22]).toBe(60); // Mon 22:00 hour: Bob
    expect(g[1][1]).toBe(60); // Tue 01:00 hour: Bob after midnight
    expect(g[1][9]).toBe(50); // Tue 09:10–10:00: Ann
    const total = g.flat().reduce((a, x) => a + x, 0);
    expect(total).toBe(8 * 60 + 4 * 60 + 4 * 60); // spans, not worked minutes
  });
});
