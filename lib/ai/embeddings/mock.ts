// Doc 11 — deterministic embeddings for tests and seeding without a real
// API key. Not a real semantic embedding: it's a feature-hashed bag of
// words (each word hashes into one of 1536 buckets, counts normalized),
// so texts sharing more words land closer together under cosine
// similarity than unrelated texts — good enough to prove the hybrid
// search PLUMBING works (tenant scoping, merge/rerank, citation shape)
// without claiming real semantic quality. Doc 11's own design point (R5)
// is that keyword matching on red-flag trigger terms is what actually
// carries the safety-critical recall anyway — vector similarity is the
// secondary signal even with real embeddings.

import type { EmbeddingProvider } from "./types";

function hashWord(word: string, dimensions: number): number {
  let h = 0;
  for (let i = 0; i < word.length; i++) {
    h = (Math.imul(31, h) + word.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % dimensions;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly id = "mock-embedding";
  readonly dimensions = 1536;

  async embed(text: string): Promise<number[]> {
    const vector = new Array(this.dimensions).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      vector[hashWord(word, this.dimensions)] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
