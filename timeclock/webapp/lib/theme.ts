/*
 * Native-HA theming, persisted per device in localStorage.
 *
 * NOTE: intentionally NOT a "use client" module. `themeInitScript()` is called
 * from the server root layout (its return value is inlined as a <script>), and
 * a "use client" directive would turn these exports into client references that
 * cannot be invoked during server render. The window/document access inside the
 * runtime helpers is guarded, so the module is safe on both server and client.
 *
 * - Mode: "dark" | "light" | "system" (system follows prefers-color-scheme).
 *   Resolved mode is written to `document.documentElement[data-theme]`.
 * - Accent: one of ACCENTS (the HA theme-picker palette) OR a raw hex. Written
 *   to `--ha-accent` (+ a readable contrast colour to `--ha-accent-contrast`).
 * - Default: dark + HA blue #03a9f4 (matches the pre-theme kiosk look).
 *
 * The <html> gets the right values BEFORE first paint via themeInitScript()
 * (inlined in the root layout), so there is no flash of the wrong theme.
 */

export type ThemeMode = "dark" | "light" | "system";

export interface ThemeState {
  mode: ThemeMode;
  accent: string; // hex, e.g. "#03a9f4"
}

export const MODE_KEY = "tc-theme-mode";
export const ACCENT_KEY = "tc-theme-accent";

export const DEFAULT_ACCENT = "#03a9f4";

/**
 * The HA frontend theme-picker palette (src/resources/theme/color/color.globals
 * named colours). Default HA blue first.
 */
export const ACCENTS: { name: string; value: string }[] = [
  { name: "HA Blue", value: "#03a9f4" },
  { name: "Blue", value: "#2196f3" },
  { name: "Indigo", value: "#3f51b5" },
  { name: "Deep Purple", value: "#6e41ab" },
  { name: "Purple", value: "#926bc7" },
  { name: "Pink", value: "#e91e63" },
  { name: "Red", value: "#f44336" },
  { name: "Deep Orange", value: "#ff6f22" },
  { name: "Orange", value: "#ff9800" },
  { name: "Amber", value: "#ffc107" },
  { name: "Teal", value: "#009688" },
  { name: "Green", value: "#4caf50" },
  { name: "Light Green", value: "#8bc34a" },
  { name: "Cyan", value: "#00bcd4" },
  { name: "Blue Grey", value: "#607d8b" },
];

/** Readable text colour (black/white) for a filled swatch of `hex`. */
export function contrastFor(hex: string): "#ffffff" | "#212121" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // Relative luminance (sRGB). Threshold tuned so mid brand colours read white.
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#212121" : "#ffffff";
}

export function resolveMode(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
    return "dark";
  }
  return mode;
}

/** Apply a theme state to <html> immediately. */
export function applyTheme(state: ThemeState): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolveMode(state.mode));
  root.style.setProperty("--ha-accent", state.accent);
  root.style.setProperty("--ha-accent-contrast", contrastFor(state.accent));
}

export function readTheme(): ThemeState {
  if (typeof window === "undefined") return { mode: "dark", accent: DEFAULT_ACCENT };
  const mode = (localStorage.getItem(MODE_KEY) as ThemeMode | null) ?? "system";
  const accent = localStorage.getItem(ACCENT_KEY) ?? DEFAULT_ACCENT;
  const valid: ThemeMode[] = ["dark", "light", "system"];
  return { mode: valid.includes(mode) ? mode : "system", accent };
}

export function writeTheme(state: ThemeState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MODE_KEY, state.mode);
  localStorage.setItem(ACCENT_KEY, state.accent);
}

/**
 * Blocking <script> body run before paint (root layout). Reads localStorage and
 * sets data-theme + accent so there is no theme flash. Kept dependency-free and
 * string-inlinable; mirrors readTheme/applyTheme minimally.
 */
export function themeInitScript(): string {
  return `(function(){try{
var m=localStorage.getItem('${MODE_KEY}')||'system';
var a=localStorage.getItem('${ACCENT_KEY}')||'${DEFAULT_ACCENT}';
var d=document.documentElement;
var resolved=m;
if(m==='system'){resolved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';}
d.setAttribute('data-theme',resolved);
d.style.setProperty('--ha-accent',a);
var mm=/^#?([0-9a-f]{6})$/i.exec(a.trim());var c='#ffffff';
if(mm){var n=parseInt(mm[1],16);var lum=(0.299*((n>>16)&255)+0.587*((n>>8)&255)+0.114*(n&255))/255;c=lum>0.62?'#212121':'#ffffff';}
d.style.setProperty('--ha-accent-contrast',c);
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
}
