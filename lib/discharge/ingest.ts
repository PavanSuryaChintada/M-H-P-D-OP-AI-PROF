// Doc 04 R4/R5/R6 — the shared pipeline behind both the HTTP batch endpoint
// and the demo data generator (sim/generate-patients.ts calls this directly,
// skipping HTTP, since seeding ~450 patients one HTTP round trip at a time
// isn't what a "batch endpoint" is for).

import type { TenantContext } from "../db/tenant";
import type { DischargeRecord } from "./schema";
import { findEncounterBySourceMessageId, createEncounter } from "../db/repositories/encounters";
import { findPatientByMrn, createPatient } from "../db/repositories/patients";
import {
  createCondition,
  createObservation,
  createMedication,
  createCarePlan,
} from "../db/repositories/clinical";
import { emitEvent } from "../db/repositories/events";

export interface IngestResult {
  status: "created" | "already_ingested";
  patientId: string;
  encounterId: string;
}

export async function ingestDischargeRecord(
  ctx: TenantContext,
  record: DischargeRecord,
): Promise<IngestResult> {
  // R5 — idempotent on sourceMessageId. Re-posting the same discharge is a
  // no-op that still reports success, not a duplicate and not a rejection.
  const existing = await findEncounterBySourceMessageId(ctx, record.sourceMessageId);
  if (existing) {
    return { status: "already_ingested", patientId: existing.patientId, encounterId: existing.id };
  }

  let patient = await findPatientByMrn(ctx, record.patient.mrn);
  const patientIsNew = !patient;
  if (!patient) {
    patient = await createPatient(ctx, record.patient);
  }

  const encounter = await createEncounter(ctx, {
    patientId: patient.id,
    careSetting: record.encounter.careSetting,
    admissionAt: record.encounter.admissionAt ? new Date(record.encounter.admissionAt) : undefined,
    dischargeAt: new Date(record.encounter.dischargeAt),
    dischargeInstructions: record.encounter.dischargeInstructions,
    riskLevel: record.riskLevel,
    followUpWindowHours: record.followUpWindowHours,
    sourceMessageId: record.sourceMessageId,
  });

  await Promise.all([
    ...record.conditions.map((c) =>
      createCondition(ctx, { patientId: patient.id, encounterId: encounter.id, ...c }),
    ),
    ...record.observations.map((o) =>
      createObservation(ctx, {
        patientId: patient.id,
        encounterId: encounter.id,
        code: o.code,
        value: o.value,
        effectiveAt: o.effectiveAt ? new Date(o.effectiveAt) : undefined,
      }),
    ),
    ...record.medications.map((m) =>
      createMedication(ctx, { patientId: patient.id, encounterId: encounter.id, ...m }),
    ),
    record.carePlan
      ? createCarePlan(ctx, { patientId: patient.id, encounterId: encounter.id, ...record.carePlan })
      : Promise.resolve(),
  ]);

  // R6 — emitted after the writes succeed, each idempotency-keyed off the
  // discharge's own sourceMessageId (or mrn, for the import event) so a
  // retried ingest can't double-emit either.
  if (patientIsNew) {
    await emitEvent(ctx, {
      type: "patient.imported",
      payload: { patientId: patient.id, mrn: patient.mrn },
      idempotencyKey: `patient.imported:${ctx.hospitalId}:${patient.mrn}`,
    });
  }
  await emitEvent(ctx, {
    type: "discharge.ingested",
    payload: { patientId: patient.id, encounterId: encounter.id, sourceMessageId: record.sourceMessageId },
    idempotencyKey: `discharge.ingested:${ctx.hospitalId}:${record.sourceMessageId}`,
  });

  return { status: "created", patientId: patient.id, encounterId: encounter.id };
}
