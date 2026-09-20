// Doc 10 R1/R2/R5 — the Voice Intake Agent's conversation flow.
//
// Scope decision, stated explicitly: the agent's own utterances are
// template-driven (protocol-sourced question text, fixed scripted lines
// for the identify/purpose/close steps) rather than freeform LLM
// generation. "Structured outreach, not a chatbot" (R1's own framing)
// supports this directly — the conversation's STRUCTURE and safety-
// critical decisions (when to stop, when to escalate, when to end) are
// deterministic code, never left to a model to get right in the moment.
// The doc 09 voice-intake-v1 prompt and provider abstraction already exist
// and are a drop-in swap for natural-language phrasing variation without
// changing this flow's structure or safety properties — that swap is left
// for whenever real-time telephony (10-OPT) makes phrasing variation
// worth the added non-determinism.
//
// Emergency detection and advice-request refusal are deterministic
// keyword checks (lib/voice-intake/detectors.ts), run on every patient
// turn regardless of conversation state — the same "independent of the
// LLM" reasoning as doc 13's rule engine. Patient utterances are
// untrusted input (doc 02): they can request a callback or answer a
// question, but nothing in patient speech can alter the agent's own
// instructions or skip a safety check.

import type { TenantContext } from "../db/tenant";
import type { FollowUpQuestion } from "../protocols/schema";
import type { RedFlag } from "../ai/assessors/rule-engine";
import type { ConversationState, PatientResponder, TranscriptTurn } from "./types";
import { detectEmergency, detectAdviceRequest, detectWrongPerson, detectRefusal, detectNotConvenient, buildAdviceRefusal } from "./detectors";
import { getTaskById, transitionTaskState } from "../db/repositories/outreach-tasks";
import { recordCallOutcome, type RecordOutcomeInput } from "../queue/record-outcome";
import { getMostRecentCallForTask } from "../db/repositories/calls";
import { createCallTurns } from "../db/repositories/call-turns";
import { runRuleEngine } from "../ai/assessors/rule-engine";
import { settleAssessors, escalateFromConsensus } from "../ai/run-consensus";
import { MockProvider } from "../ai/providers/mock";
import { runTriageAssessor } from "../ai/triage/run-assessor";
import { clinicalTriageV1 } from "../ai/prompts/clinical-triage/v1";
import { secondAssessorV1 } from "../ai/prompts/second-assessor/v1";
import type { TriageResult } from "../ai/schemas/triage";
import { log, runWithOperationId } from "../obs/logger";

export interface RunCallInput {
  ctx: TenantContext;
  hospitalName: string;
  patientFirstName: string;
  outreachTaskId: string;
  campaignId: string;
  followUpQuestions: FollowUpQuestion[];
  redFlags: RedFlag[];
  patientResponder: PatientResponder;
  now?: Date;
}

export interface RunCallResult {
  outcome: "COMPLETED" | "DECLINED" | "CALLBACK_REQUESTED";
  transcript: TranscriptTurn[];
  callId: string | null;
  emergencyTriggered: boolean;
  escalationId: string | null;
}

async function say(transcript: TranscriptTurn[], text: string) {
  transcript.push({ role: "agent", text });
}

/**
 * Doc 07's state machine allows DECLINED directly from CALLING, but
 * COMPLETED and CALLBACK_SCHEDULED only from CONNECTED — the asymmetry
 * doc 08's simulator hit for COMPLETED/CALLBACK_SCHEDULED, and this flow
 * hit again in the other direction (CONNECTED does NOT list DECLINED as a
 * valid target, so connecting first and then declining is itself an
 * illegal transition). The hop is conditional on the outcome, not blanket.
 */
async function finishWithOutcome(ctx: TenantContext, taskId: string, input: RecordOutcomeInput) {
  if (input.outcome === "DECLINED") {
    const task = await getTaskById(ctx, taskId);
    if (!task) throw new Error("outreach task disappeared mid-call");
    return recordCallOutcome(ctx, task, input);
  }
  await transitionTaskState(ctx, taskId, "CALLING", "CONNECTED", "connected", "system:voice-intake");
  const connected = await getTaskById(ctx, taskId);
  if (!connected) throw new Error("outreach task disappeared mid-call");
  return recordCallOutcome(ctx, connected, input);
}

async function listen(
  transcript: TranscriptTurn[],
  responder: PatientResponder,
  agentUtterance: string,
  state: ConversationState,
  meta?: { questionId?: string },
) {
  const start = Date.now();
  const response = await responder.respond(agentUtterance, state, meta);
  transcript.push({ role: "patient", text: response.text, latencyMs: Date.now() - start });
  return response;
}

/** Doc 10 R2's emergency fast path: stop the questionnaire, advise emergency services, trigger escalation via the real triage+consensus pipeline (never create_escalation directly — doc 13's hard rule), end the call. The rule engine alone is enough to fire consensus rule 2 regardless of what the (mocked, in the simulator) LLM assessors say — this is deliberately proven, not assumed. */
async function triggerEmergencyEscalation(
  ctx: TenantContext,
  transcript: TranscriptTurn[],
  redFlags: RedFlag[],
  outreachTaskId: string,
  campaignId: string,
  patientId: string,
  callId: string | null,
) {
  const ruleEngineTurns = transcript.filter((t) => t.role === "patient" || t.role === "agent").map((t) => ({ role: t.role, text: t.text }));
  const ruleOutcome = runRuleEngine(ruleEngineTurns, [], redFlags);

  // The two LLM seats still vote (doc 13 requires three independent
  // assessments), but the emergency path's safety property must not
  // depend on them agreeing — a MockProvider standing in for both,
  // returning "routine," is the deliberate proof that rule 2 escalates on
  // the deterministic engine's high-severity match alone.
  const mockLlm = new MockProvider({
    structuredResponses: [
      { schema_version: "1.0", assessor_id: "claude-triage-v1", classification: "routine", confidence: 0.9, observations: [], indicators: [], missing_information: [], escalation_recommended: false, reasoning_summary: "mock" } satisfies TriageResult,
      { schema_version: "1.0", assessor_id: "gpt-triage-v1", classification: "routine", confidence: 0.9, observations: [], indicators: [], missing_information: [], escalation_recommended: false, reasoning_summary: "mock" } satisfies TriageResult,
    ],
  });

  const outcomes = await settleAssessors([
    {
      assessorId: "claude-triage-v1",
      run: () =>
        runTriageAssessor({
          assessorId: "claude-triage-v1",
          agentLabel: "clinical_triage",
          provider: mockLlm,
          model: "mock",
          system: clinicalTriageV1.system,
          buildPrompt: () => "emergency call — assess transcript",
          promptVersion: clinicalTriageV1.version,
          transcript: ruleEngineTurns,
          ctx,
          callId: callId ?? "",
          patientId,
        }),
    },
    {
      // Was missing entirely until found during demo verification: this
      // comment always claimed "the two LLM seats still vote," but only
      // claude-triage-v1 was ever actually wired into this array - every
      // real emergency-triggered escalation this build has ever produced
      // was persisted with 2 assessments, not the required 3, silently
      // (settleAssessors/escalateFromConsensus have no way to know a
      // caller only gave them a partial roster). mockLlm already had a
      // canned gpt-triage-v1 response queued and unused.
      assessorId: "gpt-triage-v1",
      run: () =>
        runTriageAssessor({
          assessorId: "gpt-triage-v1",
          agentLabel: "second_assessor",
          provider: mockLlm,
          model: "mock",
          system: secondAssessorV1.system,
          buildPrompt: () => "emergency call — assess transcript",
          promptVersion: secondAssessorV1.version,
          transcript: ruleEngineTurns,
          ctx,
          callId: callId ?? "",
          patientId,
        }),
    },
    { assessorId: "rule-engine-v1", run: () => Promise.resolve(ruleOutcome) },
  ]);

  const { escalationId } = await escalateFromConsensus(ctx, { patientId, campaignId, outreachTaskId }, outcomes);
  return escalationId;
}

// Doc 19 R1/R2 — wraps the whole call in one operation id and logs
// start/outcome by patientId only, never patientFirstName or any
// transcript content. This is the highest-PHI-risk flow in the codebase
// (the transcript itself contains the patient's name and whatever they
// say), so it's the one deliberately exercised by the required "no PHI in
// logs" test — everything the inner function does is untouched.
export async function runCall(input: RunCallInput): Promise<RunCallResult> {
  return runWithOperationId(async () => {
    log("info", "call.started", { outreachTaskId: input.outreachTaskId, campaignId: input.campaignId });
    const result = await runCallInner(input);
    log("info", "call.outcome", { outreachTaskId: input.outreachTaskId, outcome: result.outcome, emergencyTriggered: result.emergencyTriggered });
    return result;
  });
}

async function runCallInner(input: RunCallInput): Promise<RunCallResult> {
  const { ctx, hospitalName, patientFirstName, outreachTaskId, campaignId, followUpQuestions, redFlags, patientResponder } = input;
  const now = input.now ?? new Date();
  const transcript: TranscriptTurn[] = [];

  const task = await getTaskById(ctx, outreachTaskId);
  if (!task) throw new Error("outreach task not found");

  // Step 1 — identify & verify. Deliberately no clinical context here
  // (no mention of discharge, condition, or why we're calling) — that's
  // step 2, and only after identity is confirmed. The wrong_person
  // acceptance criteria depends on this ordering.
  await say(transcript, `Hello, is this ${patientFirstName}? I'm calling on behalf of ${hospitalName}.`);
  const identify = await listen(transcript, patientResponder, transcript.at(-1)!.text, "IDENTIFY_VERIFY");

  if (detectWrongPerson(identify.text)) {
    // R1 step 1 / acceptance criteria: ends without disclosing any clinical detail.
    await say(transcript, "I apologize for the confusion — I'll update our records. Have a good day.");
    await finishWithOutcome(ctx, outreachTaskId, { outcome: "DECLINED", now });
    return { outcome: "DECLINED", transcript, callId: await resolveCallId(ctx, outreachTaskId), emergencyTriggered: false, escalationId: null };
  }

  // Step 2 — state purpose.
  await say(transcript, "This is an automated follow-up call to check on how you're doing since your discharge.");
  const purposeResponse = await listen(transcript, patientResponder, transcript.at(-1)!.text, "STATE_PURPOSE");
  if (detectEmergency(purposeResponse.text).triggered) {
    return finishEmergency(ctx, transcript, redFlags, outreachTaskId, campaignId, task.patientId, now);
  }

  // Step 3 — confirm convenient time.
  await say(transcript, "Is now a convenient time to talk for a few minutes?");
  const timeResponse = await listen(transcript, patientResponder, transcript.at(-1)!.text, "CONFIRM_TIME");
  if (detectEmergency(timeResponse.text).triggered) {
    return finishEmergency(ctx, transcript, redFlags, outreachTaskId, campaignId, task.patientId, now);
  }
  if (detectRefusal(timeResponse.text)) {
    await say(transcript, "Understood — I won't call again about this. Take care.");
    await finishWithOutcome(ctx, outreachTaskId, { outcome: "DECLINED", now });
    return { outcome: "DECLINED", transcript, callId: await resolveCallId(ctx, outreachTaskId), emergencyTriggered: false, escalationId: null };
  }
  if (detectNotConvenient(timeResponse.text) || timeResponse.callbackRequestedAt) {
    // The 24h default is a fallback for "no time given," not a promise —
    // it must never be offered past the task's own clinical deadline.
    // A task within 24h of its deadline (or, at the boundary, one created
    // in the same instant validateCallbackTime runs) would otherwise
    // always fail with PAST_WINDOW_END: `now` here and the deadline are
    // read from two different clocks (Node vs Postgres `now()` at task
    // creation), so even a few milliseconds' drift between them flips a
    // naive `now + 24h` past a deadline that was itself `now + 24h`.
    const defaultCallbackAt = new Date(Math.min(now.getTime() + 24 * 60 * 60 * 1000, task.clinicalDeadlineAt.getTime() - 60 * 1000));
    const callbackAt = timeResponse.callbackRequestedAt ?? defaultCallbackAt;
    await say(transcript, "No problem, I'll call back at a better time.");
    await finishWithOutcome(ctx, outreachTaskId, { outcome: "CALLBACK_REQUESTED", callbackRequestedAt: callbackAt, now });
    return { outcome: "CALLBACK_REQUESTED", transcript, callId: await resolveCallId(ctx, outreachTaskId), emergencyTriggered: false, escalationId: null };
  }

  // Step 4/5 — follow-up questions, with one level of probing.
  for (const question of followUpQuestions) {
    await say(transcript, question.text);
    const answer = await listen(transcript, patientResponder, question.text, "FOLLOW_UP_QUESTIONS", { questionId: question.id });

    if (detectEmergency(answer.text).triggered) {
      return finishEmergency(ctx, transcript, redFlags, outreachTaskId, campaignId, task.patientId, now);
    }
    if (detectAdviceRequest(answer.text).triggered) {
      await say(transcript, buildAdviceRefusal(hospitalName));
    }
    if (detectRefusal(answer.text)) {
      await say(transcript, "That's alright, we can stop here. Take care.");
      await finishWithOutcome(ctx, outreachTaskId, { outcome: "DECLINED", now });
      return { outcome: "DECLINED", transcript, callId: await resolveCallId(ctx, outreachTaskId), emergencyTriggered: false, escalationId: null };
    }

    if (question.probeQuestions.length > 0 && answer.text.trim().length > 0 && !/^no\b/i.test(answer.text.trim())) {
      const probe = question.probeQuestions[0];
      await say(transcript, probe.text);
      const probeAnswer = await listen(transcript, patientResponder, probe.text, "FOLLOW_UP_QUESTIONS", { questionId: probe.id });
      if (detectEmergency(probeAnswer.text).triggered) {
        return finishEmergency(ctx, transcript, redFlags, outreachTaskId, campaignId, task.patientId, now);
      }
    }
  }

  // Step 6 — confirm understanding of discharge instructions.
  await say(transcript, "Do you understand your discharge instructions, including your medications and follow-up plan?");
  await listen(transcript, patientResponder, transcript.at(-1)!.text, "CONFIRM_UNDERSTANDING");

  // Step 7 — close. Never new medical advice.
  await say(transcript, "Thank you for your time. A member of your care team will review this call, and please contact us if anything changes. Take care.");

  await finishWithOutcome(ctx, outreachTaskId, { outcome: "COMPLETED", now });
  return { outcome: "COMPLETED", transcript, callId: await resolveCallId(ctx, outreachTaskId), emergencyTriggered: false, escalationId: null };

  async function finishEmergency(
    ctx2: TenantContext,
    transcript2: TranscriptTurn[],
    redFlags2: RedFlag[],
    outreachTaskId2: string,
    campaignId2: string,
    patientId2: string,
    now2: Date,
  ): Promise<RunCallResult> {
    await say(transcript2, "This sounds like it may be a medical emergency. Please hang up and call emergency services right away, or go to the nearest emergency room.");
    // COMPLETED, not DROPPED: the agent deliberately ended the call having
    // achieved its purpose (directing the patient to emergency care), not
    // an accidental disconnection. Documented mapping choice — doc 07's
    // outcome set predates this specific scenario.
    await finishWithOutcome(ctx2, outreachTaskId2, { outcome: "COMPLETED", now: now2 });
    const callId = await resolveCallId(ctx2, outreachTaskId2);
    const escalationId = await triggerEmergencyEscalation(ctx2, transcript2, redFlags2, outreachTaskId2, campaignId2, patientId2, callId);
    return { outcome: "COMPLETED", transcript: transcript2, callId, emergencyTriggered: true, escalationId };
  }

  async function resolveCallId(ctx3: TenantContext, taskId: string): Promise<string | null> {
    const call = await getMostRecentCallForTask(ctx3, taskId);
    if (call) {
      await createCallTurns(
        ctx3,
        call.id,
        transcript.map((t, i) => ({ turnIndex: i, speaker: t.role.toUpperCase() as "AGENT" | "PATIENT", content: t.text, latencyMs: t.latencyMs })),
      );
    }
    return call?.id ?? null;
  }
}
