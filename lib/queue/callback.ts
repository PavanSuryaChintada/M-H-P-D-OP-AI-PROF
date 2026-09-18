// Doc 07 §4 — "If the requested time is outside calling hours or past the
// window end, the agent must offer the nearest valid alternative DURING
// THE CALL, not silently reschedule afterwards." This module can't force a
// conversation to happen (that's doc 10), but it can — and does — refuse
// to silently accept an invalid time if asked to schedule one anyway. That
// refusal is what makes "silently moved" impossible even if a future
// caller forgets to check first.

import { isWithinCallingHours } from "../hospitals/calling-hours";
import type { HospitalConfig } from "../hospitals/config-schema";

export interface CallbackValidation {
  valid: boolean;
  reason?: "OUTSIDE_CALLING_HOURS" | "PAST_WINDOW_END";
}

export function validateCallbackTime(
  requestedAt: Date,
  windowEnd: Date,
  timezone: string,
  callingHours: HospitalConfig["callingHours"],
): CallbackValidation {
  if (requestedAt.getTime() > windowEnd.getTime()) {
    return { valid: false, reason: "PAST_WINDOW_END" };
  }
  if (!isWithinCallingHours({ callingHours }, timezone, requestedAt)) {
    return { valid: false, reason: "OUTSIDE_CALLING_HOURS" };
  }
  return { valid: true };
}

export class InvalidCallbackTimeError extends Error {
  constructor(public readonly reason: CallbackValidation["reason"]) {
    super(`requested callback time is invalid: ${reason}`);
    this.name = "InvalidCallbackTimeError";
  }
}
