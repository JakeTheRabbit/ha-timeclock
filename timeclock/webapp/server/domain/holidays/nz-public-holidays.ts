/**
 * NZ public holidays, computed (no API). Dates are calendar dates in
 * Pacific/Auckland. Includes Auckland Anniversary (facility is in Auckland).
 *
 * Mondayisation (Holidays Act s45A/B): Christmas, Boxing, New Year's Day,
 * Jan 2, Waitangi, and ANZAC transfer to the following Mon (or Tue) when they
 * fall on a weekend.
 */
export interface PublicHoliday {
  date: string; // YYYY-MM-DD (observed date)
  actualDate: string; // the calendar date of the holiday itself
  name: string;
  mondayised: boolean;
}

// Official Matariki dates (set by legislation, not computable).
const MATARIKI: Record<number, string> = {
  2024: "2024-06-28",
  2025: "2025-06-20",
  2026: "2026-07-10",
  2027: "2027-06-25",
  2028: "2028-07-14",
  2029: "2029-07-06",
  2030: "2030-06-21",
  2031: "2031-07-11",
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Day of week for a calendar date (0=Sun..6=Sat), timezone-independent. */
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(y: number, m: number, d: number, n: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

/** Anonymous Gregorian computus (Meeus/Jones/Butcher) -> Easter Sunday. */
export function easterSunday(year: number): [number, number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [year, month, day];
}

/** Mondayise: weekend -> following Monday; if that Monday is taken (Jan 2 /
 * Boxing Day chains), the caller passes bump=1 to land on Tuesday. */
function mondayise(y: number, m: number, d: number, bump = 0): { obs: string; moved: boolean } {
  const w = dow(y, m, d);
  if (w === 6) {
    const [yy, mm, dd] = addDays(y, m, d, 2 + bump);
    return { obs: iso(yy, mm, dd), moved: true };
  }
  if (w === 0) {
    const [yy, mm, dd] = addDays(y, m, d, 1 + bump);
    return { obs: iso(yy, mm, dd), moved: true };
  }
  return { obs: iso(y, m, d), moved: false };
}

/** Nth weekday of a month, e.g. 1st Monday of June. */
function nthWeekday(y: number, m: number, weekday: number, n: number): [number, number, number] {
  const first = dow(y, m, 1);
  const offset = (weekday - first + 7) % 7;
  return [y, m, 1 + offset + (n - 1) * 7];
}

/** Monday closest to a date (Auckland Anniversary rule: closest Mon to Jan 29). */
function closestMonday(y: number, m: number, d: number): [number, number, number] {
  const w = dow(y, m, d);
  // distance to Monday (1): forward and backward
  const fwd = (1 - w + 7) % 7;
  const back = (w - 1 + 7) % 7;
  return addDays(y, m, d, fwd <= back ? fwd : -back);
}

export function nzPublicHolidays(year: number): PublicHoliday[] {
  const out: PublicHoliday[] = [];
  const push = (
    name: string,
    actual: [number, number, number],
    opts: { mondayiseIt?: boolean; bump?: number } = {},
  ) => {
    const [y, m, d] = actual;
    if (opts.mondayiseIt) {
      const { obs, moved } = mondayise(y, m, d, opts.bump ?? 0);
      out.push({ date: obs, actualDate: iso(y, m, d), name, mondayised: moved });
    } else {
      out.push({ date: iso(y, m, d), actualDate: iso(y, m, d), name, mondayised: false });
    }
  };

  // Jan 1 + Jan 2 mondayise as a pair: if both fall on the weekend, Jan 2's
  // observed day must skip Jan 1's observed Monday.
  const jan1W = dow(year, 1, 1);
  push("New Year's Day", [year, 1, 1], { mondayiseIt: true });
  push("Day after New Year's Day", [year, 1, 2], { mondayiseIt: true, bump: jan1W === 6 || jan1W === 0 ? 1 : 0 });

  push("Auckland Anniversary", closestMonday(year, 1, 29));
  push("Waitangi Day", [year, 2, 6], { mondayiseIt: true });

  const [ey, em, ed] = easterSunday(year);
  push("Good Friday", addDays(ey, em, ed, -2));
  push("Easter Monday", addDays(ey, em, ed, 1));

  push("ANZAC Day", [year, 4, 25], { mondayiseIt: true });
  push("King's Birthday", nthWeekday(year, 6, 1, 1));
  if (MATARIKI[year]) {
    const [y, m, d] = MATARIKI[year].split("-").map(Number);
    push("Matariki", [y, m, d]);
  }
  push("Labour Day", nthWeekday(year, 10, 1, 4));

  // Christmas / Boxing mondayise as a pair like Jan 1/2.
  const dec25W = dow(year, 12, 25);
  push("Christmas Day", [year, 12, 25], { mondayiseIt: true });
  push("Boxing Day", [year, 12, 26], { mondayiseIt: true, bump: dec25W === 6 || dec25W === 0 ? 1 : 0 });

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Is a Pacific/Auckland calendar date (YYYY-MM-DD) an observed public holiday? */
export function holidayOn(dateISO: string): PublicHoliday | null {
  const year = Number(dateISO.slice(0, 4));
  // Observed dates can spill into the next year only within the same year in NZ
  // (Jan 1 weekend -> Jan 3 Mon of the same year), so one-year lookup suffices.
  return nzPublicHolidays(year).find((h) => h.date === dateISO) ?? null;
}
