import { ApiError } from "@/lib/api-client";
import en from "@/lib/i18n/en";
import type { MessageKey, TVars } from "@/lib/i18n";

type TFn = (key: MessageKey, vars?: TVars) => string;

/** English fallback for pages not on useT() yet. */
const enT: TFn = (key, vars) =>
  Object.entries(vars ?? {}).reduce<string>((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), en[key] ?? key);

/** Server error code from an ApiError body, if any. */
export const apiErrorCode = (e: unknown): string | undefined =>
  e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;

/**
 * Human message for a failed request: translated `error.<code>` when we know
 * the code, else the code made readable, else a generic status message.
 */
export function apiErrorText(e: unknown, t: TFn = enT): string {
  if (!(e instanceof ApiError)) return t("toast.requestFailed");
  const code = apiErrorCode(e);
  if (!code) return t("toast.errorStatus", { status: e.status });
  const key = `error.${code}` as MessageKey;
  if (key in en) return t(key);
  const words = code.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1) + ".";
}
