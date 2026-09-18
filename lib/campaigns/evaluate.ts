// Doc 05 orchestration — wires the pure rule engine (eligibility.ts) to the
// database. Kept separate from eligibility.ts so the rules stay unit
// testable with zero DB/IO.

import type { TenantContext } from "../db/tenant";
import { getPatientById, listPatients } from "../db/repositories/patients";
import { listEncountersForPatient } from "../db/repositories/encounters";
import { listConditionsForPatient } from "../db/repositories/clinical";
import { listOutreachTasksForPatient } from "../db/repositories/outreach-tasks";
import { upsertEvaluation } from "../db/repositories/eligibility";
import { evaluateAllRules, type EligibilityCriteria, type EligibilityInput } from "./eligibility";
import type { campaigns } from "../db/schema";

type Campaign = typeof campaigns.$inferSelect;

/** null only when the patient has no discharge encounter yet — a real, existing patient. A patient that doesn't exist at all is checked separately by the caller, before this is ever reached: eligibility_evaluations.patient_id has a hard FK, so there is nothing valid to persist for an id that isn't a real row. */
async function buildInput(
  ctx: TenantContext,
  campaign: Campaign,
  patient: NonNullable<Awaited<ReturnType<typeof getPatientById>>>,
  now: Date,
): Promise<EligibilityInput | null> {
  const patientId = patient.id;
  const encounters = await listEncountersForPatient(ctx, patientId);
  const mostRecent = encounters
    .filter((e) => e.dischargeAt)
    .sort((a, b) => (b.dischargeAt as Date).getTime() - (a.dischargeAt as Date).getTime())[0];
  if (!mostRecent) return null;

  const [conditions, existingTasks] = await Promise.all([
    listConditionsForPatient(ctx, patientId),
    listOutreachTasksForPatient(ctx, patientId),
  ]);

  return {
    patient: {
      id: patient.id,
      phone: patient.phone,
      communicationPreferences: patient.communicationPreferences as EligibilityInput["patient"]["communicationPreferences"],
      sourcePayload: patient.sourcePayload as EligibilityInput["patient"]["sourcePayload"],
    },
    encounter: {
      dischargeAt: mostRecent.dischargeAt as Date,
      riskLevel: mostRecent.riskLevel,
      careSetting: mostRecent.careSetting,
      followUpWindowHours: mostRecent.followUpWindowHours ?? campaign.followUpWindowHours,
    },
    conditions: conditions.map((c) => ({ codeText: c.codeText })),
    campaignId: campaign.id,
    criteria: (campaign.eligibilityCriteria as EligibilityCriteria) ?? {},
    now,
    existingTasks: existingTasks.map((t) => ({ campaignId: t.campaignId, state: t.state })),
  };
}

export interface PatientEvaluationResult {
  patientId: string;
  status: "ELIGIBLE" | "INELIGIBLE" | "ERROR";
}

/**
 * R6 — always persists an outcome, even ERROR, for any patient that
 * actually exists. Never throws past this point for such a patient; one
 * the rule engine can't evaluate still shows up, in the recovery list.
 *
 * Returns null if patientId doesn't correspond to a real patient — the
 * FK on eligibility_evaluations.patient_id means there is no valid ERROR
 * row to write for an id that was never real. Callers (route handlers)
 * turn null into 404; this is a caller-input problem, not something R6's
 * "never silently drop a patient" is about (there is no patient here to drop).
 */
export async function evaluatePatientForCampaign(
  ctx: TenantContext,
  campaign: Campaign,
  patientId: string,
  now: Date = new Date(),
): Promise<PatientEvaluationResult | null> {
  const patient = await getPatientById(ctx, patientId);
  if (!patient) return null;

  try {
    const input = await buildInput(ctx, campaign, patient, now);
    if (!input) {
      await upsertEvaluation(ctx, {
        campaignId: campaign.id,
        patientId,
        status: "INELIGIBLE",
        ruleResults: [{ ruleId: "hasEncounter", passed: false, reason: "no discharge encounter on record" }],
      });
      return { patientId, status: "INELIGIBLE" };
    }

    const ruleResults = evaluateAllRules(input);
    const status = ruleResults.every((r) => r.passed) ? "ELIGIBLE" : "INELIGIBLE";
    await upsertEvaluation(ctx, { campaignId: campaign.id, patientId, status, ruleResults });
    return { patientId, status };
  } catch (err) {
    await upsertEvaluation(ctx, {
      campaignId: campaign.id,
      patientId,
      status: "ERROR",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { patientId, status: "ERROR" };
  }
}

/** R4 — resume recomputes for every patient at the hospital rather than replaying the old task list. Demo-scale (a few hundred patients) — fine sequential-per-patient with the internal Promise.all fan-out already done by buildInput. */
export async function evaluateCampaignEligibility(
  ctx: TenantContext,
  campaign: Campaign,
): Promise<PatientEvaluationResult[]> {
  const allPatients = await listPatients(ctx);
  const results: PatientEvaluationResult[] = [];
  const concurrency = 10;
  let next = 0;
  async function lane() {
    while (next < allPatients.length) {
      const patient = allPatients[next++];
      // Never null here — patient.id came from listPatients() itself, so
      // the row is guaranteed to exist.
      const result = await evaluatePatientForCampaign(ctx, campaign, patient.id);
      if (result) results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, allPatients.length) }, lane));
  return results;
}
