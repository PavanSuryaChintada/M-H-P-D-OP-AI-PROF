import { z } from "zod";

export const EligibilityCriteriaSchema = z.object({
  riskLevels: z.array(z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])).optional(),
  conditionCodes: z.array(z.string()).optional(),
  careSettings: z.array(z.string()).optional(),
  conflictsWithCampaignIds: z.array(z.uuid()).optional(),
});

export const CreateCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  eligibilityCriteria: EligibilityCriteriaSchema.optional(),
  followUpWindowHours: z.number().int().positive().optional(),
  callingHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  callingHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  priority: z.number().int().optional(),
  maxRetries: z.number().int().min(0).max(20).optional(),
  capacityShare: z.number().int().positive().optional(),
  protocolId: z.uuid().optional(),
  startDate: z.iso.datetime().optional(),
  endDate: z.iso.datetime().optional(),
});

export const TransitionSchema = z.object({
  to: z.enum(["DRAFT", "READY", "SCHEDULED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"]),
  reason: z.string().min(1),
});
