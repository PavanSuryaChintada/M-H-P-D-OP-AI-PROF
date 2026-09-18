// Doc 05 R1 — the state machine, pure, no database.

import { describe, expect, it } from "vitest";
import { isValidTransition, assertValidTransition, InvalidTransitionError, eventNameForTransition } from "../lib/campaigns/lifecycle";

describe("campaign lifecycle transitions", () => {
  it("allows the documented forward path", () => {
    expect(isValidTransition("DRAFT", "READY")).toBe(true);
    expect(isValidTransition("READY", "SCHEDULED")).toBe(true);
    expect(isValidTransition("SCHEDULED", "RUNNING")).toBe(true);
    expect(isValidTransition("RUNNING", "PAUSED")).toBe(true);
    expect(isValidTransition("PAUSED", "RUNNING")).toBe(true);
    expect(isValidTransition("RUNNING", "COMPLETED")).toBe(true);
  });

  it("allows READY to jump straight to RUNNING (skipping SCHEDULED is legitimate, not every campaign needs a future start date)", () => {
    expect(isValidTransition("READY", "RUNNING")).toBe(true);
  });

  it("rejects skipping states or moving out of a terminal state", () => {
    expect(isValidTransition("DRAFT", "RUNNING")).toBe(false);
    expect(isValidTransition("DRAFT", "SCHEDULED")).toBe(false);
    expect(isValidTransition("COMPLETED", "RUNNING")).toBe(false);
    expect(isValidTransition("CANCELLED", "DRAFT")).toBe(false);
  });

  it("assertValidTransition throws InvalidTransitionError for a disallowed move", () => {
    expect(() => assertValidTransition("COMPLETED", "RUNNING")).toThrow(InvalidTransitionError);
  });

  it("maps transitions to the correct event names", () => {
    expect(eventNameForTransition("SCHEDULED", "RUNNING")).toBe("campaign.started");
    expect(eventNameForTransition("PAUSED", "RUNNING")).toBe("campaign.resumed");
    expect(eventNameForTransition("RUNNING", "PAUSED")).toBe("campaign.paused");
    expect(eventNameForTransition("RUNNING", "COMPLETED")).toBe("campaign.completed");
    expect(eventNameForTransition("DRAFT", "CANCELLED")).toBe(null);
  });
});
