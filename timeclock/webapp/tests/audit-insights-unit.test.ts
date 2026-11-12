import { describe, it, expect } from "vitest";
import { actionLabel, diffFields, entityLabel, flatten, formatValue, humanise } from "@/lib/audit";
import { delta, filterSlice, weekStartOf, type Slice } from "@/lib/insights";
import { monthGrid } from "@/components/insights/calendar";

const fmt = { dateTime: (v: string) => `DT(${v})`, money: (n: number) => `$${n.toFixed(2)}` };

describe("audit viewer helpers", () => {
  it("humanises keys, entity types and actions", () => {
    expect(humanise("clockIn")).toBe("Clock in");
    expect(humanise("unpaid_break_minutes")).toBe("Unpaid break minutes");
    expect(humanise("requested.clockOut")).toBe("Requested › clock out");
    expect(entityLabel("time_entry")).toBe("Time entry");
    expect(entityLabel("something_new")).toBe("Something new");
    expect(actionLabel("manager_edit_break_add")).toBe("Manager edit break add");
  });

  it("diffs only changed fields when both sides exist", () => {
    const d = diffFields(
      JSON.stringify({ clockIn: "2026-11-01T20:00:00Z", clockOut: "2026-11-02T04:00:00Z", edited: false }),
      JSON.stringify({ clockIn: "2026-11-01T20:00:00Z", clockOut: "2026-11-02T05:00:00Z", edited: true }),
    );
    expect(d).toEqual([
      { field: "clockOut", before: "2026-11-02T04:00:00Z", after: "2026-11-02T05:00:00Z" },
      { field: "edited", before: false, after: true },
    ]);
  });

  it("lists every field on a create / delete, flattens nesting, tolerates non-JSON", () => {
    expect(diffFields(null, JSON.stringify({ a: 1, b: { c: 2 } }))).toEqual([
      { field: "a", before: undefined, after: 1 },
      { field: "b.c", before: undefined, after: 2 },
    ]);
    expect(diffFields("plain text", null)).toEqual([{ field: "value", before: "plain text", after: undefined }]);
    expect(diffFields(null, null)).toEqual([]);
    expect(flatten({ x: [1, 2], y: {} })).toEqual({ x: [1, 2], y: {} });
  });

  it("formats values by type and field name", () => {
    expect(formatValue(null, "x", fmt)).toBe("—");
    expect(formatValue(true, "edited", fmt)).toBe("Yes");
    expect(formatValue(12345, "paidAmountCents", fmt)).toBe("$123.45");
    expect(formatValue(30, "breakMin", fmt)).toBe("30 min");
    expect(formatValue("2026-11-02T05:00:00Z", "clockOut", fmt)).toBe("DT(2026-11-02T05:00:00Z)");
    expect(formatValue(["a", "b"], "flags", fmt)).toBe("a, b");
  });
});

describe("insights comparisons + filters", () => {
  it("delta vs previous period", () => {
    expect(delta(120, 100)).toEqual({ pct: 20, dir: "up" });
    expect(delta(75, 100)).toEqual({ pct: 25, dir: "down" });
    expect(delta(100, 100)).toEqual({ pct: 0, dir: "flat" });
    expect(delta(5, 0)).toBeNull();
    expect(delta(null, 10)).toBeNull();
  });

  it("filterSlice keeps one person's entries, rosters and activity", () => {
    const s: Slice = {
      withPay: false,
      employees: [],
      entries: [
        { id: "1", employeeId: "a", clockIn: "", clockOut: null, workedMinutes: 1, paidBreakMinutes: 0, unpaidBreakMinutes: 0, edited: false, fraudFlags: [], paid: false },
        { id: "2", employeeId: "b", clockIn: "", clockOut: null, workedMinutes: 1, paidBreakMinutes: 0, unpaidBreakMinutes: 0, edited: false, fraudFlags: [], paid: false },
      ],
      rosters: [{ employeeId: "b", shiftDate: "2026-11-02", startMin: 0, endMin: 60 }],
      activity: [
        { at: "", action: "clock_in", entityType: "time_entry", actor: "A", actorId: "a", subject: null, reason: null },
        { at: "", action: "manager_edit", entityType: "time_entry", actor: "M", actorId: "m", subject: "B", subjectId: "b", reason: null },
      ],
    };
    const b = filterSlice(s, "b");
    expect(b.entries.map((e) => e.id)).toEqual(["2"]);
    expect(b.rosters).toHaveLength(1);
    expect(b.activity.map((a) => a.action)).toEqual(["manager_edit"]);
    expect(filterSlice(s, null)).toBe(s);
  });

  it("week start respects the site setting", () => {
    // 2026-11-13 is a Friday
    expect(weekStartOf("2026-11-13", 1)).toBe("2026-11-09");
    expect(weekStartOf("2026-11-13", 0)).toBe("2026-11-08");
    expect(weekStartOf("2026-11-08", 0)).toBe("2026-11-08");
    // November 2026 starts on a Sunday
    expect(monthGrid("2026-11", 1)[0]).toBe("2026-10-26");
    expect(monthGrid("2026-11", 0)[0]).toBe("2026-11-01");
  });
});
