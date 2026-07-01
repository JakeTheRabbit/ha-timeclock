import { holidayOn } from "./nz-public-holidays";
import { APP_TZ } from "@/lib/tz";

/** Pacific/Auckland calendar date (YYYY-MM-DD) for an instant. */
export function nzDateOf(at: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return p; // en-CA formats as YYYY-MM-DD
}

export interface StatDayAssessment {
  isPublicHoliday: boolean;
  holidayName: string | null;
  /** Worked minutes paid at time-and-a-half (Holidays Act s50). */
  timeAndAHalfMin: number;
  /**
   * Alternative holiday (day in lieu) earned — only when the day was an
   * "otherwise working day" for the employee (s56). We approximate OWD as:
   * the employee had a roster for that weekday OR worked ≥3 of the last 4
   * same-weekdays; callers pass the precomputed boolean.
   */
  altHolidayEarned: boolean;
}

export function assessStatDay(input: {
  clockIn: Date;
  workedMin: number;
  otherwiseWorkingDay: boolean;
}): StatDayAssessment {
  const day = nzDateOf(input.clockIn);
  const holiday = holidayOn(day);
  if (!holiday || input.workedMin <= 0) {
    return {
      isPublicHoliday: !!holiday,
      holidayName: holiday?.name ?? null,
      timeAndAHalfMin: 0,
      altHolidayEarned: false,
    };
  }
  return {
    isPublicHoliday: true,
    holidayName: holiday.name,
    timeAndAHalfMin: input.workedMin,
    altHolidayEarned: input.otherwiseWorkingDay,
  };
}
