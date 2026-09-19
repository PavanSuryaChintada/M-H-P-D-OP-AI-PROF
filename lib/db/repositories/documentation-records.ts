// Doc 14 — documentation_records persistence.

import { and, eq, lte, or, isNull } from "drizzle-orm";
import { withTenant, withHospitalContext, type TenantContext } from "../tenant";
import { documentationRecords } from "../schema";
import type { DocumentationRecord } from "../../ai/schemas/documentation";

export interface CreateDocumentationRecordInput {
  callId: string;
  patientId: string;
  campaignId: string;
  result: DocumentationRecord;
  modelProvider: string;
  modelName: string;
  promptVersion: string;
}

export async function createDocumentationRecord(ctx: TenantContext, input: CreateDocumentationRecordInput) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(documentationRecords)
      .values({
        hospitalId: ctx.hospitalId,
        callId: input.callId,
        patientId: input.patientId,
        campaignId: input.campaignId,
        summary: input.result.summary,
        outcome: input.result.outcome,
        triageResultId: input.result.triage_result_id,
        escalationId: input.result.escalation_id,
        patientReportedSymptoms: input.result.patient_reported_symptoms,
        observationsRecorded: input.result.observations_recorded,
        questionsAnswered: input.result.questions_answered,
        questionsTotal: input.result.questions_total,
        followUpActions: input.result.follow_up_actions,
        ehrSyncStatus: "PENDING",
        modelProvider: input.modelProvider,
        promptVersion: input.promptVersion,
      })
      .returning();
    return row;
  });
}

export async function markEhrSynced(ctx: TenantContext, documentationRecordId: string, idempotencyKey: string) {
  return withTenant(ctx, async (tx) => {
    await tx
      .update(documentationRecords)
      .set({ ehrSyncStatus: "SYNCED", ehrSyncError: null, ehrIdempotencyKey: idempotencyKey })
      .where(eq(documentationRecords.id, documentationRecordId));
  });
}

export async function markEhrFailed(
  ctx: TenantContext,
  documentationRecordId: string,
  idempotencyKey: string,
  error: string,
  nextRetryAt: Date,
) {
  return withTenant(ctx, async (tx) => {
    await tx
      .update(documentationRecords)
      .set({ ehrSyncStatus: "FAILED", ehrSyncError: error, ehrIdempotencyKey: idempotencyKey, ehrSyncNextRetryAt: nextRetryAt })
      .where(eq(documentationRecords.id, documentationRecordId));
  });
}

export async function incrementEhrRetryCount(ctx: TenantContext, documentationRecordId: string) {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(documentationRecords).where(eq(documentationRecords.id, documentationRecordId));
    if (!row) return;
    await tx
      .update(documentationRecords)
      .set({ ehrSyncRetryCount: row.ehrSyncRetryCount + 1 })
      .where(eq(documentationRecords.id, documentationRecordId));
  });
}

/**
 * Doc 15 R6 — failed syncs due for another attempt, capped at maxAttempts so
 * exhausted records stop being picked up (they remain visible as `failed`,
 * per R6's "never silently dropped" — just no longer auto-retried).
 */
export async function listRetryableEhrFailures(hospitalId: string, maxAttempts: number, now: Date) {
  return withHospitalContext(hospitalId, async (tx) =>
    tx
      .select()
      .from(documentationRecords)
      .where(
        and(
          eq(documentationRecords.hospitalId, hospitalId),
          eq(documentationRecords.ehrSyncStatus, "FAILED"),
          lte(documentationRecords.ehrSyncRetryCount, maxAttempts),
          or(isNull(documentationRecords.ehrSyncNextRetryAt), lte(documentationRecords.ehrSyncNextRetryAt, now)),
        ),
      ),
  );
}
