// Doc 11 R3 — embedding provider abstraction, same reasoning as doc 09's
// AIProvider: never call an embeddings SDK directly from chunking/
// retrieval code, always through this interface so MockEmbeddingProvider
// can stand in for tests and seeding without a real API key.

export interface EmbeddingProvider {
  id: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
