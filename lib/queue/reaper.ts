// Doc 07 §6 — run this on a 30s interval per hospital (or looped across all
// hospitals). The actual query lives in the repository layer
// (lib/db/repositories/outreach-tasks.ts, per doc 01 R2.3); this is the
// entry point a cron/interval driver calls.

import { reapExpiredLeases } from "../db/repositories/outreach-tasks";

export async function runReaperTick(hospitalId: string): Promise<string[]> {
  return reapExpiredLeases(hospitalId);
}
