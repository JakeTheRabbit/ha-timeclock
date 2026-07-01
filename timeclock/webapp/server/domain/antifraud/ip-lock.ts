/**
 * IP/WiFi lock: allowlist of exact IPs or CIDR ranges (IPv4). The kiosk LAN
 * range (e.g. "192.168.1.0/24") means punches must come from on-site WiFi.
 * Empty allowlist = feature off.
 */
export function ipToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt == null || rangeInt == null) return false;
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/** null = pass; string = flag code. */
export function ipFlag(allowlist: string[], punchIp: string | null): string | null {
  if (allowlist.length === 0) return null;
  if (!punchIp) return "ip_missing";
  // Normalize IPv6-mapped IPv4 (::ffff:192.168.1.5).
  const ip = punchIp.replace(/^::ffff:/i, "");
  return allowlist.some((c) => ipInCidr(ip, c)) ? null : `ip_not_allowed_${ip}`;
}
