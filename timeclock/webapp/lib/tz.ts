// Single source of truth for the facility timezone. Every timestamp the app
// shows a human (punch times, rosters, pay periods) is rendered in this zone;
// everything stored in Postgres stays UTC (timestamptz). NZ observes DST, so
// never do wall-clock math with fixed offsets — always go through Intl here.
export const APP_TZ = "Pacific/Auckland";

/** Current instant as an ISO-8601 string with the Pacific/Auckland offset. */
export function nowISOInTZ(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
  const offset = tzOffset(date);
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}${offset}`;
}

/** Signed UTC offset (e.g. "+12:00" / "+13:00" under DST) for APP_TZ. */
export function tzOffset(date: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    timeZoneName: "longOffset",
  });
  const name = dtf.formatToParts(date).find((p) => p.type === "timeZoneName")?.value;
  // "GMT+12:00" -> "+12:00"; fall back to Z if unavailable.
  const match = name?.match(/([+-]\d{2}:\d{2})$/);
  return match ? match[1] : "Z";
}
