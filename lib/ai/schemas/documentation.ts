// Doc 14 R2 — DocumentationRecord, exactly as specified. Split into what
// the model actually produces (ModelDocumentationOutputSchema — the
// summary, symptoms, and follow-up actions it can observe from the
// transcript/triage) versus the full record (DocumentationRecordSchema),
// whose ids, counts, and status fields are known to the orchestrating code,
// not the model — asking the model to invent a call_id or ehr_sync_status
// would just be another surface for fabrication.

import { z } from "zod";

export const TranscriptRefSchema = z.object({
  turn_index: z.number().int().min(0),
  quote_span: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
});

export const PatientReportedSymptomSchema = z.object({
  symptom: z.string().min(1),
  severity_reported: z.string().optional(),
  transcript_ref: TranscriptRefSchema,
});

export const FollowUpActionSchema = z.object({
  action: z.string().min(1),
  owner_role: z.string().min(1),
  due_by: z.string().optional(),
});

/** What the model returns — the pipeline fills in the rest (see run-documentation.ts). */
export const ModelDocumentationOutputSchema = z.object({
  summary: z.string().max(600),
  patient_reported_symptoms: z.array(PatientReportedSymptomSchema),
  follow_up_actions: z.array(FollowUpActionSchema),
});
export type ModelDocumentationOutput = z.infer<typeof ModelDocumentationOutputSchema>;

export const DocumentationRecordSchema = z.object({
  schema_version: z.literal("1.0"),
  call_id: z.uuid(),
  patient_id: z.uuid(),
  campaign_id: z.uuid(),
  hospital_id: z.uuid(),
  outcome: z.string(),
  summary: z.string().max(600),
  patient_reported_symptoms: z.array(PatientReportedSymptomSchema),
  observations_recorded: z.array(z.string()),
  questions_answered: z.number().int().min(0),
  questions_total: z.number().int().min(0),
  triage_result_id: z.uuid().optional(),
  escalation_id: z.uuid().optional(),
  follow_up_actions: z.array(FollowUpActionSchema),
  ehr_sync_status: z.enum(["pending", "synced", "failed"]),
  generated_by: z.object({ model: z.string(), prompt_version: z.string() }),
});
export type DocumentationRecord = z.infer<typeof DocumentationRecordSchema>;
