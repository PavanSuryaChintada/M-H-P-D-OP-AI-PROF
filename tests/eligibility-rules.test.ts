// Doc 05 R5 — each rule unit tested individually, no database.

import { describe, expect, it } from "vitest";
import { rules, evaluateAllRules, type EligibilityInput } from "../lib/campaigns/eligibility";

const now = new Date("2026-09-18T12:00:00Z");

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    patient: { id: "p1", phone: "+15551234567", communicationPreferences: null, sourcePayload: null },
    encounter: {
      dischargeAt: new Date("2026-09-17T12:00:00Z"), // 24h before `now`
      riskLevel: "MEDIUM",
      careSetting: "Inpatient",
      followUpWindowHours: 72,
    },
    conditions: [{ codeText: "Type 2 Diabetes Mellitus" }],
    campaignId: "c1",
    criteria: {},
    now,
    existingTasks: [],
    ...overrides,
  };
}

describe("dischargedWithinWindow", () => {
  it("passes when the follow-up window hasn't closed", () => {
    expect(rules.dischargedWithinWindow(baseInput()).passed).toBe(true);
  });
  it("fails once the window has closed", () => {
    const input = baseInput({ encounter: { ...baseInput().encounter, followUpWindowHours: 12 } });
    expect(rules.dischargedWithinWindow(input).passed).toBe(false);
  });
});

describe("notDeceasedOrReadmitted", () => {
  it("passes with no flags", () => {
    expect(rules.notDeceasedOrReadmitted(baseInput()).passed).toBe(true);
  });
  it("fails when deceased", () => {
    const input = baseInput({ patient: { ...baseInput().patient, sourcePayload: { deceased: true } } });
    expect(rules.notDeceasedOrReadmitted(input).passed).toBe(false);
  });
});

describe("hasUsableContact", () => {
  it("passes with a real-looking number", () => {
    expect(rules.hasUsableContact(baseInput()).passed).toBe(true);
  });
  it("fails on the invalid-number sentinel", () => {
    const input = baseInput({ patient: { ...baseInput().patient, phone: "000-000-0000" } });
    expect(rules.hasUsableContact(input).passed).toBe(false);
  });
  it("fails on a null phone", () => {
    const input = baseInput({ patient: { ...baseInput().patient, phone: null } });
    expect(rules.hasUsableContact(input).passed).toBe(false);
  });
});

describe("consentAllowsContact", () => {
  it("fails when doNotContact is set", () => {
    const input = baseInput({ patient: { ...baseInput().patient, communicationPreferences: { doNotContact: true } } });
    expect(rules.consentAllowsContact(input).passed).toBe(false);
  });
});

describe("notAlreadyCompletedInCampaign", () => {
  it("fails if this campaign already has a COMPLETED task for the patient", () => {
    const input = baseInput({ existingTasks: [{ campaignId: "c1", state: "COMPLETED" }] });
    expect(rules.notAlreadyCompletedInCampaign(input).passed).toBe(false);
  });
  it("passes if the COMPLETED task belongs to a different campaign", () => {
    const input = baseInput({ existingTasks: [{ campaignId: "other", state: "COMPLETED" }] });
    expect(rules.notAlreadyCompletedInCampaign(input).passed).toBe(true);
  });
});

describe("notInConflictingActiveCampaign", () => {
  it("fails when an active task exists in a configured conflicting campaign", () => {
    const input = baseInput({
      criteria: { conflictsWithCampaignIds: ["rival"] },
      existingTasks: [{ campaignId: "rival", state: "PENDING" }],
    });
    expect(rules.notInConflictingActiveCampaign(input).passed).toBe(false);
  });
  it("passes when the conflicting campaign's task is already terminal", () => {
    const input = baseInput({
      criteria: { conflictsWithCampaignIds: ["rival"] },
      existingTasks: [{ campaignId: "rival", state: "COMPLETED" }],
    });
    expect(rules.notInConflictingActiveCampaign(input).passed).toBe(true);
  });
  it("passes with no conflicts configured", () => {
    expect(rules.notInConflictingActiveCampaign(baseInput()).passed).toBe(true);
  });
});

describe("matchesCampaignCriteria", () => {
  it("passes with no criteria configured", () => {
    expect(rules.matchesCampaignCriteria(baseInput()).passed).toBe(true);
  });
  it("fails when risk level doesn't match", () => {
    const input = baseInput({ criteria: { riskLevels: ["HIGH", "CRITICAL"] } });
    expect(rules.matchesCampaignCriteria(input).passed).toBe(false);
  });
  it("passes when a condition code matches", () => {
    const input = baseInput({ criteria: { conditionCodes: ["Type 2 Diabetes Mellitus"] } });
    expect(rules.matchesCampaignCriteria(input).passed).toBe(true);
  });
  it("fails when no condition code matches", () => {
    const input = baseInput({ criteria: { conditionCodes: ["Sepsis"] } });
    expect(rules.matchesCampaignCriteria(input).passed).toBe(false);
  });
});

describe("evaluateAllRules", () => {
  it("runs every rule even after an earlier one fails — full breakdown, not fail-fast", () => {
    const input = baseInput({ patient: { ...baseInput().patient, phone: "000-000-0000" }, criteria: { riskLevels: ["HIGH"] } });
    const results = evaluateAllRules(input);
    expect(results.length).toBe(8);
    expect(results.find((r) => r.ruleId === "hasUsableContact")?.passed).toBe(false);
    expect(results.find((r) => r.ruleId === "matchesCampaignCriteria")?.passed).toBe(false);
    // Rules unrelated to the failures still ran and passed.
    expect(results.find((r) => r.ruleId === "dischargedWithinWindow")?.passed).toBe(true);
  });

  it("an all-pass input is ELIGIBLE by every rule", () => {
    const results = evaluateAllRules(baseInput());
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
