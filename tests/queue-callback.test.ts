// Doc 07 §4 — callback time validation refuses an invalid time rather than
// silently accepting it.

import { describe, expect, it } from "vitest";
import { validateCallbackTime } from "../lib/queue/callback";

const BUSINESS_HOURS = { MON: { start: "09:00", end: "17:00" } };

describe("validateCallbackTime", () => {
  it("accepts a time within calling hours and before the window ends", () => {
    const result = validateCallbackTime(
      new Date("2026-09-21T10:00:00Z"), // Monday 10am
      new Date("2026-09-25T00:00:00Z"),
      "UTC",
      BUSINESS_HOURS,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects 03:00 — outside any configured calling hours", () => {
    const result = validateCallbackTime(
      new Date("2026-09-21T03:00:00Z"), // Monday 3am
      new Date("2026-09-25T00:00:00Z"),
      "UTC",
      BUSINESS_HOURS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("OUTSIDE_CALLING_HOURS");
  });

  it("rejects a time past the clinical window end", () => {
    const result = validateCallbackTime(
      new Date("2026-09-30T10:00:00Z"),
      new Date("2026-09-25T00:00:00Z"),
      "UTC",
      BUSINESS_HOURS,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("PAST_WINDOW_END");
  });
});
