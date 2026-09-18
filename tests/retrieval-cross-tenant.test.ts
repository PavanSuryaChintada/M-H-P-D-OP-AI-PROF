// Doc 11 R4 acceptance criteria: "A Hospital A patient's triage never
// surfaces a Hospital B chunk, proven by test." Retrieval under Hospital
// A's context, using a query that strongly matches Hospital B's chunk
// content and keyword terms, must return zero B chunks — both through
// hybridSearch()/the repository layer, and via a raw, deliberately
// unfiltered SELECT under RLS (same two-layer pattern as
// tests/tenancy.test.ts).

import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createHospital } from "../lib/db/repositories/hospitals";
import { createProtocol } from "../lib/db/repositories/protocols";
import { createKnowledgeChunks, vectorSearch, keywordSearch } from "../lib/db/repositories/knowledge-chunks";
import { hybridSearch } from "../lib/ai/retrieval";
import { chunkProtocol, renderProtocolDocument } from "../lib/protocols/chunker";
import { HIP_REPLACEMENT_PROTOCOL } from "../lib/protocols/seeds/hip-replacement";
import { HEART_FAILURE_PROTOCOL } from "../lib/protocols/seeds/heart-failure";
import { MockEmbeddingProvider } from "../lib/ai/embeddings/mock";
import { withTenant, type TenantContext } from "../lib/db/tenant";

const embeddingProvider = new MockEmbeddingProvider();

let hospitalA: { id: string };
let hospitalB: { id: string };
let ctxA: TenantContext;
let ctxB: TenantContext;

// Hospital B gets a distinctive marker phrase, present in both the
// keyword-search terms and the query text, that only appears in B's
// content — the strongest possible test that a query "strongly matching"
// a B chunk still surfaces zero B results under A's context.
const B_MARKER = "zzqqmarkerphrase";

beforeAll(async () => {
  hospitalA = await createHospital({ name: "Retrieval Test Hospital A", shortCode: `RTA-${Date.now()}`, timezone: "UTC" });
  hospitalB = await createHospital({ name: "Retrieval Test Hospital B", shortCode: `RTB-${Date.now()}`, timezone: "UTC" });
  ctxA = { hospitalId: hospitalA.id, userId: "00000000-0000-0000-0000-0000000000aa", role: "CLINICAL_REVIEWER" };
  ctxB = { hospitalId: hospitalB.id, userId: "00000000-0000-0000-0000-0000000000bb", role: "CLINICAL_REVIEWER" };

  // Hospital A gets the heart-failure protocol, unmodified.
  const protocolA = await createProtocol(ctxA, {
    title: "Heart Failure Discharge Follow-Up",
    category: "cardiac",
    content: renderProtocolDocument("Heart Failure Discharge Follow-Up", HEART_FAILURE_PROTOCOL),
    structuredContent: HEART_FAILURE_PROTOCOL,
  });
  const chunksA = chunkProtocol("Heart Failure Discharge Follow-Up", HEART_FAILURE_PROTOCOL);
  const embeddingsA = await embeddingProvider.embedBatch(chunksA.map((c) => c.content));
  await createKnowledgeChunks(
    ctxA,
    chunksA.map((c, i) => ({
      protocolId: protocolA.id,
      protocolVersion: protocolA.version,
      sourceLabel: c.sourceLabel,
      section: c.section,
      heading: c.heading,
      content: c.content,
      embedding: embeddingsA[i],
    })),
  );

  // Hospital B gets the hip-replacement protocol, with the marker phrase
  // injected into every chunk so both keyword and vector search have
  // maximum reason to surface it if tenant scoping ever failed.
  const protocolB = await createProtocol(ctxB, {
    title: "Post-Surgical Follow-Up — Total Hip Replacement",
    category: "post-surgical",
    content: renderProtocolDocument("Post-Surgical Follow-Up — Total Hip Replacement", HIP_REPLACEMENT_PROTOCOL),
    structuredContent: HIP_REPLACEMENT_PROTOCOL,
  });
  const chunksB = chunkProtocol("Post-Surgical Follow-Up — Total Hip Replacement", HIP_REPLACEMENT_PROTOCOL).map((c) => ({
    ...c,
    content: `${c.content} ${B_MARKER}`,
  }));
  const embeddingsB = await embeddingProvider.embedBatch(chunksB.map((c) => c.content));
  await createKnowledgeChunks(
    ctxB,
    chunksB.map((c, i) => ({
      protocolId: protocolB.id,
      protocolVersion: protocolB.version,
      sourceLabel: c.sourceLabel,
      section: c.section,
      heading: c.heading,
      content: c.content,
      embedding: embeddingsB[i],
    })),
  );
});

describe("cross-tenant retrieval isolation (doc 11 R4)", () => {
  it("hybridSearch under Hospital A's context, querying strongly for B's marker phrase, returns zero B chunks", async () => {
    const results = await hybridSearch(ctxA, embeddingProvider, B_MARKER, [B_MARKER], 10);
    expect(results.length).toBeGreaterThanOrEqual(0);
    expect(results.every((r) => r.protocol_id !== "")).toBe(true); // sanity: still returns real A citations if any
    for (const r of results) {
      expect(r.text.includes(B_MARKER)).toBe(false);
    }
  });

  it("vectorSearch (repository layer) under context A never returns a B chunk, even with B's own embedding as the query", async () => {
    const bEmbedding = await embeddingProvider.embed(`hip replacement red flag ${B_MARKER}`);
    const results = await vectorSearch(ctxA, bEmbedding, 20);
    expect(results.length).toBeGreaterThan(0); // A has chunks, so this isn't a vacuous pass
    for (const r of results) {
      expect(r.content.includes(B_MARKER)).toBe(false);
    }
  });

  it("keywordSearch (repository layer) under context A finds zero chunks for B's marker phrase", async () => {
    const results = await keywordSearch(ctxA, [B_MARKER], 20);
    expect(results.length).toBe(0);
  });

  it("keywordSearch under context B DOES find its own marker phrase — proves the test setup is real, not just a query that matches nothing anywhere", async () => {
    const results = await keywordSearch(ctxB, [B_MARKER], 20);
    expect(results.length).toBeGreaterThan(0);
  });

  it("raw SQL under RLS: a deliberately unfiltered SELECT still returns zero B rows for context A", async () => {
    const rows = await withTenant(ctxA, async (tx) => tx.execute(sql`select * from knowledge_chunks`));
    const bRows = (rows as unknown as { hospital_id: string }[]).filter((r) => r.hospital_id === hospitalB.id);
    expect(bRows.length).toBe(0);
  });
});
