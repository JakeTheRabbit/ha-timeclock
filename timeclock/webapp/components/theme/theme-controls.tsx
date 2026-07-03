"use client";

import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { ACCENTS, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { Label } from "@/components/ui/label";

const MODES: { value: ThemeMode; icon: typeof Sun; labelKey: Parameters<ReturnType<typeof useT>>[0] }[] = [
  { value: "light", icon: Sun, labelKey: "theme.mode.light" },
  { value: "dark", icon: Moon, labelKey: "theme.mode.dark" },
  { value: "system", icon: Monitor, labelKey: "theme.mode.system" },
];

/**
 * Native-HA appearance controls: dark/light/system mode + an accent swatch
 * picker (the HA theme-picker palette). Per-device, persisted in localStorage
 * via useTheme. Presentational only — safe on any screen.
 */
export function ThemeControls({ className }: { className?: string }) {
  const { mode, accent, setMode, setAccent } = useTheme();
  const t = useT();

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("theme.mode")}</Label>
        <div
          role="radiogroup"
          aria-label={t("theme.mode")}
          className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-secondary/40 p-1"
        >
          {MODES.map(({ value, icon: Icon, labelKey }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(value)}
                className={cn(
                  "flex min-h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">{t("theme.accent")}</Label>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((a) => {
            const active = accent.toLowerCase() === a.value.toLowerCase();
            return (
              <button
                key={a.value}
                type="button"
                aria-label={a.name}
                aria-pressed={active}
                title={a.name}
                onClick={() => setAccent(a.value)}
                style={{ backgroundColor: a.value }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "hover:scale-110",
                )}
              >
                {active && <Check className="size-4 text-white drop-shadow" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
