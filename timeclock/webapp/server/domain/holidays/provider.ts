/**
 * Public-holiday provider — the single lookup surface used by the payroll
 * pre-run for EVERY country.
 *
 * NZ is special and UNCHANGED: it routes through the tuned computed engine
 * (nzPublicHolidays / holidayOn — Matariki, Auckland Anniversary, Mondayisation)
 * and keeps its own Holidays Act stat-pay logic elsewhere. Every other country
 * goes through the `date-holidays` library using its ISO code (plus an optional
 * state/province/canton region).
 *
 * This module only answers "is this calendar date a PUBLIC holiday, and what is
 * it called?". It does NOT compute pay — the timesheet applies the configured
 * worked-holiday multiplier for non-NZ countries. This is a time clock + payroll
 * pre-run, not tax/payroll software.
 *
 * Design note on why we build on getHolidays(year), not isHoliday():
 *   date-holidays' isHoliday(dateString) resolves the string against a single
 *   local midnight, which is unreliable for multi-timezone countries (e.g.
 *   Canada Day returns `false` from isHoliday even though it is listed by
 *   getHolidays). getHolidays(year) returns the authoritative list with an
 *   explicit `type` and `substitute` flag, so we key those by calendar day and
 *   filter to public/bank types ourselves. That also lets us treat the
 *   library-provided substitute (observed) date as a holiday, exactly as
 *   required.
 */
import Holidays from "date-holidays";
import type { HolidaysTypes } from "date-holidays";
import { holidayOn, nzPublicHolidays } from "./nz-public-holidays";

export interface PublicHolidayHit {
  /** Calendar date of the (observed) holiday, YYYY-MM-DD. */
  date: string;
  /** Holiday name in the library's default language for that country. */
  name: string;
}

/** Types date-holidays uses that we treat as an actual day-off public holiday. */
const PUBLIC_TYPES: ReadonlySet<HolidaysTypes.HolidayType> = new Set(["public", "bank"]);

/**
 * date-holidays date strings look like "2026-07-04 00:00:00" (optionally with a
 * trailing offset). Slice to the leading YYYY-MM-DD calendar date.
 */
function toDateOnly(dateStr: string): string {
  return dateStr.slice(0, 10);
}

// One Holidays instance per country|region. Construction parses a rule set, so
// caching keeps repeated timesheet lookups cheap. Keyed on both so switching
// region does not return stale results.
const hdCache = new Map<string, Holidays | null>();

function getHd(country: string, region?: string): Holidays | null {
  const key = `${country}|${region ?? ""}`;
  if (hdCache.has(key)) return hdCache.get(key) ?? null;
  // A misconfigured country/region must never abort a whole timesheet. In the
  // normal path `country` is a validated enum and `region` is tolerated by the
  // library (bad regions fall back to country-level), but we still construct
  // defensively so an unexpected library throw degrades to "no holidays" for
  // this locale rather than throwing out of buildTimesheet. Cache the result
  // (including null) so a bad setting doesn't retry-and-throw every lookup.
  let hd: Holidays | null = null;
  try {
    hd = region ? new Holidays(country, region) : new Holidays(country);
  } catch {
    hd = null;
  }
  hdCache.set(key, hd);
  return hd;
}

/**
 * All PUBLIC (and bank) holidays for a year in a country/region, deduped per
 * calendar day (keeping the first name the library lists for that day). NZ uses
 * the computed engine. Returned sorted by date. A bad/unsupported country or
 * region yields an empty list, never a throw.
 */
export function publicHolidays(year: number, country: string, region?: string): PublicHolidayHit[] {
  if (country === "NZ") {
    // Computed NZ engine: `date` is already the observed (Mondayised) date.
    return nzPublicHolidays(year).map((h) => ({ date: h.date, name: h.name }));
  }

  const hd = getHd(country, region);
  if (!hd) return [];
  const byDay = new Map<string, string>();
  // getHolidays can return `false` if the instance failed to initialise, and
  // rule parsing could in principle throw — guard both so a single locale never
  // takes down the payroll pre-run.
  let list: HolidaysTypes.Holiday[];
  try {
    list = (hd.getHolidays(year) || []) as HolidaysTypes.Holiday[];
  } catch {
    return [];
  }
  for (const h of list) {
    if (!PUBLIC_TYPES.has(h.type)) continue;
    const day = toDateOnly(h.date);
    // Both the actual date and any library-provided substitute (observed) date
    // are public holidays; keep the first name seen for a given calendar day.
    if (!byDay.has(day)) byDay.set(day, h.name);
  }
  return [...byDay.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Is `dateISO` (YYYY-MM-DD, already in the app timezone) a public holiday in the
 * given country/region? Returns the hit or null. NZ uses the computed engine.
 */
export function publicHolidayOn(
  dateISO: string,
  country: string,
  region?: string,
): PublicHolidayHit | null {
  if (country === "NZ") {
    const h = holidayOn(dateISO);
    return h ? { date: h.date, name: h.name } : null;
  }
  const year = Number(dateISO.slice(0, 4));
  return publicHolidays(year, country, region).find((h) => h.date === dateISO) ?? null;
}
