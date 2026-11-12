/**
 * Pure helpers behind Admin → Settings' single save model: the page edits one
 * draft of the whole settings document, and Save sends only what changed.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Same rules as the server's deepMerge: objects merge, everything else replaces. */
export function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (isObj(base) && isObj(patch)) {
    const out: Obj = { ...base };
    for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(out[k], v);
    return out;
  }
  return patch;
}

/**
 * Minimal patch turning `base` into `next` (arrays and leaves replace whole).
 * undefined when nothing changed. NaN compares as changed so the server can
 * reject it with a field path.
 */
export function diffDoc(base: unknown, next: unknown): unknown {
  if (isObj(base) && isObj(next)) {
    const out: Obj = {};
    for (const [k, v] of Object.entries(next)) {
      const d = diffDoc(base[k], v);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return JSON.stringify(base) === JSON.stringify(next) && !Number.isNaN(next) ? undefined : next;
}

/** Read a dotted path ("overtime.multiplier1") out of a document. */
export function getPath(doc: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), doc);
}

/** Copy of `doc` with `path` set to `value` (intermediate objects created). */
export function setPath<T>(doc: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split(".");
  const obj: Obj = isObj(doc) ? doc : {};
  return {
    ...obj,
    [head]: rest.length ? setPath(obj[head], rest.join("."), value) : value,
  } as T;
}

export interface Issue {
  path: string;
  message: string;
}

/** Issues for one field (exact path or anything beneath it). */
export const issuesAt = (issues: Issue[], path: string) =>
  issues.filter((i) => i.path === path || i.path.startsWith(path + "."));

/** Validation issues from a rejected PATCH /admin/settings body, if any. */
export function issuesFromBody(body: unknown): Issue[] {
  const issues = isObj(body) ? body.issues : undefined;
  return Array.isArray(issues)
    ? issues.filter((i): i is Issue => isObj(i) && typeof i.path === "string" && typeof i.message === "string")
    : [];
}

/**
 * Stored value ↔ form text in display units, e.g. scale 60 shows minutes as
 * hours ("7.5" ⇄ 450). Blank → null, junk → NaN (the server names the field).
 */
export const toUnits = (v: number | null | undefined, scale = 1) =>
  v == null || Number.isNaN(v) ? "" : String(Math.round((v / scale) * 100) / 100);
export const fromUnits = (text: string, scale = 1): number | null => {
  if (text.trim() === "") return null;
  const n = Number(text.trim().replace(",", "."));
  if (!Number.isFinite(n)) return Number.NaN;
  return scale === 1 ? n : Math.round(n * scale);
};
