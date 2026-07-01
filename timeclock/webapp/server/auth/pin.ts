import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * PIN hashing with node's built-in scrypt (N=16384, r=8, p=1) — no native deps
 * in the Alpine image. Stored format: "scrypt:<salt-hex>:<hash-hex>".
 * Short PINs are brute-forceable by design; the rate limiter below plus
 * device-binding are the compensating controls.
 */
const KEYLEN = 32;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// ---- Rate limiter: 5 failures per key -> 60s lockout. In-memory is correct
// here: single node process per add-on container. ----
const WINDOW_MS = 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, { count: number; lockedUntil: number }>();

export function pinRateCheck(key: string, now = Date.now()): { allowed: boolean; retryInMs: number } {
  const f = fails.get(key);
  if (f && now < f.lockedUntil) return { allowed: false, retryInMs: f.lockedUntil - now };
  return { allowed: true, retryInMs: 0 };
}

export function pinRateFail(key: string, now = Date.now()): void {
  const f = fails.get(key) ?? { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= MAX_FAILS) {
    f.lockedUntil = now + WINDOW_MS;
    f.count = 0;
  }
  fails.set(key, f);
}

export function pinRateReset(key: string): void {
  fails.delete(key);
}
