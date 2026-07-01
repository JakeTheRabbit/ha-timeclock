/** Haversine distance in metres. */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface GeofenceRule {
  enabled: boolean;
  lat: number;
  lng: number;
  radiusM: number;
}

/** null = pass; string = flag code. Missing coords with geofence on = flag. */
export function geofenceFlag(
  rule: GeofenceRule,
  punch: { lat: number; lng: number } | null,
): string | null {
  if (!rule.enabled) return null;
  if (!punch) return "geo_missing";
  const d = distanceMetres({ lat: rule.lat, lng: rule.lng }, punch);
  return d > rule.radiusM ? `outside_geofence_${Math.round(d)}m` : null;
}
