import { getDb } from "@/db/client";
import { employees, type Employee } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Profile pictures sourced from Home Assistant `person` entities.
 *
 * HA `person.*` entities carry `attributes.user_id` (the HA auth user id) and,
 * when a picture is configured, `attributes.entity_picture` (an HA-relative,
 * auth-protected URL like `/local/demo.jpg` or `/api/image/serve/<id>/512x512`).
 *
 * We match a person -> employee the same way SSO does (employee.ha_username may
 * hold either the opaque HA user id OR the human username, case-insensitively —
 * see server/auth/employee-link.ts), then, as a last resort, by display name.
 *
 * The picture is fetched SERVER-SIDE through the Supervisor Core proxy with the
 * add-on's SUPERVISOR_TOKEN (homeassistant_api: true) and streamed to the
 * client by the /api/avatars/:id route — the token never reaches the browser.
 * Results are cached briefly so a kiosk grid render is one HA call, not N.
 */

const CORE_API = process.env.HA_CORE_API || "http://supervisor/core/api";
// Base for fetching the picture path itself (entity_picture is /local, /api/…).
const CORE_BASE = process.env.HA_CORE_BASE || "http://supervisor/core";

interface HaState {
  entity_id: string;
  state: string;
  attributes?: {
    friendly_name?: string;
    user_id?: string | null;
    entity_picture?: string | null;
  };
}

export interface PersonPicture {
  /** entity_picture path as HA reports it (relative), e.g. "/local/x.jpg". */
  path: string;
  userId: string | null;
  name: string;
}

// ---- HA person cache (short TTL; a punch grid re-render shouldn't hammer HA).
let cache: { people: PersonPicture[]; at: number } | null = null;
const PEOPLE_TTL_MS = 60_000;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Fetch `person.*` entities that have a picture. Empty outside HA / on error. */
export async function fetchPeoplePictures(force = false): Promise<PersonPicture[]> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return [];
  if (!force && cache && Date.now() - cache.at < PEOPLE_TTL_MS) return cache.people;
  try {
    const res = await fetchImpl(`${CORE_API}/states`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HA states ${res.status}`);
    const rows = (await res.json()) as HaState[];
    const people = rows
      .filter((r) => r.entity_id.startsWith("person.") && r.attributes?.entity_picture)
      .map((r) => ({
        path: r.attributes!.entity_picture as string,
        userId: r.attributes?.user_id ?? null,
        name: r.attributes?.friendly_name ?? r.entity_id.slice("person.".length),
      }));
    cache = { people, at: Date.now() };
    return people;
  } catch (e) {
    console.error("[avatars] fetch people failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Resolve the HA entity_picture path for an employee, or null if none matches.
 * Match order (most reliable first):
 *   1. person.user_id === employee.ha_username  (SSO-linked HA user id)
 *   2. person.friendly_name === employee.ha_username (username typed as name)
 *   3. person.friendly_name === employee.display_name (best-effort name match)
 */
export function matchPicture(emp: Pick<Employee, "haUsername" | "displayName">, people: PersonPicture[]): string | null {
  const haUser = norm(emp.haUsername);
  const name = norm(emp.displayName);

  if (haUser) {
    const byId = people.find((p) => norm(p.userId) === haUser);
    if (byId) return byId.path;
    const byUserName = people.find((p) => norm(p.name) === haUser);
    if (byUserName) return byUserName.path;
  }
  const byName = people.find((p) => norm(p.name) === name);
  return byName ? byName.path : null;
}

async function loadEmployee(employeeId: string): Promise<Employee | null> {
  const rows = await getDb().select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  return rows[0] ?? null;
}

export interface AvatarImage {
  body: ArrayBuffer;
  contentType: string;
}

// ---- Fetched-image cache: keyed by employee id, short TTL, tiny (avatars are
// small and few). Avoids re-proxying the same picture on every grid render.
const imgCache = new Map<string, { img: AvatarImage; at: number }>();
const IMG_TTL_MS = 5 * 60_000;

/**
 * Fetch an employee's avatar bytes via the Supervisor core proxy, or null when
 * there is no HA picture for them (caller renders an initials fallback).
 */
export async function getEmployeeAvatar(employeeId: string): Promise<AvatarImage | null> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) return null;

  const hit = imgCache.get(employeeId);
  if (hit && Date.now() - hit.at < IMG_TTL_MS) return hit.img;

  const emp = await loadEmployee(employeeId);
  if (!emp) return null;

  const people = await fetchPeoplePictures();
  const path = matchPicture(emp, people);
  if (!path) return null;

  // entity_picture is HA-relative; join onto the core proxy base. Reject
  // anything that isn't a same-origin relative path (defensive — never proxy an
  // arbitrary absolute URL supplied via HA state).
  if (!path.startsWith("/")) return null;
  try {
    const res = await fetchImpl(`${CORE_BASE}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const body = await res.arrayBuffer();
    const img: AvatarImage = { body, contentType };
    imgCache.set(employeeId, { img, at: Date.now() });
    return img;
  } catch (e) {
    console.error("[avatars] fetch image failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Test/util: clear both caches. */
export function _resetAvatarCaches() {
  cache = null;
  imgCache.clear();
}

// Injectable for tests (mirrors state-push.ts / presence.ts).
export let fetchImpl: typeof fetch = fetch;
export function setFetchImpl(f: typeof fetch) {
  fetchImpl = f;
}
