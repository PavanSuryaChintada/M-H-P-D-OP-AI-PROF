// Doc 09 §2 deliverable tests: a tool called with a foreign hospital_id is
// rejected, the intake agent calling create_escalation is rejected,
// malformed args return a structured error, and (doc 09 §3) a provider
// timeout produces a PROVIDER_ERROR result.

import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { callTool } from "../lib/ai/tools/registry";
import { runGenerate, runStructured } from "../lib/ai/providers/managed-call";
import { MockProvider } from "../lib/ai/providers/mock";
import type { AIProvider } from "../lib/ai/providers/types";
import { createHospital } from "../lib/db/repositories/hospitals";
import type { TenantContext } from "../lib/db/tenant";

let hospital: { id: string };
const ctx = (): TenantContext => ({
  hospitalId: hospital.id,
  userId: "00000000-0000-0000-0000-000000000000",
  role: "HOSPITAL_ADMIN",
});

beforeAll(async () => {
  hospital = await createHospital({ name: "AI Gateway Test Hospital", shortCode: `AIG-${Date.now()}`, timezone: "UTC" });
});

describe("callTool — the controlled gateway", () => {
  it("rejects unknown tools", async () => {
    const result = await callTool("voice_intake", ctx(), "not_a_real_tool", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN_TOOL");
  });

  it("rejects a tool call with a hospital_id in the raw args — the AI never supplies tenancy, TenantContext does", async () => {
    const result = await callTool("voice_intake", ctx(), "lookup_patient", {
      patientId: "11111111-1111-4111-8111-111111111111",
      hospitalId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TENANT_VIOLATION");
  });

  it("also rejects the snake_case spelling of hospital_id", async () => {
    const result = await callTool("voice_intake", ctx(), "lookup_patient", {
      patientId: "11111111-1111-4111-8111-111111111111",
      hospital_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TENANT_VIOLATION");
  });

  it("rejects the voice intake agent calling create_escalation — only the consensus system may", async () => {
    const result = await callTool("voice_intake", ctx(), "create_escalation", {
      patientId: "11111111-1111-4111-8111-111111111111",
      triggerReason: "test",
      priority: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AGENT_NOT_ALLOWED");
  });

  it("allows the escalation consensus agent to call create_escalation (allowlist passes; a bogus patientId still fails, but at execution, not the allowlist)", async () => {
    const result = await callTool("escalation_consensus", ctx(), "create_escalation", {
      patientId: "11111111-1111-4111-8111-111111111111",
      triggerReason: "red flag matched",
      priority: 3,
    });
    // FK violation at execution — proves it got past every gateway stage
    // before the allowlist, unlike the voice_intake case above.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EXECUTION_ERROR");
  });

  it("returns a structured INVALID_ARGS error for malformed args, not a thrown exception", async () => {
    const result = await callTool("voice_intake", ctx(), "lookup_patient", { patientId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ARGS");
  });

  it("returns INVALID_ARGS when a required field is missing entirely", async () => {
    const result = await callTool("clinical_triage", ctx(), "record_observation", { code: "pain_score" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ARGS");
  });
});

describe("provider timeout/retry -> PROVIDER_ERROR (doc 09 §3)", () => {
  it("runGenerate returns PROVIDER_ERROR after retries when the provider never resolves in time", async () => {
    const hangingProvider: AIProvider = {
      id: "hanging-mock",
      generate: () => new Promise(() => {}), // never resolves
      generateStructured: () => new Promise(() => {}),
    };

    const result = await runGenerate(
      hangingProvider,
      "test-model",
      { system: "s", prompt: "p" },
      { ctx: ctx(), agent: "voice_intake", timeoutMs: 20, maxRetries: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROVIDER_ERROR");
  });

  it("runStructured returns PROVIDER_ERROR when the provider's output never validates against the schema", async () => {
    const provider = new MockProvider({ structuredResponses: [{ wrong: "shape" }, { still: "wrong" }] });
    const schema = z.object({ classification: z.enum(["routine", "urgent"]) });

    const result = await runStructured(
      provider,
      "mock-model",
      { system: "s", prompt: "p", schema },
      { ctx: ctx(), agent: "clinical_triage", maxRetries: 1 },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PROVIDER_ERROR");
  });

  it("runStructured succeeds and returns validated data when the mock response matches the schema", async () => {
    const provider = new MockProvider({ structuredResponses: [{ classification: "routine" }] });
    const schema = z.object({ classification: z.enum(["routine", "urgent"]) });

    const result = await runStructured(
      provider,
      "mock-model",
      { system: "s", prompt: "p", schema },
      { ctx: ctx(), agent: "clinical_triage" },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.data.classification).toBe("routine");
  });
});
