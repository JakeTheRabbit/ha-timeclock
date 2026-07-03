"use client";

import * as React from "react";
import {
  applyTheme,
  readTheme,
  writeTheme,
  resolveMode,
  DEFAULT_ACCENT,
  type ThemeMode,
  type ThemeState,
} from "@/lib/theme";

/**
 * Per-device theme state (localStorage). Applying is idempotent with the
 * pre-paint init script in the root layout. Follows the OS when mode="system".
 */
export function useTheme() {
  // Start from the SSR-safe default so the first client render matches the
  // server; sync to real localStorage in an effect (avoids hydration mismatch).
  const [state, setState] = React.useState<ThemeState>({
    mode: "dark",
    accent: DEFAULT_ACCENT,
  });

  React.useEffect(() => {
    setState(readTheme());
  }, []);

  // Re-apply on change + persist.
  React.useEffect(() => {
    applyTheme(state);
    writeTheme(state);
  }, [state]);

  // When following the OS, react to it changing live.
  React.useEffect(() => {
    if (state.mode !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme(state);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [state]);

  return {
    mode: state.mode,
    accent: state.accent,
    resolved: resolveMode(state.mode),
    setMode: (mode: ThemeMode) => setState((s) => ({ ...s, mode })),
    setAccent: (accent: string) => setState((s) => ({ ...s, accent })),
  };
}
