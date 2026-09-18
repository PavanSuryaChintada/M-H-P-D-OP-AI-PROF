// Doc 08 R1 — the fixture's composition is spec'd exactly; this test
// guards against silent drift if someone edits the JSON later.

import { describe, expect, it } from "vitest";
import fixture from "../sim/fixtures/queue-sim-patients.json";

describe("queue-sim-patients fixture", () => {
  const patients = fixture.patients;

  it("has 28 patients (see fixture's _note on the 26-vs-28 spec discrepancy)", () => {
    expect(patients.length).toBe(28);
  });

  it("risk breakdown is 6 low / 10 medium / 8 high / 4 critical", () => {
    const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const p of patients) counts[p.riskLevel as keyof typeof counts]++;
    expect(counts).toEqual({ LOW: 6, MEDIUM: 10, HIGH: 8, CRITICAL: 4 });
  });

  it("has 4 near-deadline, 3 callback, 3 invalid-number, 4 drop-mid-call, 2 red-flag patients", () => {
    const count = (key: string) => patients.filter((p) => (p as Record<string, unknown>)[key] === true).length;
    expect(count("nearDeadline")).toBe(4);
    expect(count("willRequestCallback")).toBe(3);
    expect(count("invalidNumber")).toBe(3);
    expect(count("willDropMidCall")).toBe(4);
    expect(count("willPresentRedFlag")).toBe(2);
  });

  it("every mrn is unique", () => {
    const mrns = new Set(patients.map((p) => p.mrn));
    expect(mrns.size).toBe(patients.length);
  });

  it("every patient belongs to campaign A or B", () => {
    for (const p of patients) expect(["A", "B"]).toContain(p.campaign);
  });

  it("campaigns are weighted 7/3", () => {
    const weights = Object.fromEntries(fixture.campaigns.map((c) => [c.key, c.weight]));
    expect(weights).toEqual({ A: 7, B: 3 });
  });
});
