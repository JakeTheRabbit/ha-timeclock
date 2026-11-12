/** Admin → Employees list: Active / Inactive tab, name search, sorted by name. */
export function filterEmployees<
  E extends { displayName: string; active: boolean; role: string; haUsername: string | null },
>(list: E[], tab: "active" | "inactive", query: string): E[] {
  const q = query.trim().toLowerCase();
  return list
    .filter((e) => e.active === (tab === "active"))
    .filter(
      (e) =>
        !q ||
        e.displayName.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        (e.haUsername ?? "").toLowerCase().includes(q),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}
