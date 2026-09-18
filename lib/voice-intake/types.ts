// Doc 10 — shared types for the conversation flow and the patient side
// that drives it (a scripted persona in the simulator; eventually a real
// caller on a live call).

export type ConversationState =
  | "IDENTIFY_VERIFY"
  | "STATE_PURPOSE"
  | "CONFIRM_TIME"
  | "FOLLOW_UP_QUESTIONS"
  | "CONFIRM_UNDERSTANDING"
  | "CLOSE";

export interface PatientTurnResult {
  text: string;
  /** only meaningful when the agent just asked "is now convenient" and the answer was no — see lib/voice-intake/run-call.ts's callback handling. A real call would parse this from speech; the simulator supplies it directly since NLU date parsing is out of scope for this build. */
  callbackRequestedAt?: Date;
}

export interface PatientResponder {
  respond(agentUtterance: string, state: ConversationState, meta?: { questionId?: string }): Promise<PatientTurnResult>;
}

export interface TranscriptTurn {
  role: "agent" | "patient";
  text: string;
  latencyMs?: number;
}
