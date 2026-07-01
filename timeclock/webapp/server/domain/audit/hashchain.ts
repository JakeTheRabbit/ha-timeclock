import { createHash } from "node:crypto";

/** Genesis link: 64 hex zeros (matches repeat('0',64) in the DB trigger). */
export const GENESIS_HASH = "0".repeat(64);

export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * hash_n = sha256( prev_hash || payload ).
 * Mirrors audit_log_hash_chain() in 0001_audit_hardening.sql byte-for-byte.
 */
export function computeHash(prevHash: string, payload: string): string {
  return sha256hex(prevHash + payload);
}

export interface ChainRow {
  prevHash: string;
  hash: string;
  payload: string;
}

/** Walk an ordered chain; return the first index that fails to verify. */
export function verifyChain(rows: ChainRow[]): { ok: boolean; brokenIndex: number | null } {
  let prev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.prevHash !== prev) return { ok: false, brokenIndex: i };
    if (r.hash !== computeHash(r.prevHash, r.payload)) return { ok: false, brokenIndex: i };
    prev = r.hash;
  }
  return { ok: true, brokenIndex: null };
}
