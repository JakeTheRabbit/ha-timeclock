"use client";

import { useEffect, useState } from "react";

/** Ticking H:MM:SS since `since` (ISO string or Date). Re-renders 1/s. */
export function useLiveTimer(since: string | Date | null): string {
  const [, force] = useState(0);
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [since]);

  if (!since) return "0:00:00";
  const ms = Date.now() - new Date(since).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
