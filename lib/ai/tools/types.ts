// Doc 09 §1/§2 — the six agents and the shape every tool + the gateway
// itself conforms to.

import type { ZodType } from "zod";
import type { TenantContext } from "../../db/tenant";
import type { Action } from "../../auth/permissions";

export type AgentName =
  | "voice_intake"
  | "clinical_triage"
  | "second_assessor"
  | "rule_engine"
  | "escalation_consensus"
  | "documentation";

export interface ToolDefinition<Args, Result> {
  name: string;
  description: string;
  argsSchema: ZodType<Args>;
  allowedAgents: AgentName[];
  /** omit for tools that need no more than tenant membership (e.g. read-only lookups) */
  requiredPermission?: Action;
  writes: boolean;
  handler: (ctx: TenantContext, args: Args) => Promise<Result>;
}

export type GatewayResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: GatewayErrorCode; message: string } };

export type GatewayErrorCode =
  | "UNKNOWN_TOOL"
  | "AGENT_NOT_ALLOWED"
  | "FORBIDDEN"
  | "INVALID_ARGS"
  | "TENANT_VIOLATION"
  | "BUSINESS_RULE_VIOLATION"
  | "EXECUTION_ERROR";

/** Doc 09 §2 hard rule — thrown by a handler for a domain-level rejection (window closed, campaign not running, patient not in this tenant, etc.), caught by the gateway and turned into a structured BUSINESS_RULE_VIOLATION result rather than an unhandled exception into the conversation loop. */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}
