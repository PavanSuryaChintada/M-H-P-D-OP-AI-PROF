// Doc 05 R1 — guarded state machine, not free-form updates.

export type CampaignState =
  | "DRAFT"
  | "READY"
  | "SCHEDULED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

const ALLOWED_TRANSITIONS: Record<CampaignState, CampaignState[]> = {
  DRAFT: ["READY", "CANCELLED"],
  READY: ["SCHEDULED", "RUNNING", "DRAFT", "CANCELLED"],
  SCHEDULED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "COMPLETED", "CANCELLED", "FAILED"],
  PAUSED: ["RUNNING", "CANCELLED", "COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: CampaignState, to: CampaignState) {
    super(`cannot transition campaign from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function isValidTransition(from: CampaignState, to: CampaignState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: CampaignState, to: CampaignState): void {
  if (!isValidTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** doc 05 deliverable: campaign.created|started|paused|resumed|completed. Not every transition maps to a distinct event name — this is the mapping. */
export function eventNameForTransition(from: CampaignState, to: CampaignState): string | null {
  if (to === "RUNNING" && from === "PAUSED") return "campaign.resumed";
  if (to === "RUNNING") return "campaign.started";
  if (to === "PAUSED") return "campaign.paused";
  if (to === "COMPLETED") return "campaign.completed";
  return null;
}
