"use client";

import { useState } from "react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "ok"] as const;

export function PinPad({
  onSubmit,
  disabled,
}: {
  onSubmit: (pin: string) => void;
  disabled?: boolean;
}) {
  const [pin, setPin] = useState("");

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
      <div className="flex h-10 items-center gap-2 text-3xl tracking-widest text-slate-100">
        {pin.length === 0 ? (
          <span className="text-base text-slate-500">Enter PIN</span>
        ) : (
          "●".repeat(pin.length)
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            className={
              "h-16 w-16 rounded-xl text-xl font-semibold transition active:scale-95 disabled:opacity-40 " +
              (k === "ok"
                ? "bg-sky-500 text-slate-950 hover:bg-sky-400"
                : k === "clear"
                  ? "bg-slate-800 text-slate-400 hover:bg-slate-700 text-sm"
                  : "bg-slate-800 text-slate-100 hover:bg-slate-700")
            }
          >
            {k === "clear" ? "CLR" : k === "ok" ? "OK" : k}
          </button>
        ))}
      </div>
    </div>
  );
}
