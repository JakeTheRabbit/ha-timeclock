import type { OvertimeRules } from "@/server/domain/overtime/engine";
import type { Settings } from "@/server/domain/settings";

/**
 * Country presets for locale-aware formatting, timezone, week start, holidays,
 * and DEFAULT overtime rules. These are documented starting points an admin can
 * edit — NOT legal advice. Overtime law varies by state/province/award/contract;
 * the caveats in each `note` say where the single-tier engine falls short.
 *
 * This module is pure data + a pure function. No DB, no I/O.
 *
 * NZ is special: its holidays use the tuned computed engine (Matariki, Auckland
 * Anniversary, Mondayisation) rather than date-holidays, and it keeps its own
 * Holidays Act stat-pay logic. Every other country routes holidays through
 * date-holidays using its ISO code and does NOT get the NZ stat-pay engine.
 */

export type CountryCode = "NZ" | "US" | "GB" | "IE" | "CA" | "AU" | "DE" | "FR" | "CH" | "SE" | "DK";

export interface CountryPreset {
  /** ISO-3166 alpha-2 code (matches settings.locale.country). */
  code: CountryCode;
  /** Human-readable country name. */
  name: string;
  /** BCP-47 locale tag for Intl formatting. */
  bcp47: string;
  /** ISO 4217 currency code (display only). */
  currency: string;
  /** First day of the week: 0=Sun, 1=Mon. */
  weekStart: 0 | 1;
  /** IANA timezone (default; the add-on TZ config option can still override). */
  timezone: string;
  /**
   * Holiday source: an ISO code passed to date-holidays, or the "NZ" sentinel
   * meaning "use the computed NZ engine, not date-holidays".
   */
  holidayCountry: string;
  /**
   * DEFAULT overtime rules for this country. Partial — only the fields that
   * differ from the engine's own defaults are set; a caller deep-merges these
   * onto the existing overtime settings. An empty object means "no statutory
   * premium by default" (leave the current engine settings as-is).
   */
  overtime: Partial<OvertimeRules>;
  /**
   * Worked-public-holiday pay premium for NON-NZ countries. 1 = no premium.
   * (NZ ignores this and uses its own stat-pay logic.)
   */
  holidayPayMultiplier: number;
  /** Honest caveat about the overtime/holiday defaults for this country. */
  note: string;
}

// Engine defaults reused below so "8h daily / 40h weekly" presets are explicit.
const MIN = 60;

export const COUNTRIES: Record<CountryCode, CountryPreset> = {
  NZ: {
    code: "NZ",
    name: "New Zealand",
    bcp47: "en-NZ",
    currency: "NZD",
    weekStart: 1,
    timezone: "Pacific/Auckland",
    holidayCountry: "NZ", // sentinel: computed NZ engine, not date-holidays
    // UNCHANGED from the existing NZ defaults: daily >8h @1.5x + weekly >40h.
    overtime: {
      dailyThresholdMin: 8 * MIN,
      weeklyThresholdMin: 40 * MIN,
      multiplier1: 1.5,
      multiplier2: 2.0,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1, // NZ uses its own Holidays Act stat-pay logic instead
    note: "New Zealand: daily overtime over 8h and weekly over 40h are common contractual defaults, not a universal statutory rule. Public holidays use the built-in NZ engine (Matariki, Auckland Anniversary, Mondayisation) and worked public holidays are paid via the NZ Holidays Act stat-pay logic (time-and-a-half plus a possible alternative holiday), so holidayPayMultiplier does not apply.",
  },
  US: {
    code: "US",
    name: "United States",
    bcp47: "en-US",
    currency: "USD",
    weekStart: 0,
    timezone: "America/New_York",
    holidayCountry: "US",
    // FLSA: weekly over 40h @1.5x, NO federal daily overtime.
    overtime: {
      dailyThresholdMin: 24 * MIN, // effectively off (no daily OT under FLSA)
      weeklyThresholdMin: 40 * MIN,
      multiplier1: 1.5,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "United States: FLSA requires overtime for hours over 40 in a week at 1.5x, with no federal daily overtime. Some states (e.g. California) have daily overtime rules that are NOT applied automatically here — set them per state via holidayRegion and the overtime settings. US public holidays are not paid at a statutory premium by default.",
  },
  GB: {
    code: "GB",
    name: "United Kingdom",
    bcp47: "en-GB",
    currency: "GBP",
    weekStart: 1,
    timezone: "Europe/London",
    holidayCountry: "GB",
    // No statutory overtime premium: OT effectively off (multipliers = 1.0).
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 168 * MIN, // a full week: never triggers
      multiplier1: 1.0,
      multiplier2: 1.0,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "United Kingdom: there is no statutory overtime premium — overtime pay, if any, is set by contract. This preset leaves overtime effectively off. Bank holidays are informational; there is no statutory premium for working them.",
  },
  IE: {
    code: "IE",
    name: "Ireland",
    bcp47: "en-IE",
    currency: "EUR",
    weekStart: 1,
    timezone: "Europe/Dublin",
    holidayCountry: "IE",
    // No statutory overtime premium.
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 168 * MIN,
      multiplier1: 1.0,
      multiplier2: 1.0,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "Ireland: no statutory overtime premium — overtime is a matter of contract. This preset leaves overtime effectively off. Public holiday entitlements exist under the Organisation of Working Time Act but are not modelled as a simple worked-day multiplier here.",
  },
  CA: {
    code: "CA",
    name: "Canada",
    bcp47: "en-CA",
    currency: "CAD",
    weekStart: 0,
    timezone: "America/Toronto",
    holidayCountry: "CA",
    // Default weekly >44h @1.5x (varies by province).
    overtime: {
      dailyThresholdMin: 24 * MIN, // no daily OT by default
      weeklyThresholdMin: 44 * MIN,
      multiplier1: 1.5,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "Canada: the default here is weekly overtime over 44h at 1.5x, but the threshold and any daily overtime vary significantly by province and territory. Select the province via holidayRegion and adjust the overtime settings to match. Statutory holiday pay rules also vary by province and are not applied as a flat multiplier by default.",
  },
  AU: {
    code: "AU",
    name: "Australia",
    bcp47: "en-AU",
    currency: "AUD",
    weekStart: 1,
    timezone: "Australia/Sydney",
    holidayCountry: "AU",
    // Award-based; default 38h standard week, NO auto premium.
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 38 * MIN, // standard week; premium NOT auto-applied
      multiplier1: 1.0,
      multiplier2: 1.0,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "Australia: overtime and penalty rates are set by modern awards and enterprise agreements, not a single national rule. The standard full-time week is 38h, but this preset does NOT auto-apply any overtime premium because rates depend on the applicable award. Set multipliers and thresholds to match your award. Public holidays vary by state (holidayRegion).",
  },
  DE: {
    code: "DE",
    name: "Germany",
    bcp47: "de-DE",
    currency: "EUR",
    weekStart: 1,
    timezone: "Europe/Berlin",
    holidayCountry: "DE",
    // No statutory overtime premium (contractual).
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 168 * MIN,
      multiplier1: 1.0,
      multiplier2: 1.0,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "Germany: there is no statutory overtime premium — any premium is contractual or by collective agreement. This preset leaves overtime effectively off. Public holidays vary by Bundesland; set the state via holidayRegion.",
  },
  FR: {
    code: "FR",
    name: "France",
    bcp47: "fr-FR",
    currency: "EUR",
    weekStart: 1,
    timezone: "Europe/Paris",
    holidayCountry: "FR",
    // Statutory 35h week; hours over 35 at 1.25x (first tier only here).
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 35 * MIN,
      multiplier1: 1.25,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "France: the legal working week is 35h; hours beyond that are typically paid at 1.25x for the first 8 overtime hours and 1.50x thereafter. This single-tier engine only models the 1.25x tier — the higher 50% tier for hours beyond 43h/week must be handled manually. Public holiday pay is largely governed by collective agreement.",
  },
  CH: {
    code: "CH",
    name: "Switzerland",
    bcp47: "de-CH",
    currency: "CHF",
    weekStart: 1,
    timezone: "Europe/Zurich",
    holidayCountry: "CH",
    // Arbeitsgesetz: weekly over 45h @1.25x.
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 45 * MIN,
      multiplier1: 1.25,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "Switzerland: under the Arbeitsgesetz (Labour Act), work beyond the statutory weekly maximum (commonly 45h) is paid at a 25% surcharge, though the maximum is 50h for some sectors and surcharges can be waived by agreement. This preset defaults to weekly over 45h at 1.25x. Public holidays vary by canton; set it via holidayRegion.",
  },
  SE: {
    code: "SE",
    name: "Sweden",
    bcp47: "sv-SE",
    currency: "SEK",
    weekStart: 1,
    timezone: "Europe/Stockholm",
    holidayCountry: "SE",
    // Collective-agreement based; default off.
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 168 * MIN,
      multiplier1: 1.0,
      multiplier2: 1.0,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "Sweden: overtime compensation is set by collective agreements (kollektivavtal), not a single statutory rate. This preset leaves overtime off by default — configure it to match the applicable agreement. Public holiday pay is likewise governed by agreement.",
  },
  DK: {
    code: "DK",
    name: "Denmark",
    bcp47: "da-DK",
    currency: "DKK",
    weekStart: 1,
    timezone: "Europe/Copenhagen",
    holidayCountry: "DK",
    // Collective-agreement based; default off.
    overtime: {
      dailyThresholdMin: 24 * MIN,
      weeklyThresholdMin: 168 * MIN,
      multiplier1: 1.0,
      multiplier2: 1.0,
      daily2ThresholdMin: null,
    },
    holidayPayMultiplier: 1,
    note: "Denmark: there is little statutory regulation of overtime — pay and rates come from collective agreements (overenskomster). This preset leaves overtime off by default; configure it to match the applicable agreement. Public holiday pay is governed by agreement.",
  },
};

/**
 * A settings patch whose top-level blocks may themselves be partial — exactly
 * what the deep-merge in updateSettings expects. Both nested blocks are
 * optional and each field within them is optional, so we never assert values
 * we don't actually set (e.g. the US overtime block omits multiplier2).
 */
export interface CountryPresetPatch {
  locale?: Partial<Settings["locale"]>;
  overtime?: Partial<Settings["overtime"]>;
}

/**
 * Build a partial Settings patch that sets the locale.* fields and overtime.*
 * defaults for a country. Intended to be deep-merged into existing settings by
 * the caller (e.g. via updateSettings), so unspecified fields are preserved.
 *
 * NOTE ON NZ: for NZ the returned overtime block matches the current defaults,
 * so deep-merging it does NOT change NZ's overtime behaviour.
 *
 * The `language` field is intentionally NOT set here: switching country must not
 * silently change the UI language (the later i18n task owns that choice).
 *
 * Pure function: no DB, no side effects.
 */
export function applyCountryPreset(country: CountryCode): CountryPresetPatch {
  const c = COUNTRIES[country];
  return {
    locale: {
      country: c.code,
      bcp47: c.bcp47,
      currency: c.currency,
      weekStart: c.weekStart,
      holidayRegion: "",
      holidayPayMultiplier: c.holidayPayMultiplier,
    },
    overtime: c.overtime,
  };
}
