// Doc 03 R6 — store timestamps in UTC, evaluate calling windows in
// hospital-local time. Uses Intl.DateTimeFormat rather than a date library:
// Node's ICU data already carries the IANA tz database and handles DST
// transitions correctly, so a dependency isn't needed for this.

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export type Weekday = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

const WEEKDAY_ORDER: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface LocalTime {
  weekday: Weekday;
  /** Minutes since local midnight, 0-1439. Correct across DST: derived from
   *  the actual local hour/minute the formatter reports, not from a fixed
   *  UTC offset arithmetic that would drift on a DST transition day. */
  minutesSinceMidnight: number;
}

/** Converts a UTC instant to the weekday + minute-of-day in `timeZone`. */
export function toLocalTime(atUtc: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(atUtc);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayShort = get("weekday").toUpperCase().slice(0, 3) as Weekday;
  // hour12:false can format midnight as "24" in some ICU versions/locales —
  // normalize to 0 rather than let it silently become an out-of-range value.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));

  return {
    weekday: WEEKDAY_ORDER.includes(weekdayShort) ? weekdayShort : "SUN",
    minutesSinceMidnight: hour * 60 + minute,
  };
}

export function parseHHMM(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`invalid HH:MM value: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
}
