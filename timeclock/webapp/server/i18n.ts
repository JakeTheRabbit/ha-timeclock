import { getSettings } from "@/server/domain/settings";
import { asLang, translate, type MessageKey, type TVars } from "@/lib/i18n/translate";

/**
 * Translator for server-side texts (push / notifications), bound to the site
 * language (settings.locale.language). Also returns the BCP-47 tag so times in
 * the message match the UI's formatting.
 */
export async function serverT() {
  const { language, bcp47 } = (await getSettings()).locale;
  const lang = asLang(language);
  return { t: (key: MessageKey, vars?: TVars) => translate(lang, key, vars), bcp47 };
}
