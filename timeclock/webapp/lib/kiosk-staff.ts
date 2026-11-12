/**
 * Kiosk PIN screen staff list: filter by search, people who last signed in on
 * this device first (most recent first), then the server's alphabetical order.
 * The recent list lives in localStorage — per device, never sent anywhere.
 */
const KEY = "tc_kiosk_recent";
const MAX_RECENT = 8;

export function orderStaff<T extends { id: string; displayName: string }>(
  staff: T[],
  recent: string[],
  query: string,
): T[] {
  const q = query.trim().toLocaleLowerCase();
  const hits = q ? staff.filter((e) => e.displayName.toLocaleLowerCase().includes(q)) : staff;
  const rank = (id: string) => {
    const i = recent.indexOf(id);
    return i < 0 ? recent.length : i;
  };
  // Array.prototype.sort is stable, so non-recent people keep server order.
  return [...hits].sort((a, b) => rank(a.id) - rank(b.id));
}

/** Move `id` to the front of the recent list (deduped, capped). */
export const bumpRecent = (recent: string[], id: string) => [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT);

export function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberSignIn(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(bumpRecent(loadRecent(), id)));
  } catch {
    // storage blocked — ordering is a convenience only
  }
}
