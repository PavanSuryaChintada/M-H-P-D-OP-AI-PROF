// Doc 09 §5 — one purpose-built context builder per agent. Never pass the
// whole patient history; each builder assembles only the fields that
// agent's spec names. This is both a cost decision and a safety one —
// irrelevant history is a hallucination surface. Every builder returns its
// approximate size (chars/4 ~= tokens) so callers can log it per call, per
// §5's "log the context size per call."

import { getPatientById } from "../../db/repositories/patients";
import { getEncounterById } from "../../db/repositories/encounters";
import { listConditionsForPatient, listMedicationsForPatient } from "../../db/repositories/clinical";
import { listOutreachTasksForPatient } from "../../db/repositories/outreach-tasks";
import { getMostRecentCallForTask } from "../../db/repositories/calls";
import type { TenantContext } from "../../db/tenant";

function estimateTokens(obj: unknown): number {
  return Math.ceil(JSON.stringify(obj).length / 4);
}

export interface IntakeContext {
  patient: { firstName: string; lastName: string; preferredLanguage: string | null };
  encounter: { dischargeInstructions: string | null; riskLevel: string | null; dischargeAt: Date | null } | null;
  lastOutreachOutcome: string | null;
  partialState: unknown;
  contextTokens: number;
}

/** Doc 09 §5 — intake: demographics, discharge summary, last outreach outcome, partial_state. Protocol follow-up questions are attached by the caller once doc 11's retrieval exists; this builder doesn't fetch them itself to avoid duplicating doc 11's retrieval logic here. */
export async function buildIntakeContext(
  ctx: TenantContext,
  patientId: string,
  encounterId: string | undefined,
  partialState: unknown,
): Promise<IntakeContext> {
  const [patient, encounter, priorTasks] = await Promise.all([
    getPatientById(ctx, patientId),
    encounterId ? getEncounterById(ctx, encounterId) : Promise.resolve(null),
    listOutreachTasksForPatient(ctx, patientId),
  ]);
  if (!patient) throw new Error("patient not found");

  const mostRecentTask = priorTasks.at(-1);
  const lastCall = mostRecentTask ? await getMostRecentCallForTask(ctx, mostRecentTask.id) : null;

  const result: IntakeContext = {
    patient: {
      firstName: patient.firstName,
      lastName: patient.lastName,
      preferredLanguage: patient.preferredLanguage,
    },
    encounter: encounter
      ? {
          dischargeInstructions: encounter.dischargeInstructions,
          riskLevel: encounter.riskLevel,
          dischargeAt: encounter.dischargeAt,
        }
      : null,
    lastOutreachOutcome: lastCall?.outcome ?? null,
    partialState,
    contextTokens: 0,
  };
  result.contextTokens = estimateTokens(result);
  return result;
}

export interface TriageContext {
  transcript: { role: string; text: string }[];
  retrievedChunks: { sourceLabel: string; content: string }[];
  activeConditions: string[];
  currentMedications: string[];
  contextTokens: number;
}

/** Doc 09 §5 — triage: transcript + retrieved chunks + active conditions + current medications. transcript/retrievedChunks are supplied by the caller (doc 10's call record, doc 11's retrieval) since this builder's job is scoping the CLINICAL side, not owning the conversation or retrieval pipelines. */
export async function buildTriageContext(
  ctx: TenantContext,
  patientId: string,
  transcript: { role: string; text: string }[],
  retrievedChunks: { sourceLabel: string; content: string }[],
): Promise<TriageContext> {
  const [conditions, medications] = await Promise.all([
    listConditionsForPatient(ctx, patientId),
    listMedicationsForPatient(ctx, patientId),
  ]);

  const result: TriageContext = {
    transcript,
    retrievedChunks,
    activeConditions: conditions.map((c) => c.codeText),
    currentMedications: medications.map((m) => m.name),
    contextTokens: 0,
  };
  result.contextTokens = estimateTokens(result);
  return result;
}

export interface DocumentationContext {
  transcript: { role: string; text: string }[];
  triage: unknown;
  escalation: unknown;
  outcome: string;
  contextTokens: number;
}

/** Doc 09 §5 — documentation: transcript + triage + escalation + outcome. All four inputs come from the call/triage/escalation records the caller (doc 14) already holds — this builder only shapes and sizes them. */
export function buildDocumentationContext(
  transcript: { role: string; text: string }[],
  triage: unknown,
  escalation: unknown,
  outcome: string,
): DocumentationContext {
  const result: DocumentationContext = { transcript, triage, escalation, outcome, contextTokens: 0 };
  result.contextTokens = estimateTokens(result);
  return result;
}
