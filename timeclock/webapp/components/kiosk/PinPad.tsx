"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Delete } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "ok"] as const;
const HOLD_TO_CLEAR_MS = 600;

export function PinPad({
  onSubmit,
  disabled,
}: {
  onSubmit: (pin: string) => void;
  disabled?: boolean;
}) {
  const [pin, setPin] = useState("");
  const t = useT();
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const press = (k: (typeof KEYS)[number]) => {
    if (k === "back") return setPin((p) => p.slice(0, -1));
    if (k === "ok") {
      if (pin.length >= 4) {
        onSubmit(pin);
        setPin("");
      }
      return;
    }
    setPin((p) => (p.length < 12 ? p + k : p));
  };

  // Physical keyboard: digits, Backspace (one digit), Escape (clear), Enter (submit).
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (/^[0-9]$/.test(e.key)) pressRef.current(e.key as (typeof KEYS)[number]);
      else if (e.key === "Backspace") pressRef.current("back");
      else if (e.key === "Escape") setPin("");
      else if (e.key === "Enter") pressRef.current("ok");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);

  // Backspace: tap deletes one digit, hold clears the whole PIN.
  const startHold = () => {
    held.current = false;
    hold.current = setTimeout(() => {
      held.current = true;
      setPin("");
    }, HOLD_TO_CLEAR_MS);
  };
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="flex h-10 items-center gap-2 text-3xl tracking-widest text-foreground"
        aria-live="polite"
        aria-label={pin.length === 0 ? t("pinPad.enterPin") : t("pinPad.digitsEntered", { n: pin.length })}
      >
        {pin.length === 0 ? (
          <span className="text-base text-muted-foreground">{t("pinPad.enterPin")}</span>
        ) : (
          "●".repeat(pin.length)
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <Button
            key={k}
            type="button"
            variant={k === "ok" ? "default" : k === "back" ? "outline" : "secondary"}
            disabled={disabled || (k === "ok" && pin.length < 4) || (k === "back" && pin.length === 0)}
            onClick={() => {
              if (k === "back" && held.current) return; // the hold already cleared
              press(k);
            }}
            {...(k === "back" && {
              onPointerDown: startHold,
              onPointerUp: endHold,
              onPointerLeave: endHold,
              onPointerCancel: endHold,
              onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            })}
            aria-label={k === "back" ? t("pinPad.backspace") : k === "ok" ? t("pinPad.submit") : k}
            title={k === "back" ? t("pinPad.backspace") : undefined}
            className="h-16 w-20 rounded-xl text-2xl font-semibold active:scale-95"
          >
            {k === "back" ? (
              <Delete className="size-6" aria-hidden="true" />
            ) : k === "ok" ? (
              <Check className="size-7" aria-hidden="true" />
            ) : (
              k
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}
