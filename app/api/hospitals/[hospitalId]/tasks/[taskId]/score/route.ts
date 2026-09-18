import { NextRequest, NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { getTaskById, getNormalizedCampaignWeight } from "@/lib/db/repositories/outreach-tasks";
import { computeScore } from "@/lib/queue/priority";
import { assignTier } from "@/lib/queue/tier";

// Doc 06 deliverable: "Dashboard can show, for any pending task, why it
// ranks where it does." Note on path: the spec names this GET
// /api/tasks/:id/score; nested under /hospitals/[hospitalId] here instead,
// consistent with every other route in this app, since resolving
// hospitalId is what the guard/RLS model is built around (doc 02).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hospitalId: string; taskId: string }> },
) {
  const { hospitalId, taskId } = await params;
  const gate = await guard(hospitalId, "queue:view");
  if (gate instanceof Response) return gate;

  const task = await getTaskById(gate, taskId);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const now = new Date();
  const timeRemainingHours = (task.clinicalDeadlineAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  const totalWindowHours = task.totalWindowHours ?? 0;
  const campaignWeight = await getNormalizedCampaignWeight(gate, task.campaignId);
  const hoursSinceEligible = (now.getTime() - task.createdAt.getTime()) / (60 * 60 * 1000);

  const breakdown = computeScore({
    timeRemainingHours,
    totalWindowHours,
    riskLevel: task.riskLevel ?? "LOW",
    campaignWeight,
    hoursSinceEligible,
    attempts: task.attemptCount,
    maxAttempts: task.maxAttempts,
  });

  const tier = assignTier({
    callbackRequestedAt: task.callbackRequestedAt,
    now,
    timeRemainingHours,
    totalWindowHours,
  });

  return NextResponse.json({
    taskId: task.id,
    tier,
    storedTier: task.tier,
    storedPriorityScore: Number(task.priorityScore),
    ...breakdown,
    inputs: { timeRemainingHours, totalWindowHours, riskLevel: task.riskLevel, campaignWeight, hoursSinceEligible, attempts: task.attemptCount, maxAttempts: task.maxAttempts },
  });
}
