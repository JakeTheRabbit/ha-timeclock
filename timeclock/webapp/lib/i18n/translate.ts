/**
 * Pure i18n core (no React, no "use client") so server code — push/notification
 * texts — can translate too. `index.tsx` re-exports everything here.
 */
import en from "./en";
import de from "./de";
import fr from "./fr";
import sv from "./sv";
import da from "./da";

/** Every valid message key (keys of the frozen English catalog). */
export type MessageKey = keyof typeof en;

/** Supported UI languages. Mirrors settings.locale.language. */
export type Lang = "en" | "de" | "fr" | "sv" | "da";

/** Values passed into `{var}` placeholders. */
export type TVars = Record<string, string | number>;

/** A locale catalog: any subset of the message keys, values widened to string. */
export type Messages = Partial<Record<MessageKey, string>>;

/**
 * All catalogs. `en` is complete; the rest are Partial and fall back to `en`
 * per key inside `translate()`.
 */
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
