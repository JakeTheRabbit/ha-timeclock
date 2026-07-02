import { describe, it, expect } from "vitest";
import { translate, LOCALES, type Lang, type MessageKey } from "@/lib/i18n";
import en from "@/lib/i18n/en";

/**
 * Pure i18n unit tests — no database. Exercises the documented three-tier
 * fallback of `translate()` (active-locale → English → raw key), placeholder
 * interpolation, and — most importantly — full key parity between every
 * non-English catalog and the English source of truth.
 */
describe("i18n translate()", () => {
  it("(a) falls back to English when a key is missing in a locale", () => {
    // Pick a real key and temporarily remove it from a non-English catalog so
    // the locale-missing → English branch is actually taken. `LOCALES` values
    // are mutable objects, so we snapshot and restore to keep the test hermetic.
    const key: MessageKey = "common.save";
    const de = LOCALES.de as Record<string, string>;
    const saved = de[key];
    expect(saved).toBeDefined(); // sanity: it *was* translated
    try {
      delete de[key];
      // Locale no longer has it → must return the English value, not blank.
      expect(translate("de", key)).toBe(en[key]);
      expect(translate("de", key)).toBe("Save");
    } finally {
      de[key] = saved as string;
    }
  });

  it("(b) returns the raw key when it is missing everywhere", () => {
    // A key present in no catalog (cast through unknown to bypass the type gate,
    // which is exactly the runtime situation this fallback guards against).
    const bogus = "does.not.exist.anywhere" as unknown as MessageKey;
    expect(translate("en", bogus)).toBe("does.not.exist.anywhere");
    expect(translate("fr", bogus)).toBe("does.not.exist.anywhere");
  });

  it("(c) interpolates {n} (and other named placeholders)", () => {
    // "{n} digits entered"
    expect(translate("en", "pinPad.digitsEntered", { n: 4 })).toBe(
      "4 digits entered",
    );
    // Numeric values are coerced to string.
    expect(translate("en", "pinPad.digitsEntered", { n: 0 })).toBe(
      "0 digits entered",
    );
    // Multiple distinct placeholders in one template.
    expect(
      translate("en", "toast.workedAutoDeducted", { hours: 8, min: 30 }),
    ).toBe("Worked 8h (auto-deducted 30min break)");
    // Repeated placeholder is replaced everywhere (split/join semantics).
    const repeated = translate("de", "pinPad.digitsEntered", { n: 7 });
    expect(repeated).toContain("7");
    expect(repeated).not.toContain("{n}");
  });

  it("(d) EVERY locale has the SAME key set as English (full parity)", () => {
    const enKeys = Object.keys(en).sort();
    const problems: string[] = [];

    for (const lang of Object.keys(LOCALES) as Lang[]) {
      if (lang === "en") continue;
      const catalog = LOCALES[lang] as Record<string, string>;
      const localeKeys = Object.keys(catalog);
      const localeKeySet = new Set(localeKeys);

      const missing = enKeys.filter((k) => !localeKeySet.has(k));
      const extra = localeKeys.filter((k) => !enKeys.includes(k));

      if (missing.length > 0) {
        problems.push(
          `[${lang}] missing ${missing.length} key(s): ${missing.join(", ")}`,
        );
      }
      if (extra.length > 0) {
        problems.push(
          `[${lang}] has ${extra.length} extra key(s) not in en: ${extra.join(", ")}`,
        );
      }
    }

    // Fail loudly, listing every discrepancy across all locales at once.
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
});
