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
import { useLocale } from "@/lib/format";
import { LOCALES, asLang, translate, type Lang, type MessageKey, type TVars } from "./translate";

// The pure core lives in ./translate (server code imports it from there).
export { LOCALES, asLang, translate };
export type { Lang, MessageKey, TVars, Messages } from "./translate";

const I18nContext = React.createContext<Lang>("en");

// Per-device language override (Profile page), like the theme: localStorage,
// null = follow the site setting.
const LANG_KEY = "tc-lang";
const langListeners = new Set<() => void>();

export function getLangOverride(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v != null && v in LOCALES ? (v as Lang) : null;
  } catch {
    return null; // SSR / storage blocked
  }
}

export function setLangOverride(lang: Lang | null): void {
  try {
    if (lang) localStorage.setItem(LANG_KEY, lang);
    else localStorage.removeItem(LANG_KEY);
  } catch {
    // storage blocked: nothing to persist
  }
  langListeners.forEach((l) => l());
}

export function useLangOverride(): Lang | null {
  return React.useSyncExternalStore(
    (cb) => {
      langListeners.add(cb);
      return () => langListeners.delete(cb);
    },
    getLangOverride,
    () => null,
  );
}

/**
 * Provides the active UI language to the tree and keeps
 * `document.documentElement.lang` in sync. Must live inside the
 * QueryClientProvider so `useLocale` (which reads GET /api/locale) works.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { language } = useLocale();
  const lang = useLangOverride() ?? asLang(language);

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
