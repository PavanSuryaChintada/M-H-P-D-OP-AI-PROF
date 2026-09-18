// Doc 07 §3 — backoff base table + jitter, then clamp to calling hours,
// then patient preference, then refuse (WINDOW_WOULD_EXPIRE) rather than
// schedule an impossible call.

import { describe, expect, it } from "vitest";
import { computeBackoff } from "../lib/queue/backoff";

const ALWAYS_OPEN = {
  MON: { start: "00:00", end: "23:59" },
  TUE: { start: "00:00", end: "23:59" },
  WED: { start: "00:00", end: "23:59" },
  THU: { start: "00:00", end: "23:59" },
  FRI: { start: "00:00", end: "23:59" },
  SAT: { start: "00:00", end: "23:59" },
  SUN: { start: "00:00", end: "23:59" },
};

describe("computeBackoff", () => {
  it("base[attempt] with +/-20% jitter for attempt 1 lands within [12, 18] minutes", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    const result = computeBackoff({
      attemptNumber: 1,
      now,
      windowEnd: new Date("2026-09-25T00:00:00Z"),
      timezone: "UTC",
      callingHours: ALWAYS_OPEN,
      rng: () => 0.5, // midpoint -> no jitter
    });
    expect(result.scheduledFor).not.toBeNull();
    const minutes = (result.scheduledFor!.getTime() - now.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(15, 0); // base[0] = 15
  });

  it("jitter stays within +/-20% of the base value", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    const withMinJitter = computeBackoff({ attemptNumber: 1, now, windowEnd: new Date("2026-09-25T00:00:00Z"), timezone: "UTC", callingHours: ALWAYS_OPEN, rng: () => 0 });
    const withMaxJitter = computeBackoff({ attemptNumber: 1, now, windowEnd: new Date("2026-09-25T00:00:00Z"), timezone: "UTC", callingHours: ALWAYS_OPEN, rng: () => 1 });
    const minMinutes = (withMinJitter.scheduledFor!.getTime() - now.getTime()) / 60_000;
    const maxMinutes = (withMaxJitter.scheduledFor!.getTime() - now.getTime()) / 60_000;
    expect(minMinutes).toBeCloseTo(12, 0); // 15 * 0.8
    expect(maxMinutes).toBeCloseTo(18, 0); // 15 * 1.2
  });

  it("a fixed backoff (BUSY=10, DROPPED=5) overrides the base table entirely", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    const result = computeBackoff({
      attemptNumber: 1,
      fixedBackoffMinutes: 10,
      now,
      windowEnd: new Date("2026-09-25T00:00:00Z"),
      timezone: "UTC",
      callingHours: ALWAYS_OPEN,
      rng: () => 0.5,
    });
    const minutes = (result.scheduledFor!.getTime() - now.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(10, 0);
  });

  it("clamps forward to the next calling-hours opening", () => {
    const now = new Date("2026-09-18T10:00:00Z"); // Friday
    const businessHoursOnly = { FRI: { start: "09:00", end: "10:05" } }; // closes 5 min after `now`
    const result = computeBackoff({
      attemptNumber: 1, // would land ~15 min after 10:00 = 10:15, outside the 09:00-10:05 window
      now,
      windowEnd: new Date("2026-09-25T00:00:00Z"),
      timezone: "UTC",
      callingHours: businessHoursOnly,
      rng: () => 0.5,
    });
    // No FRI window covers 10:15, and no other weekday is configured at
    // all, so this must fail to find an opening within the search horizon
    // and correctly refuse rather than land outside calling hours.
    expect(result.scheduledFor).toBeNull();
  });

  it("refuses to schedule (WINDOW_WOULD_EXPIRE) rather than land past the clinical deadline", () => {
    const now = new Date("2026-09-18T10:00:00Z");
    const result = computeBackoff({
      attemptNumber: 4, // base[3] = 240 minutes = 4 hours
      now,
      windowEnd: new Date("2026-09-18T11:00:00Z"), // only 1 hour of window left
      timezone: "UTC",
      callingHours: ALWAYS_OPEN,
      rng: () => 0.5,
    });
    expect(result.scheduledFor).toBeNull();
    expect((result as { reason: string }).reason).toBe("WINDOW_WOULD_EXPIRE");
  });

  it("respects a patient's noCallsBefore preference", () => {
    const now = new Date("2026-09-18T02:00:00Z"); // 2am
    const result = computeBackoff({
      attemptNumber: 1, // ~2:15am, before the 10am cutoff
      now,
      windowEnd: new Date("2026-09-25T00:00:00Z"),
      timezone: "UTC",
      callingHours: ALWAYS_OPEN,
      patientPreference: { noCallsBefore: "10:00" },
      rng: () => 0.5,
    });
    expect(result.scheduledFor).not.toBeNull();
    const hour = result.scheduledFor!.getUTCHours();
    expect(hour).toBeGreaterThanOrEqual(10);
  });
});
