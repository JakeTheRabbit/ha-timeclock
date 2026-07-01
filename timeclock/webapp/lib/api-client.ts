// Client-side fetch wrapper. NEXT_PUBLIC_BASE_PATH is the compile-time
// sentinel (/ha-ingress); the ingress proxy rewrites it inside JS bundles to
// the real per-session ingress prefix, so requests route back through HA.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API ${status}`);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, data?: unknown) =>
  api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
export const apiPatch = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
