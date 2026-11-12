import { describe, expect, it } from "vitest";
import {
  breakLengthMin,
  breakProgress,
  nextShift,
  todayWork,
  usualWeekMin,
  weekStartDay,
} from "@/lib/clock-context";

const at = (hm: string, day = "2026-11-13") => new Date(`${day}T${hm}:00`);
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("todayWork", () => {
  const entries = [
    { id: "y", clockIn: at("08:00", "2026-11-12"), clockOut: at("16:00", "2026-11-12") },
    { id: "a", clockIn: at("06:00"), clockOut: at("07:00") }, // earlier, separate run
    { id: "b", clockIn: at("08:00"), clockOut: at("10:00") }, // switch job at 10:00
    { id: "c", clockIn: at("10:00"), clockOut: null },
  ];
  const breaks: Record<string, { startAt: Date; endAt: Date | null; paid: boolean }[]> = {
    b: [{ startAt: at("09:00"), endAt: at("09:30"), paid: false }],
    c: [{ startAt: at("10:30"), endAt: at("10:40"), paid: true }],
  };
  const r = todayWork(entries, (id) => breaks[id] ?? [], "c", "2026-11-13", dayOf, at("12:00"));

  it("sums today only, unpaid breaks off, running entry to now", () => {
    expect(r.todayWorkedMin).toBe(60 + 90 + 120);
  });
  it("shiftStart follows the job-switch chain back, not past a gap", () => {
    expect(r.shiftStart).toBe(at("08:00").toISOString());
    expect(r.chainIds).toEqual(["b", "c"]);
  });
  it("clocked out: no chain", () => {
    const out = todayWork(entries.slice(0, 3), () => [], null, "2026-11-13", dayOf, at("12:00"));
    expect(out.shiftStart).toBeNull();
    expect(out.todayWorkedMin).toBe(60 + 120);
  });
});

describe("breakProgress", () => {
  const rest = { startAt: at("10:00"), endAt: at("10:10"), paid: true };
  const meal = { startAt: at("12:00"), endAt: at("12:30"), paid: false };
  it("8h shift: two rests + meal due", () => {
    expect(breakProgress(480, [rest])).toEqual({ restTaken: 1, restDue: 2, mealDue: true, mealTaken: false });
    expect(breakProgress(480, [rest, meal]).mealTaken).toBe(true);
  });
  it("short shifts", () => {
    expect(breakProgress(90, [])).toMatchObject({ restDue: 0, mealDue: false });
    expect(breakProgress(180, [])).toMatchObject({ restDue: 1, mealDue: false });
  });
  it("open break does not count yet", () => {
    expect(breakProgress(480, [{ ...rest, endAt: null }]).restTaken).toBe(0);
  });
  it("break lengths", () => {
    expect(breakLengthMin(true, 45)).toBe(10);
    expect(breakLengthMin(false, 45)).toBe(45);
    expect(breakLengthMin(false, 0)).toBe(30);
  });
});

describe("nextShift / usualWeekMin / weekStartDay", () => {
  const shifts = [
    { shiftDate: "2026-11-13", startMin: 480, endMin: 990, jobId: "j1" },
    { shiftDate: "2026-11-17", startMin: 480, endMin: 990, jobId: null },
  ];
  it("current shift wins while it runs, then the next one", () => {
    expect(nextShift(shifts, at("09:00"))).toMatchObject({ current: true, shift: { jobId: "j1" } });
    expect(nextShift(shifts, at("17:00"))).toMatchObject({ current: false, shift: { shiftDate: "2026-11-17" } });
    expect(nextShift(shifts, at("09:00", "2026-11-18"))).toBeNull();
  });
  it("usual week = avg per worked day × workdays", () => {
    expect(usualWeekMin([{ day: "a", minutes: 240 }, { day: "a", minutes: 240 }, { day: "b", minutes: 480 }], 5)).toBe(2400);
    expect(usualWeekMin([], 5)).toBeNull();
  });
  it("week start (Fri 13 Nov 2026)", () => {
    expect(weekStartDay(at("12:00"), 1)).toBe("2026-11-09");
    expect(weekStartDay(at("12:00"), 0)).toBe("2026-11-08");
    expect(weekStartDay(at("12:00", "2026-11-09"), 1)).toBe("2026-11-09");
  });
});
