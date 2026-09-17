// Doc 03 R6 / deliverable: "Timezone helper isWithinCallingHours(hospitalId, at)
// with tests across DST." Pure-function tests, no database needed.

import { describe, expect, it } from "vitest";
import { isWithinCallingHours } from "../lib/hospitals/calling-hours";
import { toLocalTime } from "../lib/hospitals/timezone";
import { HospitalConfigSchema } from "../lib/hospitals/config-schema";

const config = HospitalConfigSchema.parse({
  callingHours: {
    MON: { start: "09:00", end: "18:00" },
    TUE: { start: "09:00", end: "18:00" },
  },
  maxConcurrentCalls: 5,
  defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60], jitterPct: 10 },
  defaultFollowUpWindowHours: 72,
  notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30 },
  ehrSettings: { mode: "mock", failureRate: 0 },
});

describe("isWithinCallingHours", () => {
  it("is true inside the window and false outside it, in a fixed-offset zone", () => {
    // 2024-03-04 is a Monday, not near any DST transition, in Asia/Kolkata (UTC+5:30, no DST).
    const inside = new Date("2024-03-04T10:00:00+05:30"); // 10:00 local Monday
    const outside = new Date("2024-03-04T20:00:00+05:30"); // 20:00 local Monday
    expect(isWithinCallingHours(config, "Asia/Kolkata", inside)).toBe(true);
    expect(isWithinCallingHours(config, "Asia/Kolkata", outside)).toBe(false);
  });

  it("is false on a day with no configured window", () => {
    const wednesday = new Date("2024-03-06T10:00:00+05:30");
    expect(isWithinCallingHours(config, "Asia/Kolkata", wednesday)).toBe(false);
  });

  // America/New_York springs forward 2024-03-10 (2am -> 3am EST -> EDT).
  // The Monday before (03-04, EST, UTC-5) and the Monday after (03-11, EDT,
  // UTC-4) both count as "09:00 local" — but at different UTC instants. A
  // naive fixed-UTC-offset implementation would get one of these wrong.
  it("evaluates 09:00 local correctly on both sides of a spring-forward transition", () => {
    const beforeTransitionLocal9am = new Date("2024-03-04T09:00:00-05:00"); // EST
    const afterTransitionLocal9am = new Date("2024-03-11T09:00:00-04:00"); // EDT

    expect(isWithinCallingHours(config, "America/New_York", beforeTransitionLocal9am)).toBe(true);
    expect(isWithinCallingHours(config, "America/New_York", afterTransitionLocal9am)).toBe(true);

    // Same UTC instant, one week apart, straddling the transition: EDT is
    // 1 hour ahead of EST, so the local reading is 1 hour later post-DST —
    // 09:00 UTC-offset-EST becomes 10:00 once EDT applies at that instant.
    // A naive implementation using a fixed UTC offset instead of the IANA
    // zone's actual (DST-aware) offset would get this wrong.
    const sameUtcInstantAfterTransition = new Date(
      beforeTransitionLocal9am.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
    const local = toLocalTime(sameUtcInstantAfterTransition, "America/New_York");
    expect(local.minutesSinceMidnight).toBe(10 * 60);
    expect(isWithinCallingHours(config, "America/New_York", sameUtcInstantAfterTransition)).toBe(true);
  });

  it("evaluates correctly across a fall-back transition (extra hour repeats)", () => {
    // America/New_York falls back 2024-11-03 (2am EDT -> 1am EST).
    const beforeFallBack = new Date("2024-10-28T09:00:00-04:00"); // EDT, Monday
    const afterFallBack = new Date("2024-11-04T09:00:00-05:00"); // EST, Monday
    expect(isWithinCallingHours(config, "America/New_York", beforeFallBack)).toBe(true);
    expect(isWithinCallingHours(config, "America/New_York", afterFallBack)).toBe(true);
  });
});
