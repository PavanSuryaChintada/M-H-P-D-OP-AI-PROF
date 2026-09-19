import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/auth/guard";
import { getEscalationReviewData } from "@/lib/escalations/review-data";
import {
  acknowledgeEscalation,
  assignEscalation,
  requestMoreInformation,
  moveToInReview,
  resolveEscalation,
  closeEscalation,
} from "@/lib/db/repositories/escalations";
import { createTask } from "@/lib/db/repositories/tasks";
import { escalationResolutionOutcomeEnum } from "@/lib/db/schema";
import { IllegalEscalationTransitionError } from "@/lib/escalations/lifecycle";
import type { TenantContext } from "@/lib/db/tenant";

// Doc 17 R3 — everything the review screen needs, in one round trip.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; escalationId: string }> },
) {
  const { hospitalId, escalationId } = await params;
  const gate = await guard(hospitalId, "escalation:view");
  if (gate instanceof Response) return gate;

  const data = await getEscalationReviewData(gate, escalationId);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

const ActionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge") }),
  z.object({ action: z.literal("assign"), reviewerUserId: z.uuid().optional() }),
  z.object({ action: z.literal("reassign"), reviewerUserId: z.uuid() }),
  z.object({ action: z.literal("move_to_review") }),
  z.object({ action: z.literal("request_info"), reason: z.string().min(1) }),
  z.object({ action: z.literal("resolve"), outcome: z.enum(escalationResolutionOutcomeEnum.enumValues), notes: z.string().min(1) }),
  z.object({ action: z.literal("close") }),
  z.object({
    action: z.literal("create_followup"),
    description: z.string().min(1),
    dueAt: z.iso.datetime().optional(),
  }),
]);

/**
 * Doc 17 R3's action bar, all through one endpoint: acknowledge, assign/
 * reassign, request info, resolve, create follow-up task. `resolve` alone
 * requires escalation:resolve (CLINICAL_REVIEWER only, per R7's required
 * test); everything else is escalation:assign (CLINICAL_REVIEWER or
 * HOSPITAL_ADMIN) — checked per-action, not once for the whole route, since
 * the two actions have genuinely different stakes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; escalationId: string }> },
) {
  const { hospitalId, escalationId } = await params;
  const parsed = ActionBodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const body = parsed.data;

  const gate = await guard(hospitalId, body.action === "resolve" ? "escalation:resolve" : "escalation:assign");
  if (gate instanceof Response) return gate;
  const actor = `user:${gate.userId}`;

  try {
    return await handleAction(gate, escalationId, body, actor);
  } catch (err) {
    if (err instanceof IllegalEscalationTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

async function handleAction(gate: TenantContext, escalationId: string, body: z.infer<typeof ActionBodySchema>, actor: string) {
  switch (body.action) {
    case "acknowledge": {
      const row = await acknowledgeEscalation(gate, escalationId);
      return NextResponse.json(row ?? { ok: true, note: "already acknowledged or moved on" });
    }
    case "assign": {
      const row = await assignEscalation(gate, escalationId, body.reviewerUserId ?? gate.userId, actor);
      if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json(row);
    }
    case "reassign": {
      const row = await assignEscalation(gate, escalationId, body.reviewerUserId, actor);
      if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json(row);
    }
    case "move_to_review": {
      const row = await moveToInReview(gate, escalationId, actor);
      return NextResponse.json(row);
    }
    case "request_info": {
      const row = await requestMoreInformation(gate, escalationId, body.reason, actor);
      return NextResponse.json(row);
    }
    case "resolve": {
      const row = await resolveEscalation(gate, escalationId, { outcome: body.outcome, notes: body.notes }, actor);
      return NextResponse.json(row);
    }
    case "close": {
      const row = await closeEscalation(gate, escalationId, actor);
      return NextResponse.json(row);
    }
    case "create_followup": {
      const data = await getEscalationReviewData(gate, escalationId);
      if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
      const task = await createTask(gate, {
        patientId: data.escalation.patientId,
        encounterId: data.encounter?.id,
        description: body.description,
        dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      });
      return NextResponse.json(task, { status: 201 });
    }
  }
}
