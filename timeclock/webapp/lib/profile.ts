/** Client-side checks for the /me page (server re-validates). Pure. */

export type PinProblem = "format" | "mismatch" | "same" | null;

/** First problem with a PIN change form, or null when it can be sent. */
export function pinChangeProblem(current: string, next: string, repeat: string, hasPin: boolean): PinProblem {
  if (!/^\d{4,12}$/.test(next)) return "format";
  if (next !== repeat) return "mismatch";
  if (hasPin && current === next) return "same";
  return null;
}

/** "" (clear) or an HA notify service id. */
export function validNotifyService(v: string): boolean {
  return v === "" || /^notify\.[a-z0-9_]+$/.test(v);
}
