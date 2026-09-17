// Doc 03 R2: "must be real, not decorative" — the zod schema is what makes
// that true. These are pure schema tests, no database needed.

import { describe, expect, it } from "vitest";
import { HospitalConfigSchema, CreateHospitalSchema } from "../lib/hospitals/config-schema";

const validConfig = {
  callingHours: { MON: { start: "09:00", end: "18:00" } },
  maxConcurrentCalls: 5,
  defaultRetryPolicy: { maxAttempts: 3, backoffMinutes: [15, 60], jitterPct: 10 },
  defaultFollowUpWindowHours: 72,
  notificationPreferences: { channels: ["IN_APP"], reviewerTimeoutMinutes: 30 },
  ehrSettings: { mode: "mock", failureRate: 0.1 },
};

describe("HospitalConfigSchema", () => {
  it("accepts a valid config", () => {
    expect(HospitalConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it("rejects a calling window where start is not before end", () => {
    const bad = { ...validConfig, callingHours: { MON: { start: "18:00", end: "09:00" } } };
    expect(HospitalConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-HH:MM time string", () => {
    const bad = { ...validConfig, callingHours: { MON: { start: "9am", end: "18:00" } } };
    expect(HospitalConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects zero or negative maxConcurrentCalls", () => {
    expect(HospitalConfigSchema.safeParse({ ...validConfig, maxConcurrentCalls: 0 }).success).toBe(false);
    expect(HospitalConfigSchema.safeParse({ ...validConfig, maxConcurrentCalls: -1 }).success).toBe(false);
  });

  it("rejects an empty retry backoff array", () => {
    const bad = { ...validConfig, defaultRetryPolicy: { ...validConfig.defaultRetryPolicy, backoffMinutes: [] } };
    expect(HospitalConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects jitterPct outside 0-100", () => {
    const bad = { ...validConfig, defaultRetryPolicy: { ...validConfig.defaultRetryPolicy, jitterPct: 150 } };
    expect(HospitalConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an empty notification channels list", () => {
    const bad = { ...validConfig, notificationPreferences: { ...validConfig.notificationPreferences, channels: [] } };
    expect(HospitalConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects ehrSettings.failureRate outside 0-1", () => {
    const bad = { ...validConfig, ehrSettings: { ...validConfig.ehrSettings, failureRate: 1.5 } };
    expect(HospitalConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe("CreateHospitalSchema", () => {
  it("accepts a valid IANA timezone", () => {
    const result = CreateHospitalSchema.safeParse({
      name: "Test Hospital",
      shortCode: "TST",
      timezone: "Europe/Stockholm",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid timezone string", () => {
    const result = CreateHospitalSchema.safeParse({
      name: "Test Hospital",
      shortCode: "TST",
      timezone: "Not/AZone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed contact email when provided", () => {
    const result = CreateHospitalSchema.safeParse({
      name: "Test Hospital",
      shortCode: "TST",
      timezone: "Asia/Kolkata",
      contactEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});
