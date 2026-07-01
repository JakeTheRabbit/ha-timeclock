/**
 * Identity-source seam. Kiosk/LAN (P2) resolves identity from HA Ingress
 * headers; a future remote deployment adds a RemoteAuthProvider (real login)
 * WITHOUT touching sessions/RBAC/PIN — everything downstream consumes this
 * interface only.
 */
export interface HaIdentity {
  haUserId: string;
  haUserName: string | null; // not guaranteed by Supervisor
  displayName: string | null;
}

export interface AuthProvider {
  /** Extract the panel-opener's identity from a request, if present. */
  resolveIdentity(headers: Headers): HaIdentity | null;
}

/**
 * HA Ingress provider. Supervisor injects these on every ingress request:
 *   X-Remote-User-Id, X-Remote-User-Name (optional), X-Remote-User-Display-Name
 * Spoof-resistance lives in the ingress proxy (proxy.js): it strips X-Remote-*
 * and X-Ingress-Path unless the request came from the Supervisor source IP.
 */
export class IngressAuthProvider implements AuthProvider {
  resolveIdentity(headers: Headers): HaIdentity | null {
    const id = headers.get("x-remote-user-id");
    if (!id) return null;
    return {
      haUserId: id,
      haUserName: headers.get("x-remote-user-name"),
      displayName: headers.get("x-remote-user-display-name"),
    };
  }
}

export const authProvider: AuthProvider = new IngressAuthProvider();
