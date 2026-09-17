import { toLocalTime, parseHHMM } from "./timezone";
import type { HospitalConfig } from "./config-schema";
import { getHospitalById } from "../db/repositories/hospitals";

/** Pure function — doc 03 R2/R6. Evaluates atUtc against config.callingHours in the given IANA timezone. */
export function isWithinCallingHours(
  config: Pick<HospitalConfig, "callingHours">,
  timezone: string,
  atUtc: Date,
): boolean {
  const { weekday, minutesSinceMidnight } = toLocalTime(atUtc, timezone);
  const window = config.callingHours[weekday];
  if (!window) return false; // no window configured for this day == closed

  const start = parseHHMM(window.start);
  const end = parseHHMM(window.end);
  return minutesSinceMidnight >= start && minutesSinceMidnight < end;
}

/** DB-backed convenience wrapper — the shape doc 03's deliverable names directly: isWithinCallingHours(hospitalId, at). */
export async function isWithinCallingHoursForHospital(hospitalId: string, atUtc: Date): Promise<boolean> {
  const hospital = await getHospitalById(hospitalId);
  if (!hospital || !hospital.config) return false;
  const config = hospital.config as HospitalConfig;
  return isWithinCallingHours(config, hospital.timezone, atUtc);
}
