/**
 * Deterministic JSON serialization. The audit hash is computed over this exact
 * string in BOTH the Postgres trigger (over the stored `payload` text) and in
 * TypeScript (verification), so the serialization must be stable and identical
 * — recursively sorted keys, no incidental whitespace.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(obj[k]);
        return acc;
      }, {});
  }
  return v;
}
