// Doc 10 R3 — call_turns persistence. Turns are buffered in memory during
// the conversation (lib/voice-intake/run-call.ts) and written in one bulk
// insert once the call ends and doc 07's recordCallOutcome has created the
// calls row — there is no call id to attach a turn to any earlier than
// that, and creating the calls row early would conflict with (and be
// ignored by) recordCallOutcome's own createCall call, which is the one
// that actually stamps the outcome onto it.

import { asc, eq } from "drizzle-orm";
import { withTenant, type TenantContext } from "../tenant";
import { callTurns } from "../schema";

export interface CallTurnInput {
  turnIndex: number;
  speaker: "AGENT" | "PATIENT";
  content: string;
  latencyMs?: number;
}

export async function createCallTurns(ctx: TenantContext, callId: string, turns: CallTurnInput[]) {
  return withTenant(ctx, async (tx) => {
    if (turns.length === 0) return [];
    return tx
      .insert(callTurns)
      .values(turns.map((t) => ({ ...t, callId, hospitalId: ctx.hospitalId })))
      .returning();
  });
}

export async function listCallTurns(ctx: TenantContext, callId: string) {
  return withTenant(ctx, async (tx) =>
    tx.select().from(callTurns).where(eq(callTurns.callId, callId)).orderBy(asc(callTurns.turnIndex)),
  );
}
