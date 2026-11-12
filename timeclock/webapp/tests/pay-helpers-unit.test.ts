import { describe, expect, it } from "vitest";
import {
  flagLabel,
  groupByWeek,
  lastFinishedPeriod,
  mostOwed,
  nextPaymentNote,
  periodDays,
  weekStartDay,
} from "@/lib/pay-helpers";

const today = new Date(2026, 10, 13, 9, 30); // Fri 13 Nov 2026, local
const fmt = (d: Date) => d.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });

describe("nextPaymentNote", () => {
  it("swaps the old date for today's, keeping the pattern", () => {
    expect(nextPaymentNote("paid 28 Oct bank transfer", today, fmt)).toBe("paid 13 Nov bank transfer");
    expect(nextPaymentNote("Bank transfer Oct 28, 2026", today, fmt)).toBe("Bank transfer 13 Nov");
    expect(nextPaymentNote("cash 28/10", today, fmt)).toBe("cash 13 Nov");
    expect(nextPaymentNote("run 2026-10-28 xero", today, fmt)).toBe("run 2026-11-13 xero");
  });
  it("spots the locale's own month names", () => {
    expect(nextPaymentNote("bezahlt 28. Oktober Bank", today, fmt, "de")).toBe("bezahlt 13 Nov Bank");
  });
  it("appends today's date when the note had none, defaults when no history", () => {
    expect(nextPaymentNote("bank transfer", today, fmt)).toBe("bank transfer 13 Nov");
    expect(nextPaymentNote(null, today, fmt)).toBe("Paid 13 Nov");
    expect(nextPaymentNote("  ", today, fmt)).toBe("Paid 13 Nov");
  });
});

describe("periodDays", () => {
  it("lists every local day in [start, end)", () => {
    const start = new Date(2026, 10, 2);
    const end = new Date(2026, 10, 16);
    const days = periodDays(start, end);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-11-02");
    expect(days[13]).toBe("2026-11-15");
  });
});

describe("weeks", () => {
  it("finds the week start for Monday and Sunday weeks", () => {
    expect(weekStartDay(today, 1)).toBe("2026-11-09");
    expect(weekStartDay(today, 0)).toBe("2026-11-08");
    expect(weekStartDay(new Date(2026, 10, 9, 0, 5), 1)).toBe("2026-11-09");
  });
  it("groups newest week first", () => {
    const items = [new Date(2026, 10, 3), new Date(2026, 10, 12), new Date(2026, 10, 10)].map((d) => d.toISOString());
    const g = groupByWeek(items, (x) => x, 1);
    expect(g.map((w) => w.week)).toEqual(["2026-11-09", "2026-11-02"]);
    expect(g[0].rows).toHaveLength(2);
  });
});

describe("defaults", () => {
  it("picks the newest finished period", () => {
    const now = +new Date("2026-11-13T00:00:00Z");
    const ps = [
      { id: "cur", endAt: "2026-11-16T00:00:00Z" },
      { id: "last", endAt: "2026-11-02T00:00:00Z" },
      { id: "older", endAt: "2026-10-19T00:00:00Z" },
    ];
    expect(lastFinishedPeriod(ps, now)?.id).toBe("last");
    expect(lastFinishedPeriod([ps[0]], now)).toBeUndefined();
  });
  it("picks the person owed the most, else the first", () => {
    expect(mostOwed([{ id: "a", unpaidCents: 0 }, { id: "b", unpaidCents: 900 }, { id: "c", unpaidCents: 50 }])?.id).toBe("b");
    expect(mostOwed([{ id: "a", unpaidCents: 0 }, { id: "b", unpaidCents: 0 }])?.id).toBe("a");
    expect(mostOwed([])).toBeUndefined();
  });
  it("names compliance flags", () => {
    expect(flagLabel("missing_meal_break")).toBe("No meal break");
    expect(flagLabel("something_new")).toBe("Something new");
  });
});
