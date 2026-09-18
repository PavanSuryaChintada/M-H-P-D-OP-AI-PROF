// Doc 07 §1 — declared transitions. Illegal transitions throw; there is no
// arbitrary `UPDATE state`, only this.

export type TaskState =
  | "PENDING"
  | "SCHEDULED"
  | "CALLING"
  | "CONNECTED"
  | "COMPLETED"
  | "NO_ANSWER"
  | "BUSY"
  | "VOICEMAIL"
  | "DROPPED"
  | "INVALID_NUMBER"
  | "DECLINED"
  | "RETRY_SCHEDULED"
  | "CALLBACK_SCHEDULED"
  | "ESCALATED"
  | "MANUAL_FOLLOW_UP"
  | "FAILED"
  | "ELIGIBILITY_ERROR";

const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  PENDING: ["SCHEDULED", "CALLING", "ELIGIBILITY_ERROR"],
  SCHEDULED: ["CALLING"],
  CALLING: [
    "CONNECTED",
    "NO_ANSWER",
    "BUSY",
    "VOICEMAIL",
    "DROPPED",
    "INVALID_NUMBER",
    "DECLINED",
    "FAILED",
    "RETRY_SCHEDULED", // reaper: lease expired mid-CALLING
  ],
  CONNECTED: ["COMPLETED", "ESCALATED", "CALLBACK_SCHEDULED", "DROPPED", "RETRY_SCHEDULED"], // reaper: lease expired mid-CONNECTED
  COMPLETED: [],
  NO_ANSWER: ["RETRY_SCHEDULED", "MANUAL_FOLLOW_UP"],
  BUSY: ["RETRY_SCHEDULED", "MANUAL_FOLLOW_UP"],
  VOICEMAIL: ["RETRY_SCHEDULED", "MANUAL_FOLLOW_UP"],
  DROPPED: ["RETRY_SCHEDULED", "MANUAL_FOLLOW_UP"],
  INVALID_NUMBER: ["MANUAL_FOLLOW_UP"],
  DECLINED: ["COMPLETED"],
  RETRY_SCHEDULED: ["SCHEDULED", "CALLING", "MANUAL_FOLLOW_UP"],
  CALLBACK_SCHEDULED: ["CALLING", "RETRY_SCHEDULED", "MANUAL_FOLLOW_UP"], // missed-callback grace -> retry, then manual
  ESCALATED: ["COMPLETED"],
  MANUAL_FOLLOW_UP: [],
  FAILED: ["RETRY_SCHEDULED", "MANUAL_FOLLOW_UP"],
  ELIGIBILITY_ERROR: ["PENDING"], // recovery retry, doc 05-style
};

export class IllegalTaskTransitionError extends Error {
  constructor(from: TaskState, to: TaskState) {
    super(`cannot transition outreach_task from ${from} to ${to}`);
    this.name = "IllegalTaskTransitionError";
  }
}

export function isValidTaskTransition(from: TaskState, to: TaskState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTaskTransition(from: TaskState, to: TaskState): void {
  if (!isValidTaskTransition(from, to)) throw new IllegalTaskTransitionError(from, to);
}
