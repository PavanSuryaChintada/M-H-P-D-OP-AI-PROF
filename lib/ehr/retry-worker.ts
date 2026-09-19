// Doc 15 R6 — background retry worker for ehr_sync_status='failed', with
// exponential backoff and a maximum attempt count. Re-sends the exact same
// idempotency key each retry, so a write that actually succeeded on a
// previous attempt (but whose response was lost, e.g. to a timeout) replays
// cleanly instead of writing twice.

import { mockEhrClient } from "./client";
import { EHRCallError } from "./types";
import { listRetryableEhrFailures, markEhrSynced, markEhrFailed, incrementEhrRetryCount } from "../db/repositories/documentation-records";
import { ehrSystemContext } from "./system-context";

export const EHR_MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_MINUTES = 5;

function backoffMinutes(retryCount: number): number {
  return RETRY_BASE_MINUTES * 2 ** retryCount;
}

export interface RetryEhrSyncsResult {
  attempted: number;
  synced: number;
  stillFailed: number;
}

export async function retryFailedEhrSyncs(hospitalId: string, now: Date = new Date()): Promise<RetryEhrSyncsResult> {
  const candidates = await listRetryableEhrFailures(hospitalId, EHR_MAX_RETRY_ATTEMPTS, now);
  const ctx = ehrSystemContext(hospitalId);

  let synced = 0;
  let stillFailed = 0;

  for (const record of candidates) {
    if (!record.ehrIdempotencyKey) continue; // nothing to replay without the original key

    try {
      await mockEhrClient.writeCommunication(
        ctx,
        { patientId: record.patientId, direction: "OUTBOUND", content: record.summary },
        record.ehrIdempotencyKey,
      );
      await markEhrSynced(ctx, record.id, record.ehrIdempotencyKey);
      synced++;
    } catch (err) {
      const message = err instanceof EHRCallError ? err.message : err instanceof Error ? err.message : String(err);
      await incrementEhrRetryCount(ctx, record.id);
      await markEhrFailed(
        ctx,
        record.id,
        record.ehrIdempotencyKey,
        message,
        new Date(now.getTime() + backoffMinutes(record.ehrSyncRetryCount + 1) * 60 * 1000),
      );
      stillFailed++;
    }
  }

  return { attempted: candidates.length, synced, stillFailed };
}
