// Doc 03 R2 — the operating config the queue (doc 06/07) and AI later read.
// Validated with zod on every write (POST/PATCH), not by a Postgres
// constraint on the jsonb column — "must be real, not decorative."

import { z } from "zod";
import { isValidTimeZone } from "./timezone";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24h)");

const CallingWindowSchema = z
  .object({ start: HHMM, end: HHMM })
  .refine((w) => w.start < w.end, { message: "start must be before end" });

export const CallingHoursSchema = z.object({
  MON: CallingWindowSchema.optional(),
  TUE: CallingWindowSchema.optional(),
  WED: CallingWindowSchema.optional(),
  THU: CallingWindowSchema.optional(),
  FRI: CallingWindowSchema.optional(),
  SAT: CallingWindowSchema.optional(),
  SUN: CallingWindowSchema.optional(),
});

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  backoffMinutes: z.array(z.number().positive()).min(1),
  jitterPct: z.number().min(0).max(100),
});

export const NotificationPreferencesSchema = z.object({
  channels: z.array(z.enum(["IN_APP", "EMAIL", "WEBHOOK"])).min(1),
  reviewerTimeoutMinutes: z.number().int().positive(),
  backupReviewerUserId: z.uuid().optional(),
});

export const EhrSettingsSchema = z.object({
  mode: z.enum(["mock"]),
  failureRate: z.number().min(0).max(1),
});

export const HospitalConfigSchema = z.object({
  callingHours: CallingHoursSchema,
  maxConcurrentCalls: z.number().int().positive(),
  defaultRetryPolicy: RetryPolicySchema,
  defaultFollowUpWindowHours: z.number().positive(),
  notificationPreferences: NotificationPreferencesSchema,
  ehrSettings: EhrSettingsSchema,
});

export type HospitalConfig = z.infer<typeof HospitalConfigSchema>;

export const CreateHospitalSchema = z.object({
  name: z.string().min(1),
  shortCode: z.string().min(1).max(20),
  timezone: z.string().refine(isValidTimeZone, { message: "not a valid IANA timezone" }),
  contactName: z.string().min(1).optional(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
});
