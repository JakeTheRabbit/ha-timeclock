"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api-client";

/**
 * Locale-aware DISPLAY formatting. These are purely for what a human reads —
 * punch times, dates, hour totals, currency amounts. Server-side calendar/date
 * math (nzDateOf, lib/tz.ts) is deliberately NOT routed through here: it must
 * stay locale-proof and timezone-anchored regardless of the display locale.
 *
 * Every helper takes the active BCP-47 tag explicitly, so it is usable outside
 * React too. Currency is DISPLAY ONLY — this is a time clock, not tax/payroll
 * software. Bad locale/currency inputs are tolerated (Intl throws → we fall
 * back to the plain string) so a mistyped setting never blanks a page.
 */

/** Sensible defaults when the locale hasn't loaded (or the API is down). */
export const FALLBACK_LOCALE = "en-NZ";
export const FALLBACK_CURRENCY = "NZD";

/** Shape returned by GET /api/locale (public read of settings.locale). */
export interface LocaleInfo {
  language: string;
  bcp47: string;
  currency: string;
  weekStart: 0 | 1;
}

const DEFAULT_LOCALE_INFO: LocaleInfo = {
  language: "en",
  bcp47: FALLBACK_LOCALE,
  currency: FALLBACK_CURRENCY,
  weekStart: 1,
};

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Coerce anything date-ish (ISO string / epoch ms / Date) to a Date. */
function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Format an instant as a date, e.g. "Wed, 2 Jul". */
export function formatDate(
  value: string | number | Date,
  locale: string = FALLBACK_LOCALE,
  options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
): string {
  const d = toDate(value);
  return safe(() => d.toLocaleDateString(locale, options), d.toLocaleDateString());
}

/** Format an instant as a time, e.g. "9:05 AM" / "09:05". */
export function formatTime(
  value: string | number | Date,
  locale: string = FALLBACK_LOCALE,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  const d = toDate(value);
  return safe(() => d.toLocaleTimeString(locale, options), d.toLocaleTimeString());
}

/** Format an instant as a full date + time (for logs, lock stamps, etc.). */
export function formatDateTime(
  value: string | number | Date,
  locale: string = FALLBACK_LOCALE,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = toDate(value);
  return safe(
    () => (options ? d.toLocaleString(locale, options) : d.toLocaleString(locale)),
    d.toLocaleString(),
  );
}

/** Format a plain number in the active locale (grouping/decimals). */
export function formatNumber(
  value: number,
  locale: string = FALLBACK_LOCALE,
  options?: Intl.NumberFormatOptions,
): string {
  return safe(() => new Intl.NumberFormat(locale, options).format(value), String(value));
}

/**
 * Format a currency amount for DISPLAY. Not used for any tax/withholding math —
 * this app never computes those. Falls back to a plain number if the currency
 * code or locale is invalid.
 */
export function formatCurrency(
  value: number,
  currency: string = FALLBACK_CURRENCY,
  locale: string = FALLBACK_LOCALE,
  options: Intl.NumberFormatOptions = {},
): string {
  return safe(
    () => new Intl.NumberFormat(locale, { style: "currency", currency, ...options }).format(value),
    String(value),
  );
}

/**
 * Localised weekday name. `day` is 0=Sun..6=Sat (JS getDay convention). Uses a
 * fixed reference week so it never depends on the current date.
 */
export function formatWeekday(
  day: number,
  locale: string = FALLBACK_LOCALE,
  format: "long" | "short" | "narrow" = "short",
): string {
  // 2024-01-07 is a Sunday (UTC); add `day` days to land on the target weekday.
  const ref = new Date(Date.UTC(2024, 0, 7 + (((day % 7) + 7) % 7)));
  return safe(
    () => ref.toLocaleDateString(locale, { weekday: format, timeZone: "UTC" }),
    ref.toLocaleDateString(undefined, { weekday: format, timeZone: "UTC" }),
  );
}

/**
 * Client hook exposing the site display locale from the public GET /api/locale
 * endpoint. While loading (or if the request fails) it returns the en-NZ / NZD
 * fallback so callers can format immediately without a loading branch.
 *
 * Also returns bound convenience formatters that already carry the active
 * locale/currency, so pages can call `date(iso)` / `money(n)` directly.
 */
export function useLocale() {
  const query = useQuery({
    queryKey: ["locale"],
    queryFn: () => apiGet<LocaleInfo>("/locale"),
    staleTime: 5 * 60_000,
  });

  const info = query.data ?? DEFAULT_LOCALE_INFO;
  const { bcp47, currency } = info;

  return {
    ...info,
    /** True until the real locale has loaded (fallback in use meanwhile). */
    isLoading: query.isLoading,
    // Bound formatters carrying the active locale/currency.
    date: (v: string | number | Date, o?: Intl.DateTimeFormatOptions) => formatDate(v, bcp47, o),
    time: (v: string | number | Date, o?: Intl.DateTimeFormatOptions) => formatTime(v, bcp47, o),
    dateTime: (v: string | number | Date, o?: Intl.DateTimeFormatOptions) => formatDateTime(v, bcp47, o),
    number: (v: number, o?: Intl.NumberFormatOptions) => formatNumber(v, bcp47, o),
    money: (v: number, o?: Intl.NumberFormatOptions) => formatCurrency(v, currency, bcp47, o),
    weekday: (day: number, f?: "long" | "short" | "narrow") => formatWeekday(day, bcp47, f),
  };
}
