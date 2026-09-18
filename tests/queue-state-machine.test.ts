// Doc 07 §1 — illegal transitions throw; legal ones per the diagram don't.

import { describe, expect, it } from "vitest";
import { isValidTaskTransition, assertValidTaskTransition, IllegalTaskTransitionError } from "../lib/queue/state-machine";

describe("outreach task state machine", () => {
  it("allows the documented outcome paths", () => {
    expect(isValidTaskTransition("PENDING", "CALLING")).toBe(true);
    expect(isValidTaskTransition("CALLING", "NO_ANSWER")).toBe(true);
    expect(isValidTaskTransition("NO_ANSWER", "RETRY_SCHEDULED")).toBe(true);
    expect(isValidTaskTransition("RETRY_SCHEDULED", "CALLING")).toBe(true);
    expect(isValidTaskTransition("CALLING", "INVALID_NUMBER")).toBe(true);
    expect(isValidTaskTransition("INVALID_NUMBER", "MANUAL_FOLLOW_UP")).toBe(true);
    expect(isValidTaskTransition("CALLING", "DECLINED")).toBe(true);
    expect(isValidTaskTransition("DECLINED", "COMPLETED")).toBe(true);
    expect(isValidTaskTransition("CONNECTED", "CALLBACK_SCHEDULED")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(isValidTaskTransition("PENDING", "COMPLETED")).toBe(false);
    expect(isValidTaskTransition("COMPLETED", "CALLING")).toBe(false); // terminal
    expect(isValidTaskTransition("MANUAL_FOLLOW_UP", "CALLING")).toBe(false); // terminal
    expect(isValidTaskTransition("DECLINED", "RETRY_SCHEDULED")).toBe(false); // declined never retries
  });

  it("assertValidTaskTransition throws IllegalTaskTransitionError on a bad move", () => {
    expect(() => assertValidTaskTransition("COMPLETED", "CALLING")).toThrow(IllegalTaskTransitionError);
  });

  it("the reaper's CALLING/CONNECTED -> RETRY_SCHEDULED path (lease expiry) is legal", () => {
    expect(isValidTaskTransition("CALLING", "RETRY_SCHEDULED")).toBe(true);
    expect(isValidTaskTransition("CONNECTED", "RETRY_SCHEDULED")).toBe(true);
  });
});
