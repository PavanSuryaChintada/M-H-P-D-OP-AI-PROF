// Doc 15 R1 — EHRClient interface. A real client (Epic/Cerner FHIR API,
// etc.) could implement this same interface without any caller changing —
// that replaceability is the point of the abstraction (PRD §6).

import type { TenantContext } from "../db/tenant";

export interface FHIRPatient { resourceType: "Patient"; id: string; [key: string]: unknown }
export interface FHIREncounter { resourceType: "Encounter"; id: string; [key: string]: unknown }
export interface FHIRCondition { resourceType: "Condition"; id: string; [key: string]: unknown }
export interface FHIRCarePlan { resourceType: "CarePlan"; id: string; [key: string]: unknown }

export interface WriteResult {
  resourceType: string;
  id: string;
  status: "success";
  replayed: boolean;
}

/** Thrown by MockEHRClient for both injected failures and real HTTP-shaped errors — R3/R6. */
export class EHRCallError extends Error {
  constructor(public readonly status: number, public readonly reason: string) {
    super(`EHR call failed (${status}): ${reason}`);
    this.name = "EHRCallError";
  }
}

export interface WriteCommunicationInput {
  patientId: string;
  encounterId?: string;
  channel?: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
}

export interface WriteObservationInput {
  patientId: string;
  encounterId?: string;
  code: string;
  value?: unknown;
  effectiveAt?: string;
}

export interface CreateTaskInput {
  patientId: string;
  encounterId?: string;
  description: string;
  status?: string;
  dueAt?: string;
}

export interface WriteEncounterNoteInput {
  patientId: string;
  encounterId?: string;
  note: string;
}

export interface EHRClient {
  getPatient(ctx: TenantContext, patientId: string): Promise<FHIRPatient>;
  getEncounter(ctx: TenantContext, encounterId: string): Promise<FHIREncounter>;
  getConditions(ctx: TenantContext, patientId: string): Promise<FHIRCondition[]>;
  getCarePlan(ctx: TenantContext, patientId: string): Promise<FHIRCarePlan | null>;
  writeCommunication(ctx: TenantContext, payload: WriteCommunicationInput, idempotencyKey: string): Promise<WriteResult>;
  writeObservation(ctx: TenantContext, payload: WriteObservationInput, idempotencyKey: string): Promise<WriteResult>;
  createTask(ctx: TenantContext, payload: CreateTaskInput, idempotencyKey: string): Promise<WriteResult>;
  writeEncounterNote(ctx: TenantContext, payload: WriteEncounterNoteInput, idempotencyKey: string): Promise<WriteResult>;
}
