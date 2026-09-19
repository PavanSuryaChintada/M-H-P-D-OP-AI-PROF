// Doc 18 R4 — "the timeline is the 'what happened to this patient?' answer
// the PRD keeps asking for." One function, one merged chronological feed
// from every table that records something happening to this patient.

import { getPatientById } from "../db/repositories/patients";
import { listCallsForPatient } from "../db/repositories/calls";
import { listEscalationsForPatient } from "../db/repositories/escalations";
import { withTenant, type TenantContext } from "../db/tenant";
import { sql } from "drizzle-orm";

export type TimelineEventType = "call" | "documentation" | "escalation" | "follow_up_task";

export interface TimelineEvent {
  type: TimelineEventType;
  at: string;
  summary: string;
  detail: unknown;
}

export async function getPatientTimeline(ctx: TenantContext, patientId: string) {
  const [patient, calls, escalations, docsAndTasks] = await Promise.all([
    getPatientById(ctx, patientId),
    listCallsForPatient(ctx, patientId),
    listEscalationsForPatient(ctx, patientId),
    withTenant(ctx, (tx) =>
      tx.execute<{ kind: string; at: string; summary: string; detail: unknown }>(sql`
        select 'documentation' as kind, created_at as at, summary, ehr_sync_status as detail
          from documentation_records where hospital_id = ${ctx.hospitalId} and patient_id = ${patientId}
        union all
        select 'follow_up_task' as kind, created_at as at, description as summary, status as detail
          from tasks where hospital_id = ${ctx.hospitalId} and patient_id = ${patientId}
        order by at asc
      `),
    ),
  ]);

  const events: TimelineEvent[] = [
    ...calls.map((c) => ({
      type: "call" as const,
      at: c.createdAt.toISOString(),
      summary: `Call attempt #${c.attemptNumber}: ${c.outcome ?? "in progress"}`,
      detail: c,
    })),
    ...escalations.map((e) => ({
      type: "escalation" as const,
      at: e.createdAt.toISOString(),
      summary: `Escalation (${e.state}): ${e.triggerReason}`,
      detail: e,
    })),
    ...docsAndTasks.map((d) => ({
      type: (d.kind === "documentation" ? "documentation" : "follow_up_task") as TimelineEventType,
      at: typeof d.at === "string" ? d.at : new Date(d.at as unknown as Date).toISOString(),
      summary: d.summary,
      detail: d.detail,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return { patient, events };
}
