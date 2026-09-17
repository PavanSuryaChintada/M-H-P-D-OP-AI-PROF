import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one live Supabase project through a pooled
    // connection with a limited number of slots (Supavisor). Running test
    // files in parallel (Vitest's default) was exhausting it under load and
    // producing hook/test timeouts that looked like logic bugs but weren't.
    fileParallelism: false,
    // This dev network sees several seconds of round-trip latency per query
    // to the Supabase pooler (confirmed directly — a single "select 1" took
    // 3.5-8.4s across repeated tries). A beforeAll with several sequential
    // writes can legitimately take tens of seconds; that's not a hang.
    hookTimeout: 60000,
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
