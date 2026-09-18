// Doc 12 R1 — the fixed, versioned TriageResult schema. Built here as a
// prerequisite for doc 13 (escalation consensus), which consumes this
// shape from all three assessors; doc 12's own LLM-calling pipeline and
// validation/repair loop (R3-R7) are built out when doc 12 lands.

import { z } from "zod";

export const SCHEMA_VERSION = "1.0";

export const ClassificationSchema = z.enum(["routine", "concerning", "urgent", "uncertain"]);
export type Classification = z.infer<typeof ClassificationSchema>;

export const TranscriptRefSchema = z.object({
  turn_index: z.number().int().min(0),
  quote_span: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
});

export const ObservationSchema = z.object({
  code: z.string().min(1),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  reported_by: z.enum(["patient", "carer"]),
  transcript_ref: TranscriptRefSchema,
});

export const IndicatorSchema = z.object({
  indicator_id: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["low", "moderate", "high"]),
  evidence: z.object({ turn_index: z.number().int().min(0), excerpt: z.string().min(1) }),
  protocol_reference: z.object({
    chunk_id: z.string().min(1),
    protocol_id: z.string().min(1),
    version: z.string().min(1),
  }),
});

export const TriageResultSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  assessor_id: z.string().min(1), // "claude-triage-v1" | "gpt-triage-v1" | "rule-engine-v1"
  classification: ClassificationSchema,
  confidence: z.number().min(0).max(1),
  observations: z.array(ObservationSchema).default([]),
  indicators: z.array(IndicatorSchema).default([]),
  missing_information: z.array(z.string()).default([]),
  escalation_recommended: z.boolean(),
  escalation_reason: z.string().optional(),
  reasoning_summary: z.string().max(400),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

/**
 * Doc 13 §4 "ASSESSOR_FAILURE" — an assessor that never produced a usable
 * TriageResult (provider error, exhausted repair attempts) is a distinct,
 * explicit outcome the consensus algorithm reads as its own severity tier
 * (doc 13 rule 4), never silently dropped or defaulted to "routine".
 */
export interface AssessorFailure {
  assessorId: string;
  status: "failed";
  errorDetail: string;
}

export interface AssessorSuccess {
  assessorId: string;
  status: "completed";
  result: TriageResult;
}

export type AssessorOutcome = AssessorSuccess | AssessorFailure;
