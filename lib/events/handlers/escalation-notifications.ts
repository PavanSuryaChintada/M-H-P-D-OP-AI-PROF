// Doc 16 R5 — the escalation notification chain, PRD §20's exact example:
//   escalation.created
//     -> notify primary reviewer (in-app + configured channels)
//     -> wait reviewer_timeout_minutes
//     -> if not acknowledged -> notify backup reviewer + hospital admin
//     -> wait again
//     -> if still not acknowledged -> mark OVERDUE, surface everywhere
//
// "Wait" is a scheduled follow-up event (escalation.timeout_check, with a
// stage in its payload), not a setTimeout — R5 explicitly rules that out
// because it doesn't survive a restart. Every handler re-reads the
// escalation's CURRENT state before acting, which is what makes duplicate
// delivery a no-op (R3) and makes an acknowledgment that happened before a
// scheduled check fires converge correctly instead of over-notifying.

import { getEscalationById, acknowledgeEscalation, markEscalationOverdue } from "../../db/repositories/escalations";
import { createNotification, hasNotificationTagged, deliverNotification } from "../../db/repositories/notifications";
import { getHospitalById } from "../../db/repositories/hospitals";
import { emitEvent } from "../../db/repositories/events";
import { systemContext } from "../../db/system-context";
import type { TenantContext } from "../../db/tenant";
import type { HospitalConfig } from "../../hospitals/config-schema";

const ACTIVE_ESCALATION_STATES = ["OPEN", "ASSIGNED", "IN_REVIEW", "WAITING_FOR_INFORMATION"];

async function notifyStage(hospitalId: string, escalationId: string, stage: "primary" | "backup", recipients: (string | undefined)[], reason: string) {
  const ctx = systemContext(hospitalId);
  const tag = `escalation:${escalationId}:${stage}`;
  if (await hasNotificationTagged(ctx, escalationId, tag)) return; // R3 — already notified for this stage

  for (const recipientUserId of recipients.filter((r): r is string => Boolean(r))) {
    const row = await createNotification(ctx, {
      recipientUserId,
      channel: "IN_APP",
      subject: `${tag} — ${reason}`,
      body: reason,
      relatedEscalationId: escalationId,
    });
    await deliverNotification(ctx, row.id);
  }
}

export interface EscalationCreatedPayload {
  escalationId: string;
  primaryReviewerUserId?: string;
}

export async function handleEscalationCreated(hospitalId: string, payload: EscalationCreatedPayload) {
  const ctx = systemContext(hospitalId);
  const escalation = await getEscalationById(ctx, payload.escalationId);
  if (!escalation || !ACTIVE_ESCALATION_STATES.includes(escalation.state)) return; // already moved on — nothing to do

  const hospital = await getHospitalById(hospitalId);
  const config = hospital?.config as HospitalConfig | null;
  const timeoutMinutes = config?.notificationPreferences?.reviewerTimeoutMinutes ?? 30;

  await notifyStage(hospitalId, payload.escalationId, "primary", [payload.primaryReviewerUserId], "primary reviewer notified of new escalation");

  await emitEvent(ctx, {
    type: "escalation.timeout_check",
    payload: { escalationId: payload.escalationId, stage: "primary", backupReviewerUserId: config?.notificationPreferences?.backupReviewerUserId },
    idempotencyKey: `timeout-check:${payload.escalationId}:primary`,
    scheduledFor: new Date(Date.now() + timeoutMinutes * 60 * 1000),
  });
}

export interface EscalationTimeoutCheckPayload {
  escalationId: string;
  stage: "primary" | "backup";
  backupReviewerUserId?: string;
}

export async function handleEscalationTimeoutCheck(hospitalId: string, payload: EscalationTimeoutCheckPayload) {
  const ctx = systemContext(hospitalId);
  const escalation = await getEscalationById(ctx, payload.escalationId);
  if (!escalation || !ACTIVE_ESCALATION_STATES.includes(escalation.state)) return; // acknowledged/resolved/closed since this was scheduled — converge silently (R3)

  if (payload.stage === "primary") {
    const hospital = await getHospitalById(hospitalId);
    const config = hospital?.config as HospitalConfig | null;
    const timeoutMinutes = config?.notificationPreferences?.reviewerTimeoutMinutes ?? 30;

    await notifyStage(hospitalId, payload.escalationId, "backup", [payload.backupReviewerUserId], "unacknowledged — backup reviewer and hospital admin notified");

    await emitEvent(ctx, {
      type: "escalation.timeout_check",
      payload: { escalationId: payload.escalationId, stage: "backup" },
      idempotencyKey: `timeout-check:${payload.escalationId}:backup`,
      scheduledFor: new Date(Date.now() + timeoutMinutes * 60 * 1000),
    });
    return;
  }

  // stage === "backup" and still not acknowledged.
  await markEscalationOverdue(ctx, payload.escalationId);
}

/** Doc 16 R5's entry point — call this wherever an escalation is created (doc 13's createEscalationFromConsensus) to kick off the chain. Takes the caller's real TenantContext, unlike the dispatcher-invoked handlers above which only ever have a hospitalId. */
export async function startEscalationNotificationChain(ctx: TenantContext, escalationId: string, primaryReviewerUserId?: string) {
  await emitEvent(ctx, {
    type: "escalation.created",
    payload: { escalationId, primaryReviewerUserId } satisfies EscalationCreatedPayload,
    idempotencyKey: `escalation-created:${escalationId}`,
  });
}

export interface AcknowledgeEscalationResult {
  acknowledged: boolean;
}

/** What a reviewer's "acknowledge" action (doc 17 UI) calls — this is what the timeout-check handlers above read back. */
export async function acknowledgeEscalationAction(hospitalId: string, escalationId: string): Promise<AcknowledgeEscalationResult> {
  const row = await acknowledgeEscalation(systemContext(hospitalId), escalationId);
  return { acknowledged: row !== null };
}
