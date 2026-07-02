"use client";

/**
 * Dependency-free i18n runtime.
 *
 * - `en.ts` is the source of truth: `MessageKey` is derived from it and every
 *   other catalog is `Partial<typeof en>`.
 * - `translate()` is pure and does the three-tier fallback demanded by the
 *   spec: active-locale value → English value → the key itself. A missing
 *   translation degrades to English (or, worst case, the raw key) but NEVER
 *   blanks the UI.
 * - Interpolation replaces `{var}` occurrences from an optional `vars` map.
 * - `I18nProvider` reads the active language from GET /api/locale (via the same
 *   ["locale"] query `useLocale` uses, so a settings change that invalidates
 *   ["locale"] re-renders translations too), mirrors it onto
 *   `document.documentElement.lang`, and exposes it through context. `useT()`
 *   returns a `t(key, vars?)` bound to that language.
 *
 * No i18n library — just a lookup table and string replace.
 */

import * as React from "react";
import en from "./en";
import de from "./de";
import fr from "./fr";
import sv from "./sv";
import da from "./da";
import { useLocale } from "@/lib/format";

/** Every valid message key (keys of the frozen English catalog). */
export type MessageKey = keyof typeof en;

/** Supported UI languages. Mirrors settings.locale.language. */
export type Lang = "en" | "de" | "fr" | "sv" | "da";

/** Values passed into `{var}` placeholders. */
export type TVars = Record<string, string | number>;

/**
 * All catalogs. `en` is complete; the rest are Partial and fall back to `en`
 * per key inside `translate()`.
 */
/** A locale catalog: any subset of the message keys, values widened to string. */
export type Messages = Partial<Record<MessageKey, string>>;

export const LOCALES: Record<Lang, Messages> = {
  en,
  de,
  fr,
  sv,
  da,
};

/** Narrow an arbitrary settings value to a supported Lang (default "en"). */
export function asLang(value: string | null | undefined): Lang {
  return value != null && value in LOCALES ? (value as Lang) : "en";
}

/**
 * Pure translation: active-locale → English → key, then `{var}` interpolation.
 * Usable outside React (tests, server) since it takes the language explicitly.
 */
export function translate(lang: Lang, key: MessageKey, vars?: TVars): string {
  const template = LOCALES[lang]?.[key] ?? en[key] ?? key;
  let out: string = template;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.split(`{${k}}`).join(String(v));
    }
  }
  return out;
}

const I18nContext = React.createContext<Lang>("en");

/**
 * Provides the active UI language to the tree and keeps
 * `document.documentElement.lang` in sync. Must live inside the
 * QueryClientProvider so `useLocale` (which reads GET /api/locale) works.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { language } = useLocale();
  const lang = asLang(language);

  React.useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  return <I18nContext.Provider value={lang}>{children}</I18nContext.Provider>;
}

/** The active UI language from context (fallback "en" outside a provider). */
export function useLang(): Lang {
  return React.useContext(I18nContext);
}

/**
 * Returns a `t(key, vars?)` bound to the active language. The returned function
 * is memoized on the language so it is stable across renders.
 */
export function useT(): (key: MessageKey, vars?: TVars) => string {
  const lang = useLang();
  return React.useCallback(
    (key: MessageKey, vars?: TVars) => translate(lang, key, vars),
    [lang],
  );
}
