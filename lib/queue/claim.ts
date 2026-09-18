// Doc 06 §2 — the transactional claim. Both the capacity reservation and
// the task selection happen in one transaction, so a crash between them is
// impossible, and FOR UPDATE SKIP LOCKED guarantees two workers never claim
// the same row.
//
// Do not enforce capacity by counting CALLING rows in application code —
// it races. Do not put the score in ORDER BY as an expression — it's a
// stored column precisely so this query can use it directly.

import { sql } from "drizzle-orm";
import { db } from "../db/client";
import type { Tx } from "../db/tenant";

export interface ClaimedTask {
  id: string;
  patientId: string;
  campaignId: string;
  state: string;
  attemptCount: number;
  leaseExpiresAt: Date;
}

export const DEFAULT_PATIENT_CALL_COOLDOWN_MINUTES = 120;
const LEASE_MINUTES = 5;

/**
 * Attempts to reserve one capacity slot and claim the single best-ranked
 * claimable task among `eligibleCampaignIds`. Returns null if the hospital
 * is at capacity or nothing is claimable — both cases correctly leave no
 * net change (the capacity reservation is rolled back in the same
 * transaction if no task was claimed).
 */
export async function claimNextTask(
  hospitalId: string,
  workerId: string,
  eligibleCampaignIds: string[],
  cooldownMinutes: number = DEFAULT_PATIENT_CALL_COOLDOWN_MINUTES,
): Promise<ClaimedTask | null> {
  if (eligibleCampaignIds.length === 0) return null;

  return db.transaction(async (tx) => {
    // RLS is armed for hospital_id only — this runs as a worker process,
    // not on behalf of any one user/role, and the queue tables' policies
    // only ever check hospital_id (see lib/db/rls.sql).
    await tx.execute(sql`select set_config('app.hospital_id', ${hospitalId}, true)`);

    const capacityRows = await tx.execute<{ current_active_calls: number }>(sql`
      update hospital_capacity
         set current_active_calls = current_active_calls + 1, updated_at = now()
       where hospital_id = ${hospitalId}
         and current_active_calls < max_concurrent_calls
      returning current_active_calls
    `);
    if (capacityRows.length === 0) return null; // at capacity

    // drizzle's sql template stringifies a JS array with Array#toString
    // (comma-joined, no braces) rather than a Postgres array literal, so a
    // bare ${eligibleCampaignIds} produces "malformed array literal" for
    // anything but a coincidentally-comma-shaped single value. Building
    // the literal ourselves and casting is the safe, portable fix — these
    // are our own campaigns.id uuid values, never raw user input.
    const campaignIdsLiteral = `{${eligibleCampaignIds.join(",")}}`;

    const claimRows = await tx.execute<{
      id: string;
      patient_id: string;
      campaign_id: string;
      state: string;
      attempt_count: number;
      lease_expires_at: Date;
    }>(sql`
      with next_task as (
        select id from outreach_tasks
         where hospital_id = ${hospitalId}
           and state in ('PENDING', 'RETRY_SCHEDULED', 'CALLBACK_SCHEDULED')
           and scheduled_for <= now()
           and campaign_id = any(${campaignIdsLiteral}::uuid[])
           and not exists (
             select 1 from calls c
              where c.patient_id = outreach_tasks.patient_id
                and c.started_at > now() - (${cooldownMinutes} || ' minutes')::interval
           )
         order by tier asc, priority_score desc, created_at asc
         limit 1
         for update skip locked
      )
      update outreach_tasks t
         set state = 'CALLING',
             claimed_by = ${workerId},
             lease_expires_at = now() + (${LEASE_MINUTES} || ' minutes')::interval,
             attempt_count = attempt_count + 1,
             claimed_at = now(),
             updated_at = now()
        from next_task
       where t.id = next_task.id
      returning t.id, t.patient_id, t.campaign_id, t.state, t.attempt_count, t.lease_expires_at
    `);

    if (claimRows.length === 0) {
      // Nothing claimable among these campaigns — release the reservation
      // we just took so it doesn't leak.
      await tx.execute(sql`
        update hospital_capacity
           set current_active_calls = current_active_calls - 1, updated_at = now()
         where hospital_id = ${hospitalId}
      `);
      return null;
    }

    const row = claimRows[0];
    return {
      id: row.id,
      patientId: row.patient_id,
      campaignId: row.campaign_id,
      state: row.state,
      attemptCount: row.attempt_count,
      leaseExpiresAt: row.lease_expires_at,
    };
  });
}

/** Doc 06 §2 "Release" — decrements active_count in the SAME transaction that writes the terminal task state. Callers (doc 07) pass their own tx; never call this outside one that also updates the task row. */
export async function releaseCapacity(tx: Tx, hospitalId: string): Promise<void> {
  await tx.execute(sql`
    update hospital_capacity
       set current_active_calls = greatest(0, current_active_calls - 1), updated_at = now()
     where hospital_id = ${hospitalId}
  `);
}
