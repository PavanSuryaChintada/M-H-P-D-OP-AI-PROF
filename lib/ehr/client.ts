// Doc 15 R1/R2 — MockEHRClient implements EHRClient by calling the
// /api/mock-ehr/* route handlers directly with constructed Request objects,
// rather than over a live HTTP socket. This still goes through the real
// route module (real Request/Response serialization, real injected latency
// via an actual await, real idempotency/failure semantics) — it is only the
// literal network hop that's skipped, which is what makes doc 15's own
// required tests ("error rate forced to 100%... dropping to 0 and running
// the retry worker") fast and deterministic in vitest. Once this app is
// deployed, these same route handlers run as real Next.js API routes
// reachable over the network like any other — nothing here changes.

import type { TenantContext } from "../db/tenant";
import type {
  EHRClient,
  FHIRPatient,
  FHIREncounter,
  FHIRCondition,
  FHIRCarePlan,
  WriteResult,
  WriteCommunicationInput,
  WriteObservationInput,
  CreateTaskInput,
  WriteEncounterNoteInput,
} from "./types";
import { EHRCallError } from "./types";
import { withTimeout } from "../reliability/timeout";

const EHR_TIMEOUT_MS = 10_000; // doc 20 R4
import { GET as getPatientRoute } from "../../app/api/mock-ehr/patient/route";
import { GET as getEncounterRoute } from "../../app/api/mock-ehr/encounter/route";
import { GET as getConditionsRoute } from "../../app/api/mock-ehr/conditions/route";
import { GET as getCarePlanRoute } from "../../app/api/mock-ehr/careplan/route";
import { POST as postCommunicationRoute } from "../../app/api/mock-ehr/communication/route";
import { POST as postObservationRoute } from "../../app/api/mock-ehr/observation/route";
import { POST as postTaskRoute } from "../../app/api/mock-ehr/task/route";
import { POST as postEncounterNoteRoute } from "../../app/api/mock-ehr/encounter-note/route";

const BASE_URL = "http://mock-ehr.internal";

async function get(routeHandler: (req: Request) => Promise<Response>, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await withTimeout(routeHandler(new Request(url)), EHR_TIMEOUT_MS, "EHR call");
  const body = await response.json();
  if (!response.ok) throw new EHRCallError(response.status, body.error ?? "unknown error");
  return body;
}

async function post(
  routeHandler: (req: Request) => Promise<Response>,
  path: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const request = new Request(new URL(path, BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await withTimeout(routeHandler(request), EHR_TIMEOUT_MS, "EHR call");
  const responseBody = await response.json();
  if (!response.ok) throw new EHRCallError(response.status, responseBody.error ?? "unknown error");
  return responseBody as WriteResult;
}

export class MockEHRClient implements EHRClient {
  async getPatient(ctx: TenantContext, patientId: string): Promise<FHIRPatient> {
    return get(getPatientRoute, "/patient", { hospitalId: ctx.hospitalId, patientId }) as Promise<FHIRPatient>;
  }

  async getEncounter(ctx: TenantContext, encounterId: string): Promise<FHIREncounter> {
    return get(getEncounterRoute, "/encounter", { hospitalId: ctx.hospitalId, encounterId }) as Promise<FHIREncounter>;
  }

  async getConditions(ctx: TenantContext, patientId: string): Promise<FHIRCondition[]> {
    return get(getConditionsRoute, "/conditions", { hospitalId: ctx.hospitalId, patientId }) as Promise<FHIRCondition[]>;
  }

  async getCarePlan(ctx: TenantContext, patientId: string): Promise<FHIRCarePlan | null> {
    try {
      return (await get(getCarePlanRoute, "/careplan", { hospitalId: ctx.hospitalId, patientId })) as FHIRCarePlan;
    } catch (err) {
      if (err instanceof EHRCallError && err.status === 404) return null;
      throw err;
    }
  }

  async writeCommunication(ctx: TenantContext, payload: WriteCommunicationInput, idempotencyKey: string): Promise<WriteResult> {
    return post(postCommunicationRoute, "/communication", { hospitalId: ctx.hospitalId, idempotencyKey, ...payload });
  }

  async writeObservation(ctx: TenantContext, payload: WriteObservationInput, idempotencyKey: string): Promise<WriteResult> {
    return post(postObservationRoute, "/observation", { hospitalId: ctx.hospitalId, idempotencyKey, ...payload });
  }

  async createTask(ctx: TenantContext, payload: CreateTaskInput, idempotencyKey: string): Promise<WriteResult> {
    return post(postTaskRoute, "/task", { hospitalId: ctx.hospitalId, idempotencyKey, ...payload });
  }

  async writeEncounterNote(ctx: TenantContext, payload: WriteEncounterNoteInput, idempotencyKey: string): Promise<WriteResult> {
    return post(postEncounterNoteRoute, "/encounter-note", { hospitalId: ctx.hospitalId, idempotencyKey, ...payload });
  }
}

export const mockEhrClient = new MockEHRClient();
