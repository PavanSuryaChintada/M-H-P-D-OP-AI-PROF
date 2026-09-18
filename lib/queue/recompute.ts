// Doc 06 §Scoring cadence — priority_score is a stored column recomputed by
// the scheduler tick for all claimable tasks in one UPDATE ... FROM
// statement, not computed in ORDER BY. This SQL must produce the same
// numbers as lib/queue/priority.ts + lib/queue/tier.ts for equivalent
// inputs — tests/queue-recompute.test.ts cross-checks the two don't drift.

import { sql } from "drizzle-orm";
import { withHospitalContext } from "../db/tenant";

const CLAIMABLE_STATES = sql`('PENDING', 'RETRY_SCHEDULED', 'CALLBACK_SCHEDULED')`;

/** Risk value CASE mirrors priority.ts's RISK_VALUES exactly. */
const RISK_CASE = sql`
  case t.risk_level
    when 'LOW' then 0.1
    when 'MEDIUM' then 0.4
    when 'HIGH' then 0.7
    when 'CRITICAL' then 1.0
    else 0
  end
`;

export async function recomputeScores(hospitalId: string): Promise<number> {
  const result = await withHospitalContext(hospitalId, (tx) => tx.execute(sql`
    with campaign_weights as (
      select id, greatest(priority, 0) as weight,
             sum(greatest(priority, 0)) over () as total_weight
        from campaigns
       where hospital_id = ${hospitalId} and state = 'RUNNING'
    ),
    scored as (
      select
        t.id,
        -- deadline_pressure = 1 - (time_remaining / total_window), clamped 0-1
        least(1.0, greatest(0.0,
          1 - (extract(epoch from (t.clinical_deadline_at - now())) / 3600.0)
              / nullif(t.total_window_hours, 0)
        )) as deadline_pressure,
        ${RISK_CASE} as clinical_risk,
        coalesce(
          (select cw.weight / nullif(cw.total_weight, 0) from campaign_weights cw where cw.id = t.campaign_id),
          0
        ) as campaign_weight,
        -- wait_age = min(hours_since_created / 24, 1)
        least(1.0, extract(epoch from (now() - t.created_at)) / 3600.0 / 24.0) as wait_age,
        -- attempt_penalty = min(attempts / max_attempts, 1)
        least(1.0, t.attempt_count::float / nullif(t.max_attempts, 0)) as attempt_penalty,
        -- tier: 0 = due callback (+/-10 min), 1 = cutoff risk, 2 = scored pool
        case
          when t.callback_requested_at is not null
               and abs(extract(epoch from (t.callback_requested_at - now()))) <= 600
            then 0
          when (extract(epoch from (t.clinical_deadline_at - now())) / 3600.0) < 2
               or (extract(epoch from (t.clinical_deadline_at - now())) / 3600.0)
                  / nullif(t.total_window_hours, 0) < 0.20
            then 1
          else 2
        end as tier
      from outreach_tasks t
      where t.hospital_id = ${hospitalId}
        and t.state in ${CLAIMABLE_STATES}
    )
    update outreach_tasks t
       set priority_score = round((
             0.40 * coalesce(scored.deadline_pressure, 0)
           + 0.30 * coalesce(scored.clinical_risk, 0)
           + 0.15 * coalesce(scored.campaign_weight, 0)
           + 0.10 * coalesce(scored.wait_age, 0)
           - 0.05 * coalesce(scored.attempt_penalty, 0)
           )::numeric, 4),
           tier = scored.tier,
           updated_at = now()
      from scored
     where t.id = scored.id
  `));

  return result.count ?? 0;
}
