"use client";

import { useState } from "react";
import { Check, Delete } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "ok"] as const;

export function PinPad({
  onSubmit,
  disabled,
}: {
  onSubmit: (pin: string) => void;
  disabled?: boolean;
}) {
  const [pin, setPin] = useState("");
  const t = useT();

  const press = (k: (typeof KEYS)[number]) => {
    if (k === "clear") return setPin("");
    if (k === "ok") {
      if (pin.length >= 4) {
        onSubmit(pin);
        setPin("");
      }
      return;
    }
    if (pin.length < 12) setPin(pin + k);
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
            variant={k === "ok" ? "default" : k === "clear" ? "outline" : "secondary"}
            disabled={disabled || (k === "ok" && pin.length < 4)}
            onClick={() => press(k)}
            aria-label={k === "clear" ? t("pinPad.clear") : k === "ok" ? t("pinPad.submit") : k}
            className="h-16 w-20 rounded-xl text-2xl font-semibold active:scale-95"
          >
            {k === "clear" ? (
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
