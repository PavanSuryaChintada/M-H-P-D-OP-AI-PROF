// Doc 11 R2 deliverable: seed the three real-shaped protocols into every
// existing hospital, chunk them, and embed the chunks. Doc 03's hospital
// seeding explicitly left "at least one protocol" as the one remaining
// readiness gap "until doc 11 lands" — this closes it, and a hospital
// that was only missing protocols can now report ready.
//
// Uses MockEmbeddingProvider by default (deterministic, no API key
// needed) unless OPENAI_API_KEY is set in the environment, in which case
// real embeddings are used for genuinely meaningful vector search.
//
// Usage: npx tsx scripts/seed-protocols.ts

import "dotenv/config";
import { listHospitals } from "../lib/db/repositories/hospitals";
import { createProtocol } from "../lib/db/repositories/protocols";
import { createKnowledgeChunks } from "../lib/db/repositories/knowledge-chunks";
import { chunkProtocol, renderProtocolDocument } from "../lib/protocols/chunker";
import { HIP_REPLACEMENT_PROTOCOL } from "../lib/protocols/seeds/hip-replacement";
import { HEART_FAILURE_PROTOCOL } from "../lib/protocols/seeds/heart-failure";
import { GENERAL_MEDICAL_PROTOCOL } from "../lib/protocols/seeds/general-medical";
import { MockEmbeddingProvider } from "../lib/ai/embeddings/mock";
import { OpenAIEmbeddingProvider } from "../lib/ai/embeddings/openai";
import type { EmbeddingProvider } from "../lib/ai/embeddings/types";
import type { TenantContext } from "../lib/db/tenant";
import type { StructuredProtocol } from "../lib/protocols/schema";

// Only the real, named demo hospitals (scripts/seed-demo-hospitals.ts,
// scripts/seed-demo-users.ts) — not every hospital in the database, which
// after a session of test runs includes dozens of throwaway
// "... Test Hospital" rows created by tests/sim scripts. Seeding all of
// them would be slow and would pollute test fixtures with unrelated data.
const DEMO_HOSPITAL_NAMES = ["Northside General", "Harbour Clinic", "Rural Health Post", "Demo General Hospital"];

const PROTOCOLS: { title: string; category: string; protocol: StructuredProtocol }[] = [
  { title: "Post-Surgical Follow-Up — Total Hip Replacement", category: "post-surgical", protocol: HIP_REPLACEMENT_PROTOCOL },
  { title: "Heart Failure Discharge Follow-Up", category: "cardiac", protocol: HEART_FAILURE_PROTOCOL },
  { title: "General Medical Discharge Follow-Up", category: "general", protocol: GENERAL_MEDICAL_PROTOCOL },
];

async function seedForHospital(ctx: TenantContext, embeddingProvider: EmbeddingProvider) {
  for (const { title, category, protocol } of PROTOCOLS) {
    const content = renderProtocolDocument(title, protocol);
    const row = await createProtocol(ctx, { title, category, content, structuredContent: protocol });

    const chunks = chunkProtocol(title, protocol);
    const embeddings = await embeddingProvider.embedBatch(chunks.map((c) => c.content));
    await createKnowledgeChunks(
      ctx,
      chunks.map((c, i) => ({
        protocolId: row.id,
        protocolVersion: row.version,
        sourceLabel: c.sourceLabel,
        section: c.section,
        heading: c.heading,
        content: c.content,
        embedding: embeddings[i],
      })),
    );
    console.log(`  ${title}: ${chunks.length} chunks`);
  }
}

async function main() {
  const embeddingProvider: EmbeddingProvider = process.env.OPENAI_API_KEY
    ? new OpenAIEmbeddingProvider(process.env.OPENAI_API_KEY)
    : new MockEmbeddingProvider();
  console.log(`Using embedding provider: ${embeddingProvider.id}`);

  const allHospitals = await listHospitals();
  const hospitals = allHospitals.filter((h) => DEMO_HOSPITAL_NAMES.includes(h.name));
  if (hospitals.length === 0) {
    console.error(`No demo hospitals found matching ${DEMO_HOSPITAL_NAMES.join(", ")} — run npm run seed:hospitals / seed:demo-users first.`);
    process.exit(1);
  }
  for (const hospital of hospitals) {
    console.log(`Seeding protocols for ${hospital.name} (${hospital.id})`);
    const ctx: TenantContext = { hospitalId: hospital.id, userId: "00000000-0000-0000-0000-000000000000", role: "HOSPITAL_ADMIN" };
    await seedForHospital(ctx, embeddingProvider);
  }
  console.log(`Done — seeded ${PROTOCOLS.length} protocols into ${hospitals.length} hospital(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
