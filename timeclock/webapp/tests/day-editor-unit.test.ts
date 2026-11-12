import { describe, expect, it } from "vitest";
import { suggestMissingDay, typicalFrom, localDay, type EntryRow } from "@/components/entries/edit-entry-dialog";
import { hourBuckets } from "@/components/entries/month-calendar";

const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString();
const row = (day: string, a: string, b: string | null, breaks: EntryRow["breaks"] = []): EntryRow => ({
  id: `${day}-${a}`,
  day,
  dayApproved: false,
  clockIn: at(day, a),
  clockOut: b ? at(day, b) : null,
  edited: false,
  note: null,
  job: null,
  workedMinutes: null,
  selfEditable: true,
  fraudFlags: [],
  paidAt: null,
  breaks,
});

describe("typicalFrom", () => {
  it("uses the median first start and last finish per day", () => {
    const t = typicalFrom([
      row("2026-11-09", "07:00", "11:00"),
      row("2026-11-09", "12:00", "15:30"),
      row("2026-11-10", "07:30", "15:30"),
      row("2026-11-11", "09:00", "17:00"),
    ]);
    expect(t.start).toBe("07:30");
    expect(t.end).toBe("15:30");
    expect(t.weekdays.sort()).toEqual([1, 2, 3]);
  });
  it("falls back to a normal day with no history", () => {
    expect(typicalFrom([])).toMatchObject({ start: "08:00", end: "16:30" });
  });
});

describe("suggestMissingDay", () => {
  it("skips days already recorded and non-work weekdays", () => {
    const today = new Date();
    const all = [0, 1, 2, 3, 4, 5, 6];
    expect(suggestMissingDay([], { start: "00:00", end: "16:00", weekdays: all })).toBe(localDay(today));
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    expect(
      suggestMissingDay([row(localDay(today), "08:00", "09:00")], { start: "00:00", end: "16:00", weekdays: all }),
    ).toBe(localDay(yest));
    // Before their usual start, today isn't "missed" yet.
    expect(suggestMissingDay([], { start: "23:59", end: "23:59", weekdays: all })).toBe(
      new Date().getHours() * 60 + new Date().getMinutes() < 23 * 60 + 59 ? localDay(yest) : localDay(today),
    );
  });
});

describe("hourBuckets", () => {
  it("splits work and break minutes per hour", () => {
    const d = "2026-11-09";
    const { work, brk } = hourBuckets(d, [
      row(d, "09:30", "12:00", [{ id: "b", startAt: at(d, "10:00"), endAt: at(d, "10:30"), paid: false, autoDeducted: false }]),
    ]);
    expect(work[8]).toBe(0);
    expect(work[9]).toBe(30);
    expect(work[10]).toBe(30);
    expect(brk[10]).toBe(30);
    expect(work[11]).toBe(60);
    expect(work[12]).toBe(0);
  });
});
