// Doc 17 R3 — "the review screen must contain everything needed to decide
// without leaving the page." One aggregator, one round trip's worth of
// repository calls, assembled server-side so the frontend never has to
// stitch together five separate fetches (or worse, silently render a page
// missing one of R3's required sections).

import { getEscalationById, listAssessmentsForEscalation } from "../db/repositories/escalations";
import { getPatientById } from "../db/repositories/patients";
import { getEncounterById } from "../db/repositories/encounters";
import { getTaskById } from "../db/repositories/outreach-tasks";
import { listConditionsForPatient, listMedicationsForPatient, listCarePlansForPatient } from "../db/repositories/clinical";
import { getCallById, listCallsForPatient } from "../db/repositories/calls";
import { listCallTurns } from "../db/repositories/call-turns";
import type { TenantContext } from "../db/tenant";

export async function getEscalationReviewData(ctx: TenantContext, escalationId: string) {
  const escalation = await getEscalationById(ctx, escalationId);
  if (!escalation) return null;

  const [patient, assessments, call, previousCalls, task] = await Promise.all([
    getPatientById(ctx, escalation.patientId),
    listAssessmentsForEscalation(ctx, escalationId),
    escalation.callId ? getCallById(ctx, escalation.callId) : Promise.resolve(null),
    listCallsForPatient(ctx, escalation.patientId),
    escalation.outreachTaskId ? getTaskById(ctx, escalation.outreachTaskId) : Promise.resolve(null),
  ]);

  const [conditions, medications, carePlans, transcript, encounter] = await Promise.all([
    listConditionsForPatient(ctx, escalation.patientId),
    listMedicationsForPatient(ctx, escalation.patientId),
    listCarePlansForPatient(ctx, escalation.patientId),
    call ? listCallTurns(ctx, call.id) : Promise.resolve([]),
    task?.encounterId ? getEncounterById(ctx, task.encounterId) : Promise.resolve(null),
  ]);

  return {
    escalation,
    patient,
    encounter, // R3 — "discharge date and instructions"
    conditions,
    medications,
    carePlans,
    call,
    transcript, // R3 — highlighting indicator-triggering turns is the frontend's job, using assessments[].evidence.turn_index
    assessments, // R3 — "three assessments side by side," each already carries its own evidence/protocol_reference
    consensusResult: escalation.consensusResult, // R3 — "the firing consensus rule labelled"
    previousOutreachHistory: previousCalls.filter((c) => c.id !== call?.id),
  };
}
