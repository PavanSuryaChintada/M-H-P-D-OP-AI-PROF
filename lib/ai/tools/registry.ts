// Doc 09 §2 — the controlled tool gateway. Every AI action passes through
// callTool(); there is no other path from agent code to a repository.
//
//   registry lookup -> agent allowlist -> authorization -> zod validation
//   -> business-rule validation (inside the handler) -> execution via
//   repository -> audit_log write -> structured result
//
// Any failure at any stage returns a structured error, never a thrown
// exception into the conversation.

import { z } from "zod";
import type { TenantContext } from "../../db/tenant";
import { isAllowed } from "../../auth/permissions";
import { writeAuditLog } from "../../db/repositories/audit";
import { getPatientById } from "../../db/repositories/patients";
import { getEncounterById } from "../../db/repositories/encounters";
import { searchProtocolsByKeyword } from "../../db/repositories/protocols";
import { listOutreachTasksForPatient, getTaskById } from "../../db/repositories/outreach-tasks";
import { createObservation } from "../../db/repositories/clinical";
import { createEscalation } from "../../db/repositories/escalations";
import { createNotification } from "../../db/repositories/notifications";
import { createCommunication } from "../../db/repositories/communications";
import { mockEhrClient } from "../../ehr/client";
import { recordCallOutcome } from "../../queue/record-outcome";
import type { ToolDefinition, GatewayResult, AgentName } from "./types";
import { BusinessRuleError } from "./types";

// ---------------------------------------------------------------------------
// Tool catalogue (doc 09 §2 table)
// ---------------------------------------------------------------------------

const lookupPatient: ToolDefinition<{ patientId: string }, unknown> = {
  name: "lookup_patient",
  description: "Look up a patient's demographics and record by id.",
  argsSchema: z.object({ patientId: z.uuid() }),
  allowedAgents: ["voice_intake", "clinical_triage"],
  writes: false,
  handler: async (ctx, args) => {
    const patient = await getPatientById(ctx, args.patientId);
    if (!patient) throw new BusinessRuleError("patient not found in this hospital");
    return patient;
  },
};

const lookupEncounter: ToolDefinition<{ encounterId: string }, unknown> = {
  name: "lookup_encounter",
  description: "Look up a discharge encounter by id.",
  argsSchema: z.object({ encounterId: z.uuid() }),
  allowedAgents: ["clinical_triage"],
  writes: false,
  handler: async (ctx, args) => {
    const encounter = await getEncounterById(ctx, args.encounterId);
    if (!encounter) throw new BusinessRuleError("encounter not found in this hospital");
    return encounter;
  },
};

const searchProtocol: ToolDefinition<{ query: string; category?: string }, unknown> = {
  name: "search_protocol",
  description: "Search this hospital's clinical protocols for relevant guidance.",
  argsSchema: z.object({ query: z.string().min(1), category: z.string().optional() }),
  allowedAgents: ["voice_intake", "clinical_triage"],
  writes: false,
  handler: async (ctx, args) => searchProtocolsByKeyword(ctx, args.query, args.category),
};

const lookupPreviousOutreach: ToolDefinition<{ patientId: string }, unknown> = {
  name: "lookup_previous_outreach",
  description: "List this patient's prior outreach tasks, for context on earlier attempts.",
  argsSchema: z.object({ patientId: z.uuid() }),
  allowedAgents: ["voice_intake"],
  writes: false,
  handler: async (ctx, args) => listOutreachTasksForPatient(ctx, args.patientId),
};

const recordObservation: ToolDefinition<
  { patientId: string; encounterId?: string; code: string; value?: unknown; effectiveAt?: string },
  unknown
> = {
  name: "record_observation",
  description: "Record a clinical observation captured during triage.",
  argsSchema: z.object({
    patientId: z.uuid(),
    encounterId: z.uuid().optional(),
    code: z.string().min(1),
    value: z.unknown().optional(),
    effectiveAt: z.iso.datetime().optional(),
  }),
  allowedAgents: ["clinical_triage"],
  requiredPermission: "patient:view_clinical",
  writes: true,
  handler: async (ctx, args) =>
    createObservation(ctx, {
      patientId: args.patientId,
      encounterId: args.encounterId,
      code: args.code,
      value: args.value,
      effectiveAt: args.effectiveAt ? new Date(args.effectiveAt) : undefined,
    }),
};

const scheduleCallback: ToolDefinition<{ taskId: string; callbackRequestedAt: string }, unknown> = {
  name: "schedule_callback",
  description: "Schedule a callback at the patient's requested time (doc 07 CALLBACK_REQUESTED).",
  argsSchema: z.object({ taskId: z.uuid(), callbackRequestedAt: z.iso.datetime() }),
  allowedAgents: ["voice_intake"],
  writes: true,
  handler: async (ctx, args) => {
    const task = await getTaskById(ctx, args.taskId);
    if (!task) throw new BusinessRuleError("outreach task not found in this hospital");
    return recordCallOutcome(ctx, task, {
      outcome: "CALLBACK_REQUESTED",
      callbackRequestedAt: new Date(args.callbackRequestedAt),
      now: new Date(),
    });
  },
};

const RECORD_OUTCOME_VALUES = [
  "COMPLETED",
  "NO_ANSWER",
  "BUSY",
  "VOICEMAIL",
  "DROPPED",
  "INVALID_NUMBER",
  "DECLINED",
  "NETWORK_FAILURE",
  "PROVIDER_ERROR",
] as const;

const recordCallOutcomeTool: ToolDefinition<
  { taskId: string; outcome: (typeof RECORD_OUTCOME_VALUES)[number]; partialState?: unknown },
  unknown
> = {
  name: "record_call_outcome",
  description: "Record how a call ended (everything except a callback request — use schedule_callback for that).",
  argsSchema: z.object({
    taskId: z.uuid(),
    outcome: z.enum(RECORD_OUTCOME_VALUES),
    partialState: z.unknown().optional(),
  }),
  allowedAgents: ["voice_intake"],
  writes: true,
  handler: async (ctx, args) => {
    const task = await getTaskById(ctx, args.taskId);
    if (!task) throw new BusinessRuleError("outreach task not found in this hospital");
    return recordCallOutcome(ctx, task, { outcome: args.outcome, partialState: args.partialState, now: new Date() });
  },
};

const createEscalationTool: ToolDefinition<
  {
    patientId: string;
    campaignId?: string;
    callId?: string;
    outreachTaskId?: string;
    attemptNumber?: number;
    triggerReason: string;
    clinicalIndicators?: unknown;
    consensusResult?: unknown;
    priority: number;
  },
  unknown
> = {
  name: "create_escalation",
  description: "Create an escalation from the consensus decision. Only the consensus system may call this.",
  argsSchema: z.object({
    patientId: z.uuid(),
    campaignId: z.uuid().optional(),
    callId: z.uuid().optional(),
    outreachTaskId: z.uuid().optional(),
    attemptNumber: z.number().int().min(0).optional(),
    triggerReason: z.string().min(1),
    clinicalIndicators: z.unknown().optional(),
    consensusResult: z.unknown().optional(),
    priority: z.number().int().min(0),
  }),
  // Doc 09 §2 hard rule — no agent may call this except the consensus system.
  allowedAgents: ["escalation_consensus"],
  writes: true,
  handler: async (ctx, args) => (await createEscalation(ctx, args)).row,
};

const requestNotification: ToolDefinition<
  { recipientUserId?: string; channel: "IN_APP" | "EMAIL" | "WEBHOOK"; subject?: string; body: string; relatedEscalationId?: string },
  unknown
> = {
  name: "request_notification",
  description: "Request a notification be sent (e.g. to the reviewer on-call) about an escalation.",
  argsSchema: z.object({
    recipientUserId: z.uuid().optional(),
    channel: z.enum(["IN_APP", "EMAIL", "WEBHOOK"]),
    subject: z.string().optional(),
    body: z.string().min(1),
    relatedEscalationId: z.uuid().optional(),
  }),
  allowedAgents: ["escalation_consensus"],
  writes: true,
  handler: async (ctx, args) => createNotification(ctx, args),
};

const recordCommunication: ToolDefinition<
  { patientId: string; encounterId?: string; channel?: string; direction: "INBOUND" | "OUTBOUND"; content: string },
  unknown
> = {
  name: "record_communication",
  description: "Record a communication artifact (e.g. a call summary) for the patient's record.",
  argsSchema: z.object({
    patientId: z.uuid(),
    encounterId: z.uuid().optional(),
    channel: z.string().optional(),
    direction: z.enum(["INBOUND", "OUTBOUND"]),
    content: z.string().min(1),
  }),
  allowedAgents: ["documentation"],
  writes: true,
  handler: async (ctx, args) => createCommunication(ctx, args),
};

const updateMockEhr: ToolDefinition<
  { patientId: string; encounterId?: string; content: string; idempotencyKey: string },
  unknown
> = {
  name: "update_mock_ehr",
  description:
    "Push a documentation summary to the mock EHR (doc 15) as an outbound communication. Idempotent — replaying the same idempotencyKey returns the original result instead of writing again.",
  argsSchema: z.object({
    patientId: z.uuid(),
    encounterId: z.uuid().optional(),
    content: z.string().min(1),
    idempotencyKey: z.string().min(1),
  }),
  allowedAgents: ["documentation"],
  writes: true,
  handler: async (ctx, args) =>
    mockEhrClient.writeCommunication(
      ctx,
      { patientId: args.patientId, encounterId: args.encounterId, channel: "ehr_sync", direction: "OUTBOUND", content: args.content },
      args.idempotencyKey,
    ),
};

export const TOOL_REGISTRY: Record<string, ToolDefinition<never, unknown>> = {
  lookup_patient: lookupPatient as unknown as ToolDefinition<never, unknown>,
  lookup_encounter: lookupEncounter as unknown as ToolDefinition<never, unknown>,
  search_protocol: searchProtocol as unknown as ToolDefinition<never, unknown>,
  lookup_previous_outreach: lookupPreviousOutreach as unknown as ToolDefinition<never, unknown>,
  record_observation: recordObservation as unknown as ToolDefinition<never, unknown>,
  schedule_callback: scheduleCallback as unknown as ToolDefinition<never, unknown>,
  record_call_outcome: recordCallOutcomeTool as unknown as ToolDefinition<never, unknown>,
  create_escalation: createEscalationTool as unknown as ToolDefinition<never, unknown>,
  request_notification: requestNotification as unknown as ToolDefinition<never, unknown>,
  record_communication: recordCommunication as unknown as ToolDefinition<never, unknown>,
  update_mock_ehr: updateMockEhr as unknown as ToolDefinition<never, unknown>,
};

/**
 * The 6-stage gateway. `rawArgs` is whatever the AI produced — untrusted,
 * unvalidated. Doc 09 §2 hard rule: no tool accepts hospital_id from the
 * AI, so this rejects outright (TENANT_VIOLATION) if the raw payload even
 * contains that key, before any schema gets a chance to silently drop it.
 */
export async function callTool(
  agent: AgentName,
  ctx: TenantContext,
  name: string,
  rawArgs: unknown,
): Promise<GatewayResult<unknown>> {
  const tool = TOOL_REGISTRY[name];
  if (!tool) {
    return { ok: false, error: { code: "UNKNOWN_TOOL", message: `no such tool: ${name}` } };
  }

  if (!tool.allowedAgents.includes(agent)) {
    return { ok: false, error: { code: "AGENT_NOT_ALLOWED", message: `${agent} may not call ${name}` } };
  }

  if (rawArgs && typeof rawArgs === "object" && ("hospitalId" in rawArgs || "hospital_id" in rawArgs)) {
    return {
      ok: false,
      error: { code: "TENANT_VIOLATION", message: "tools never accept hospital_id from the AI — it comes from TenantContext" },
    };
  }

  if (tool.requiredPermission && !isAllowed(ctx.role, tool.requiredPermission)) {
    return { ok: false, error: { code: "FORBIDDEN", message: `role ${ctx.role} may not call ${name}` } };
  }

  const parsed = tool.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { ok: false, error: { code: "INVALID_ARGS", message: parsed.error.message } };
  }

  try {
    const result = await tool.handler(ctx, parsed.data);
    if (tool.writes) {
      await writeAuditLog(ctx, {
        action: `ai_tool.${name}`,
        resourceType: "ai_tool_call",
        metadata: { agent, args: parsed.data },
      });
    }
    return { ok: true, data: result };
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      return { ok: false, error: { code: "BUSINESS_RULE_VIOLATION", message: err.message } };
    }
    return {
      ok: false,
      error: { code: "EXECUTION_ERROR", message: err instanceof Error ? err.message : String(err) },
    };
  }
}
