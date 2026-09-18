// Doc 11 R1 — the structured protocol shape, zod-validated on write.
// "Not just a blob of text": the follow_up_questions drive intake, the
// red_flags drive the rule engine (doc 13) directly (never re-parsed from
// free text), approved_guidance is the only patient-facing advice an
// agent may give, and escalation_rules maps a condition straight to a
// priority. The source document (protocols.content) is what chunking and
// retrieval read — this structured form is not a replacement for it.

import { z } from "zod";

export const ProbeQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const FollowUpQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  answerType: z.enum(["yes_no", "scale", "text", "choice"]),
  choices: z.array(z.string()).optional(),
  probeQuestions: z.array(ProbeQuestionSchema).default([]),
});

export const RedFlagSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  triggerKeywords: z.array(z.string().min(1)).min(1),
  severity: z.enum(["low", "moderate", "high"]),
  requiredAction: z.string().min(1),
});

export const ApprovedGuidanceSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  text: z.string().min(1),
});

export const EscalationRuleSchema = z.object({
  id: z.string().min(1),
  condition: z.string().min(1),
  priority: z.enum(["low", "medium", "high"]),
});

export const StructuredProtocolSchema = z.object({
  specialty: z.string().min(1),
  version: z.number().int().positive(),
  effectiveFrom: z.iso.datetime(),
  followUpQuestions: z.array(FollowUpQuestionSchema).min(8).max(12),
  redFlags: z.array(RedFlagSchema).min(6).max(10),
  approvedGuidance: z.array(ApprovedGuidanceSchema).min(1),
  escalationRules: z.array(EscalationRuleSchema).min(1),
});

export type StructuredProtocol = z.infer<typeof StructuredProtocolSchema>;
export type FollowUpQuestion = z.infer<typeof FollowUpQuestionSchema>;
export type RedFlagDefinition = z.infer<typeof RedFlagSchema>;
