// Doc 07 §3 — backoff, then clamp forward to calling hours, then to the
// patient's preference window, then refuse to schedule at all if that
// still lands past the clinical window's end. "Do not schedule a call that
// can never legally happen."

import { isWithinCallingHours } from "../hospitals/calling-hours";
import { toLocalTime, parseHHMM } from "../hospitals/timezone";
import type { HospitalConfig } from "../hospitals/config-schema";

const BASE_BACKOFF_MINUTES = [15, 45, 120, 240];
const SEARCH_STEP_MINUTES = 15;
const SEARCH_MAX_DAYS = 7;

export interface PatientPreference {
  preferredTimeStart?: string; // "HH:MM"
  preferredTimeEnd?: string;
  noCallsBefore?: string;
}

export interface BackoffInput {
  /** 1-indexed — the attempt that just happened, used to pick base[attempt] */
  attemptNumber: number;
  /** BUSY (10) / DROPPED (5) override the base table entirely per doc 07 §2 */
  fixedBackoffMinutes?: number;
  now: Date;
  /** the clinical follow-up deadline — a candidate past this is refused, not scheduled */
  windowEnd: Date;
  timezone: string;
  callingHours: HospitalConfig["callingHours"];
  patientPreference?: PatientPreference;
  /** injectable for deterministic tests; defaults to Math.random */
  rng?: () => number;
}

export type BackoffResult = { scheduledFor: Date } | { scheduledFor: null; reason: "WINDOW_WOULD_EXPIRE" };

function jitteredMinutes(base: number, rng: () => number): number {
  return base * (1 + (rng() * 0.4 - 0.2)); // 1 +/- 0.2
}

function withinPreference(minutesSinceMidnight: number, pref?: PatientPreference): boolean {
  if (!pref) return true;
  if (pref.noCallsBefore && minutesSinceMidnight < parseHHMM(pref.noCallsBefore)) return false;
  if (pref.preferredTimeStart && pref.preferredTimeEnd) {
    const start = parseHHMM(pref.preferredTimeStart);
    const end = parseHHMM(pref.preferredTimeEnd);
    return minutesSinceMidnight >= start && minutesSinceMidnight < end;
  }
  return true;
}

export function computeBackoff(input: BackoffInput): BackoffResult {
  const rng = input.rng ?? Math.random;

  const minutes =
    input.fixedBackoffMinutes != null
      ? input.fixedBackoffMinutes
      : jitteredMinutes(BASE_BACKOFF_MINUTES[Math.min(Math.max(input.attemptNumber - 1, 0), BASE_BACKOFF_MINUTES.length - 1)], rng);

  let candidate = new Date(input.now.getTime() + minutes * 60_000);

  // Step forward in 15-minute increments until both calling hours and the
  // patient's stated preference are satisfied. Simple and correct at this
  // scale rather than solving the interval intersection analytically.
  const maxSteps = (SEARCH_MAX_DAYS * 24 * 60) / SEARCH_STEP_MINUTES;
  for (let i = 0; i < maxSteps; i++) {
    const inCallingHours = isWithinCallingHours({ callingHours: input.callingHours }, input.timezone, candidate);
    const local = toLocalTime(candidate, input.timezone);
    if (inCallingHours && withinPreference(local.minutesSinceMidnight, input.patientPreference)) break;
    candidate = new Date(candidate.getTime() + SEARCH_STEP_MINUTES * 60_000);
  }

  if (candidate.getTime() > input.windowEnd.getTime()) {
    return { scheduledFor: null, reason: "WINDOW_WOULD_EXPIRE" };
  }
  return { scheduledFor: candidate };
}
