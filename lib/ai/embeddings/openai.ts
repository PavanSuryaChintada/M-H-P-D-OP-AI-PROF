// Doc 11 R3 — real embeddings for pgvector similarity search.
// text-embedding-3-small: 1536 dimensions, matching knowledge_chunks.embedding.

import OpenAI from "openai";
import type { EmbeddingProvider } from "./types";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai-text-embedding-3-small";
  readonly dimensions = 1536;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await this.client.embeddings.create({ model: "text-embedding-3-small", input: texts });
    return response.data.map((d) => d.embedding);
  }
}
