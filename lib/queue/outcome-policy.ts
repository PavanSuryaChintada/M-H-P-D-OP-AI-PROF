// Doc 07 §2 — the outcome -> policy table, as data, exactly as specified.
// Design point the spec calls out explicitly: PROVIDER_ERROR does not
// consume an attempt — a patient should never be dropped to manual
// follow-up because *our* AI provider was down, not because of anything
// about them.

export type CallOutcome =
  | "COMPLETED"
  | "NO_ANSWER"
  | "BUSY"
  | "VOICEMAIL"
  | "DROPPED"
  | "INVALID_NUMBER"
  | "DECLINED"
  | "NETWORK_FAILURE"
  | "PROVIDER_ERROR"
  | "CALLBACK_REQUESTED";

export interface OutcomePolicy {
  retry: boolean | "pinned";
  /** minutes, "standard" (use the base backoff table), or null when retry is false */
  backoffMinutes: number | "standard" | null;
  /** overrides the task's own max_attempts for this outcome type, e.g. voicemail gives up after 2 regardless of the campaign's general retry budget */
  maxRetriesOverride?: number;
  preservesContext: boolean;
  consumesAttempt: boolean;
}

export const OUTCOME_POLICY: Record<CallOutcome, OutcomePolicy> = {
  COMPLETED: { retry: false, backoffMinutes: null, preservesContext: false, consumesAttempt: true },
  NO_ANSWER: { retry: true, backoffMinutes: "standard", preservesContext: false, consumesAttempt: true },
  BUSY: { retry: true, backoffMinutes: 10, preservesContext: false, consumesAttempt: true },
  VOICEMAIL: {
    retry: true,
    backoffMinutes: "standard",
    maxRetriesOverride: 2,
    preservesContext: false,
    consumesAttempt: true,
  },
  DROPPED: { retry: true, backoffMinutes: 5, preservesContext: true, consumesAttempt: true },
  INVALID_NUMBER: { retry: false, backoffMinutes: null, preservesContext: false, consumesAttempt: true },
  DECLINED: { retry: false, backoffMinutes: null, preservesContext: false, consumesAttempt: true },
  NETWORK_FAILURE: { retry: true, backoffMinutes: "standard", preservesContext: true, consumesAttempt: true },
  PROVIDER_ERROR: { retry: true, backoffMinutes: "standard", preservesContext: true, consumesAttempt: false },
  CALLBACK_REQUESTED: { retry: "pinned", backoffMinutes: null, preservesContext: true, consumesAttempt: false },
};

/** The outreach_task state a given outcome moves toward before backoff/manual-follow-up logic is applied. */
export const OUTCOME_TERMINAL_STATE: Record<CallOutcome, string> = {
  COMPLETED: "COMPLETED",
  NO_ANSWER: "NO_ANSWER",
  BUSY: "BUSY",
  VOICEMAIL: "VOICEMAIL",
  DROPPED: "DROPPED",
  INVALID_NUMBER: "INVALID_NUMBER",
  DECLINED: "DECLINED",
  NETWORK_FAILURE: "FAILED",
  PROVIDER_ERROR: "FAILED",
  CALLBACK_REQUESTED: "CALLBACK_SCHEDULED",
};
