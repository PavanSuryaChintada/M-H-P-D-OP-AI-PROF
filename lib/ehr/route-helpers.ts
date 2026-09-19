// Doc 15 R2/R3/R4 — shared plumbing for every /api/mock-ehr/* route: load
// the hospital's configured failure rate, inject latency/failure, and (for
// writes) check/record idempotency. Kept here once rather than repeated in
// each route file.

import { NextResponse } from "next/server";
import { getHospitalById } from "../db/repositories/hospitals";
import { injectFailure } from "./failure-injection";
import { findIdempotentResponse, recordIdempotentResponse } from "../db/repositories/ehr-idempotency";
import type { HospitalConfig } from "../hospitals/config-schema";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function failureRateFor(hospitalId: string): Promise<number> {
  const hospital = await getHospitalById(hospitalId);
  return (hospital?.config as HospitalConfig | null)?.ehrSettings?.failureRate ?? 0;
}

function injectedFailureResponse(outcome: "error" | "rate_limited" | "timeout"): Response {
  if (outcome === "rate_limited") return NextResponse.json({ error: "rate limited (injected)" }, { status: 429 });
  if (outcome === "timeout") return NextResponse.json({ error: "timeout (injected)" }, { status: 504 });
  return NextResponse.json({ error: "internal error (injected)" }, { status: 500 });
}

export async function handleRead(hospitalId: string, execute: () => Promise<unknown>): Promise<Response> {
  const { latencyMs, outcome } = injectFailure(await failureRateFor(hospitalId));
  await sleep(latencyMs);
  if (outcome !== "ok") return injectedFailureResponse(outcome);

  const data = await execute();
  if (data === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function handleIdempotentWrite(
  hospitalId: string,
  idempotencyKey: string,
  operation: string,
  execute: () => Promise<Record<string, unknown>>,
): Promise<Response> {
  const existing = await findIdempotentResponse(hospitalId, idempotencyKey);
  if (existing) {
    return NextResponse.json({ ...(existing.responseBody as object), replayed: true });
  }

  const { latencyMs, outcome } = injectFailure(await failureRateFor(hospitalId));
  await sleep(latencyMs);
  if (outcome !== "ok") return injectedFailureResponse(outcome);

  const body = await execute();
  const responseBody = { ...body, replayed: false };
  await recordIdempotentResponse(hospitalId, idempotencyKey, operation, responseBody);
  return NextResponse.json(responseBody, { status: 201 });
}
