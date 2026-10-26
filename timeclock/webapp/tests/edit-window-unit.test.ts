import { describe, it, expect } from "vitest";
import { isSelfEditable } from "@/server/domain/time/edit-window";

// Facility TZ defaults to Pacific/Auckland (NZDT = UTC+13 in late October).
const nz = (iso: string) => new Date(`${iso}+13:00`);

describe("self-edit window (shift day + the day after, facility TZ)", () => {
  const now = nz("2026-10-26T09:00:00"); // Monday morning

  it("open for today's and yesterday's shifts", () => {
    expect(isSelfEditable(nz("2026-10-26T08:00:00"), now)).toBe(true);
    expect(isSelfEditable(nz("2026-10-25T00:01:00"), now)).toBe(true);
  });

  it("locked for anything clocked in two or more days ago", () => {
    expect(isSelfEditable(nz("2026-10-24T23:59:00"), now)).toBe(false);
    expect(isSelfEditable(nz("2026-10-20T09:00:00"), now)).toBe(false);
  });

  it("closes at local midnight, not 48h after the punch", () => {
    const sundayShift = nz("2026-10-25T09:00:00");
    expect(isSelfEditable(sundayShift, nz("2026-10-26T23:59:00"))).toBe(true);
    expect(isSelfEditable(sundayShift, nz("2026-10-27T00:00:30"))).toBe(false);
  });

  it("uses local days across the DST change (NZ springs forward 2026-09-27)", () => {
    const sat = new Date("2026-09-26T09:00:00+12:00");
    expect(isSelfEditable(sat, new Date("2026-09-27T23:30:00+13:00"))).toBe(true);
    expect(isSelfEditable(sat, new Date("2026-09-28T00:10:00+13:00"))).toBe(false);
  });
});
