// Doc 17 R1 — declared transitions, same "illegal transitions throw, there
// is no arbitrary UPDATE state" discipline as doc 07's outreach task state
// machine (lib/queue/state-machine.ts).
//
// Reconciling two specs: R1's own diagram is the simple chain
// OPEN -> ASSIGNED -> IN_REVIEW -> WAITING_FOR_INFORMATION -> RESOLVED ->
// CLOSED. Doc 16 (built first) already added ACKNOWLEDGED and OVERDUE to
// escalation_state for its notification chain — R3's action bar lists
// "acknowledge" as its own action distinct from "assign," so ACKNOWLEDGED
// is a real part of this lifecycle, just not drawn in R1's simplified
// diagram. OVERDUE is set exclusively by doc 16's timeout chain (never by
// a guarded transition here) but must still be escapable once a reviewer
// finally acts on it.

export type EscalationState =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "ASSIGNED"
  | "IN_REVIEW"
  | "WAITING_FOR_INFORMATION"
  | "RESOLVED"
  | "CLOSED"
  | "OVERDUE";

const ALLOWED_TRANSITIONS: Record<EscalationState, EscalationState[]> = {
  OPEN: ["ACKNOWLEDGED", "ASSIGNED", "OVERDUE"],
  ACKNOWLEDGED: ["ASSIGNED", "OVERDUE"],
  ASSIGNED: ["IN_REVIEW", "RESOLVED", "OVERDUE"],
  IN_REVIEW: ["WAITING_FOR_INFORMATION", "RESOLVED", "OVERDUE"],
  WAITING_FOR_INFORMATION: ["IN_REVIEW", "RESOLVED", "OVERDUE"],
  OVERDUE: ["ASSIGNED", "IN_REVIEW", "RESOLVED"], // a reviewer eventually picks up even an overdue one
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export class IllegalEscalationTransitionError extends Error {
  constructor(from: EscalationState, to: EscalationState) {
    super(`cannot transition escalation from ${from} to ${to}`);
    this.name = "IllegalEscalationTransitionError";
  }
}

export function isValidEscalationTransition(from: EscalationState, to: EscalationState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidEscalationTransition(from: EscalationState, to: EscalationState): void {
  if (!isValidEscalationTransition(from, to)) throw new IllegalEscalationTransitionError(from, to);
}
