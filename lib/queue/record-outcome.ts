// Doc 07 — the orchestrator that ties outcome-policy, the state machine,
// and backoff together for one call attempt's result. This is what a
// worker calls after a call ends (doc 10 owns the call itself).

import { OUTCOME_POLICY, OUTCOME_TERMINAL_STATE, type CallOutcome } from "./outcome-policy";
import { assertValidTaskTransition, type TaskState } from "./state-machine";
import { computeBackoff, type PatientPreference } from "./backoff";
import { validateCallbackTime, InvalidCallbackTimeError } from "./callback";
import {
  transitionTaskStateAndReleaseCapacity,
  transitionTaskState,
} from "../db/repositories/outreach-tasks";
import { createCall } from "../db/repositories/calls";
import { getHospitalById } from "../db/repositories/hospitals";
import type { HospitalConfig } from "../hospitals/config-schema";
import type { TenantContext } from "../db/tenant";
import type { outreachTasks } from "../db/schema";

type Task = typeof outreachTasks.$inferSelect;

export interface RecordOutcomeInput {
  outcome: CallOutcome;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  partialState?: unknown;
  /** required when outcome is CALLBACK_REQUESTED */
  callbackRequestedAt?: Date;
  patientPreference?: PatientPreference;
  now?: Date;
  /** doc 08's compressed-timeline simulation only — see backoff.ts. */
  baseMinutesOverride?: number[];
  searchStepMinutesOverride?: number;
  /** doc 08's compressed-timeline simulation only — outcomes with a *fixed* policy.backoffMinutes (BUSY, DROPPED) bypass baseMinutesOverride entirely since they never read the base table; this overrides that fixed value instead. Production never passes this. */
  fixedBackoffMinutesOverride?: number;
}

export interface RecordOutcomeResult {
  finalState: TaskState;
  scheduledFor?: Date;
  reason?: string;
}

/**
 * §1-3: moves the task out of CALLING/CONNECTED into its outcome state
 * (releasing capacity in that same transaction), records the call, then —
 * for outcomes that allow it — either schedules a retry (clamped to
 * calling hours, patient preference, and the clinical window) or gives up
 * to MANUAL_FOLLOW_UP. PROVIDER_ERROR does not consume the attempt the
 * claim already counted; this is what actually reverses that increment.
 */
export async function recordCallOutcome(
  ctx: TenantContext,
  task: Task,
  input: RecordOutcomeInput,
): Promise<RecordOutcomeResult> {
  const now = input.now ?? new Date();
  const policy = OUTCOME_POLICY[input.outcome];
  const outcomeState = OUTCOME_TERMINAL_STATE[input.outcome] as TaskState;

  assertValidTaskTransition(task.state as TaskState, outcomeState);

  if (input.outcome === "CALLBACK_REQUESTED") {
    if (!input.callbackRequestedAt) {
      throw new Error("callbackRequestedAt is required for CALLBACK_REQUESTED");
    }
    // §4 — refuse rather than silently reschedule. The agent (doc 10) is
    // expected to have already offered an alternative during the call for
    // an invalid time; this is the backstop that makes "silently moved"
    // impossible even if that check was skipped upstream.
    const hospitalForValidation = await getHospitalById(task.hospitalId);
    const configForValidation = (hospitalForValidation?.config as HospitalConfig | null) ?? null;
    const validation = validateCallbackTime(
      input.callbackRequestedAt,
      task.clinicalDeadlineAt,
      hospitalForValidation?.timezone ?? "UTC",
      configForValidation?.callingHours ?? {},
    );
    if (!validation.valid) throw new InvalidCallbackTimeError(validation.reason);
  }

  const attemptCountDelta = policy.consumesAttempt ? 0 : -1;
  const extraForHop1 =
    input.outcome === "CALLBACK_REQUESTED"
      ? { callbackRequestedAt: input.callbackRequestedAt, scheduledFor: input.callbackRequestedAt, attemptCountDelta }
      : { attemptCountDelta };

  await transitionTaskStateAndReleaseCapacity(
    ctx,
    task.id,
    task.state as TaskState,
    outcomeState,
    `outcome:${input.outcome}`,
    "system",
    extraForHop1,
  );

  await createCall(ctx, {
    outreachTaskId: task.id,
    campaignId: task.campaignId,
    patientId: task.patientId,
    attemptNumber: task.attemptCount, // already incremented at claim time
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationSeconds: input.durationSeconds,
    outcome: input.outcome,
    partialState: input.partialState,
  });

  const effectiveAttemptCount = task.attemptCount + attemptCountDelta;

  // Terminal-as-is outcomes: no second hop.
  if (outcomeState === "COMPLETED" || outcomeState === "CALLBACK_SCHEDULED") {
    return { finalState: outcomeState, scheduledFor: input.callbackRequestedAt };
  }

  // §1 diagram: DECLINED -> COMPLETED, INVALID_NUMBER -> MANUAL_FOLLOW_UP, unconditionally.
  if (outcomeState === "DECLINED") {
    await transitionTaskState(ctx, task.id, "DECLINED", "COMPLETED", "patient declined — respected, not retried", "system");
    return { finalState: "COMPLETED" };
  }
  if (outcomeState === "INVALID_NUMBER") {
    await transitionTaskState(ctx, task.id, "INVALID_NUMBER", "MANUAL_FOLLOW_UP", "invalid number — cannot retry", "system");
    return { finalState: "MANUAL_FOLLOW_UP" };
  }

  // Retry-eligible: NO_ANSWER, BUSY, VOICEMAIL, DROPPED, FAILED (network/provider).
  const effectiveMaxAttempts = policy.maxRetriesOverride ?? task.maxAttempts;
  if (!policy.retry || effectiveAttemptCount >= effectiveMaxAttempts) {
    await transitionTaskState(
      ctx,
      task.id,
      outcomeState,
      "MANUAL_FOLLOW_UP",
      effectiveAttemptCount >= effectiveMaxAttempts ? "max attempts reached" : "outcome does not retry",
      "system",
    );
    return { finalState: "MANUAL_FOLLOW_UP" };
  }

  const hospital = await getHospitalById(task.hospitalId);
  const config = (hospital?.config as HospitalConfig | null) ?? null;
  const backoff = computeBackoff({
    attemptNumber: effectiveAttemptCount,
    fixedBackoffMinutes:
      input.fixedBackoffMinutesOverride ?? (typeof policy.backoffMinutes === "number" ? policy.backoffMinutes : undefined),
    now,
    windowEnd: task.clinicalDeadlineAt,
    timezone: hospital?.timezone ?? "UTC",
    callingHours: config?.callingHours ?? {},
    patientPreference: input.patientPreference,
    baseMinutesOverride: input.baseMinutesOverride,
    searchStepMinutesOverride: input.searchStepMinutesOverride,
  });

  if (backoff.scheduledFor === null) {
    await transitionTaskState(ctx, task.id, outcomeState, "MANUAL_FOLLOW_UP", backoff.reason, "system");
    return { finalState: "MANUAL_FOLLOW_UP", reason: backoff.reason };
  }

  await transitionTaskState(ctx, task.id, outcomeState, "RETRY_SCHEDULED", `retry after ${input.outcome}`, "system", {
    scheduledFor: backoff.scheduledFor,
  });
  return { finalState: "RETRY_SCHEDULED", scheduledFor: backoff.scheduledFor };
}
