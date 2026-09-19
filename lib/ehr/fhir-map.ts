// Doc 15 R2 — FHIR-shaped GET responses. Doc 04's ingestion already stores
// the original FHIR payload in each table's source_payload column when a
// resource arrived via a hospital feed — reuse it verbatim when present,
// and only synthesize a minimal resource for rows created some other way
// (e.g. seeded demo data).

import type { FHIRPatient, FHIREncounter, FHIRCondition, FHIRCarePlan } from "./types";

export function patientToFHIR(row: {
  id: string;
  firstName: string;
  lastName: string;
  mrn: string;
  dob: string | null;
  sourcePayload: unknown;
}): FHIRPatient {
  if (row.sourcePayload) return row.sourcePayload as FHIRPatient;
  return {
    resourceType: "Patient",
    id: row.id,
    identifier: [{ value: row.mrn }],
    name: [{ text: `${row.firstName} ${row.lastName}` }],
    birthDate: row.dob ?? undefined,
  };
}

export function encounterToFHIR(row: {
  id: string;
  patientId: string;
  careSetting: string | null;
  admissionAt: Date | null;
  dischargeAt: Date | null;
  sourcePayload: unknown;
}): FHIREncounter {
  if (row.sourcePayload) return row.sourcePayload as FHIREncounter;
  return {
    resourceType: "Encounter",
    id: row.id,
    status: row.dischargeAt ? "finished" : "in-progress",
    subject: { reference: `Patient/${row.patientId}` },
    class: row.careSetting ?? undefined,
    period: { start: row.admissionAt?.toISOString(), end: row.dischargeAt?.toISOString() },
  };
}

export function conditionToFHIR(row: {
  id: string;
  patientId: string;
  codeText: string;
  clinicalStatus: string | null;
  sourcePayload: unknown;
}): FHIRCondition {
  if (row.sourcePayload) return row.sourcePayload as FHIRCondition;
  return {
    resourceType: "Condition",
    id: row.id,
    code: { text: row.codeText },
    clinicalStatus: row.clinicalStatus ?? undefined,
    subject: { reference: `Patient/${row.patientId}` },
  };
}

export function carePlanToFHIR(row: {
  id: string;
  patientId: string;
  title: string;
  description: string | null;
  status: string | null;
  sourcePayload: unknown;
}): FHIRCarePlan {
  if (row.sourcePayload) return row.sourcePayload as FHIRCarePlan;
  return {
    resourceType: "CarePlan",
    id: row.id,
    status: row.status ?? "unknown",
    title: row.title,
    description: row.description ?? undefined,
    subject: { reference: `Patient/${row.patientId}` },
  };
}
