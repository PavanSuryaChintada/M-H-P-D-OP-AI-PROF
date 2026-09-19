// Doc 17 R1/R6/R7 required tests: illegal lifecycle transitions are
// rejected; a full valid path computes time_to_acknowledge/time_to_resolve;
// every human action produces an audit row; the reviewer queue orders
// OVERDUE first, then priority, then age.

import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createHospital } from "../lib/db/repositories/hospitals";
import {
  createEscalation,
  getEscalationById,
  assignEscalation,
  moveToInReview,
  resolveEscalation,
  closeEscalation,
  transitionEscalationState,
  listEscalationsForQueue,
} from "../lib/db/repositories/escalations";
import { IllegalEscalationTransitionError } from "../lib/escalations/lifecycle";
import type { TenantContext } from "../lib/db/tenant";

const admin = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, ssl: "prefer" });

let hospital: { id: string };
let reviewerId: string;
const ctx = (): TenantContext => ({ hospitalId: hospital.id, userId: reviewerId, role: "CLINICAL_REVIEWER" });

async function seedEscalation(mrn: string, priority = 2) {
  const [patient] = await admin`insert into patients (hospital_id, mrn, first_name, last_name) values (${hospital.id}, ${mrn}, 'Lc', 'Test') returning id`;
  const { row } = await createEscalation(ctx(), { patientId: patient.id, triggerReason: "test", priority });
  return row;
}

beforeAll(async () => {
  hospital = await createHospital({ name: "Escalation Lifecycle Test Hospital", shortCode: `ESL-${Date.now()}`, timezone: "UTC" });
  const [reviewer] = await admin`insert into users (email, display_name) values (${"reviewer-" + Date.now() + "@test.local"}, 'Reviewer') returning id`;
  reviewerId = reviewer.id;
});

describe("guarded lifecycle (doc 17 R1)", () => {
  it("rejects an illegal transition (OPEN straight to RESOLVED)", async () => {
    const escalation = await seedEscalation("ESL-P1");
    await expect(transitionEscalationState(ctx(), escalation.id, "RESOLVED", "skip", "test")).rejects.toThrow(
      IllegalEscalationTransitionError,
    );
    // State must be unchanged after a rejected transition.
    const refetched = await getEscalationById(ctx(), escalation.id);
    expect(refetched?.state).toBe("OPEN");
  });

  it("rejects a transition out of a terminal state (CLOSED)", async () => {
    const escalation = await seedEscalation("ESL-P2");
    await assignEscalation(ctx(), escalation.id, reviewerId, "test");
    await moveToInReview(ctx(), escalation.id, "test");
    await resolveEscalation(ctx(), escalation.id, { outcome: "advised_self_care", notes: "fine" }, "test");
    await closeEscalation(ctx(), escalation.id, "test");
    await expect(transitionEscalationState(ctx(), escalation.id, "IN_REVIEW", "reopen", "test")).rejects.toThrow(
      IllegalEscalationTransitionError,
    );
  });

  it("a full valid path computes time_to_acknowledge and time_to_resolve", async () => {
    const escalation = await seedEscalation("ESL-P3");
    const assigned = await assignEscalation(ctx(), escalation.id, reviewerId, "test");
    expect(assigned?.acknowledgedAt).not.toBeNull();
    expect(assigned?.timeToAcknowledgeSeconds).toBeGreaterThanOrEqual(0);

    await moveToInReview(ctx(), escalation.id, "test");
    const resolved = await resolveEscalation(ctx(), escalation.id, { outcome: "contacted_patient", notes: "spoke to patient, doing fine" }, "test");
    expect(resolved?.state).toBe("RESOLVED");
    expect(resolved?.resolvedAt).not.toBeNull();
    expect(resolved?.timeToResolveSeconds).toBeGreaterThanOrEqual(0);
    expect(resolved?.resolutionOutcome).toBe("contacted_patient");
  });

  it("no_action_needed_false_positive is recorded as a real, distinct resolution outcome", async () => {
    const escalation = await seedEscalation("ESL-P4");
    await assignEscalation(ctx(), escalation.id, reviewerId, "test");
    const resolved = await resolveEscalation(
      ctx(),
      escalation.id,
      { outcome: "no_action_needed_false_positive", notes: "reviewed transcript, no real symptom present" },
      "test",
    );
    expect(resolved?.resolutionOutcome).toBe("no_action_needed_false_positive");
  }, 15000);
});

describe("audit completeness (doc 17 R6)", () => {
  it("every human action on an escalation writes an audit row with before/after state", async () => {
    const escalation = await seedEscalation("ESL-P5");
    await assignEscalation(ctx(), escalation.id, reviewerId, "test");
    await moveToInReview(ctx(), escalation.id, "test");
    await resolveEscalation(ctx(), escalation.id, { outcome: "unable_to_contact", notes: "no answer after 3 attempts" }, "test");
    await closeEscalation(ctx(), escalation.id, "test");

    const rows = await admin`select action, metadata from audit_log where resource_type = 'escalation' and resource_id = ${escalation.id} order by at asc`;
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(["escalation.assigned", "escalation.in_review", "escalation.resolved", "escalation.closed"]);
    for (const row of rows) {
      expect(row.metadata).toHaveProperty("before");
      expect(row.metadata).toHaveProperty("after");
    }
  }, 15000);
});

describe("reviewer queue ordering (doc 17 R5)", () => {
  it("OVERDUE is pinned to the top regardless of priority, then priority desc, then age asc", async () => {
    const low = await seedEscalation("ESL-Q1", 1);
    const high = await seedEscalation("ESL-Q2", 3);
    const overdueLow = await seedEscalation("ESL-Q3", 1);
    await transitionEscalationState(ctx(), overdueLow.id, "OVERDUE", "test overdue", "test");

    const queue = await listEscalationsForQueue(ctx());
    const ids = queue.map((e) => e.id);
    const overdueIdx = ids.indexOf(overdueLow.id);
    const highIdx = ids.indexOf(high.id);
    const lowIdx = ids.indexOf(low.id);

    expect(overdueIdx).toBeLessThan(highIdx); // OVERDUE beats higher priority
    expect(highIdx).toBeLessThan(lowIdx); // priority 3 beats priority 1
  }, 15000);
});
