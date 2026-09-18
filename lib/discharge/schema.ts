// Doc 04 R3/R4 — the wire format one hospital feed record must match.
// FHIR-shaped, not FHIR-conformant: enough structure for the queue/AI
// pipeline to work with, not a claim of interoperability compliance.

import { z } from "zod";

export const ConditionInputSchema = z.object({
  codeText: z.string().min(1),
  clinicalStatus: z.string().optional(),
});

export const ObservationInputSchema = z.object({
  code: z.string().min(1),
  value: z.unknown().optional(),
  effectiveAt: z.iso.datetime().optional(),
});

export const MedicationInputSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().optional(),
  status: z.string().optional(),
});

export const CarePlanInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
});

export const CommunicationPreferencesSchema = z.object({
  preferredTimeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  preferredTimeEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  noCallsBefore: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

export const DischargeRecordSchema = z.object({
  sourceMessageId: z.string().min(1),
  patient: z.object({
    mrn: z.string().min(1),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dob: z.iso.date().optional(),
    phone: z.string().optional(), // deliberately not format-validated — doc 04 R2 wants ~8% invalid numbers to survive ingestion and fail later at the call layer, not here
    email: z.email().optional(),
    preferredLanguage: z.string().optional(),
    communicationPreferences: CommunicationPreferencesSchema.optional(),
  }),
  encounter: z.object({
    careSetting: z.string().optional(),
    admissionAt: z.iso.datetime().optional(),
    dischargeAt: z.iso.datetime(),
    dischargeInstructions: z.string().optional(),
  }),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  followUpWindowHours: z.number().int().positive(),
  conditions: z.array(ConditionInputSchema).default([]),
  observations: z.array(ObservationInputSchema).default([]),
  medications: z.array(MedicationInputSchema).default([]),
  carePlan: CarePlanInputSchema.optional(),
});

export type DischargeRecord = z.infer<typeof DischargeRecordSchema>;
