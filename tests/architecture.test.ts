// Doc 01 R2.3: "A lint/test that fails CI if any db.select() is called
// outside a repository." Static check, no database needed — runs on every
// commit, unlike tests/tenancy.test.ts which needs a live Postgres.
//
// Also catches tx.select/insert/update/delete(, not just db.* — the withTenant()
// callback parameter is conventionally named `tx` everywhere in this codebase,
// and a query issued on it from outside a repository bypasses this check just
// as much as a raw `db.*` call would (found while wiring doc 02's Platform
// Admin audited-access path — it would have slipped through undetected).

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "worker", "sim", "eval"];
const ALLOWED_DIR = join("lib", "db", "repositories");
const QUERY_CALL = /\b(?:db|tx)\.(select|insert|update|delete)\s*\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("R2.3 — db.select/insert/update/delete only inside lib/db/repositories", () => {
  it("finds no direct query calls outside a repository file", () => {
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      const dirPath = join(ROOT, dir);
      try {
        statSync(dirPath);
      } catch {
        continue; // directory doesn't exist yet — fine, nothing to scan
      }
      for (const file of walk(dirPath)) {
        const rel = relative(ROOT, file);
        if (rel.startsWith(ALLOWED_DIR)) continue;
        if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
        const content = readFileSync(file, "utf-8");
        if (QUERY_CALL.test(content)) offenders.push(rel);
      }
    }

    expect(offenders, `db.* query calls found outside repositories:\n${offenders.join("\n")}`).toEqual([]);
  });
});
