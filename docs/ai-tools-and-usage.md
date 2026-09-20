# AI Tools & Usage

This project was built with a multi-tool AI workflow: each tool was scoped to
the part of the build it's strongest at, rather than one tool doing
everything. This is distinct from — and not to be confused with — the AI that
runs *inside* the product itself (the voice-intake agent, the two independent
triage assessors, the consensus arbiter, the documentation agent). That's
covered in [`docs/ai-architecture.md`](ai-architecture.md) and summarized for
a non-technical audience in
[`docs/product-ai-documentation.md`](product-ai-documentation.md). This page
is about the tools used *to build* the product.

`docs/dev-ai-usage.md` remains the detailed, session-by-session build log —
it covers the Claude Code sessions specifically (doc-by-doc, with prompts,
bugs found, and fixes). This page is the wider index: every AI tool used
anywhere in the build, and what it was responsible for.

## Tool → role

| Tool | Role | Scope in this project |
|---|---|---|
| **OpenSpec** | Architectural planning & design (PRD, TRD, DRD, workflow RD) | Split the master PRD into the 26-document spec pack in [`prd-specs/`](../prd-specs/) — one self-contained doc per feature area (data model, auth, queue, AI architecture, triage, consensus, EHR, events, dashboards, reliability, testing, deployment, etc.), sequenced by build dependency rather than numeric order. |
| **Claude Code** (Sonnet 5) | Backend development | The large majority of `lib/`, `app/api/`, `worker/`, the Drizzle schema, RLS policies, the queue, the AI provider/tool-gateway/consensus stack, and the test suite. Logged prompt-by-prompt in [`docs/dev-ai-usage.md`](dev-ai-usage.md). |
| **Antigravity** & **Komboi** | Frontend development | The admin app's Next.js pages and UI components under `app/admin/` — dashboards, the escalation review screen, the patient timeline, the config editor. |
| **Devin** | Testing | Generating and iterating on test suites — persona-based scenarios for the call simulator, concurrency/load test scaffolding, and edge-case coverage alongside the tests Claude Code wrote directly for the backend it authored. |
| **Cline** | Automation testing & CI | Building and maintaining [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — the disposable-Postgres test pipeline (typecheck → lint → secret scan → migrate → RLS → test). |
| **Gemini** | Documentation | Drafting and organizing the write-ups in [`docs/`](.) from the implemented code — turning finished features into readable design docs. |
| **OpenRouter** | API layer for calling LLM providers | The single OpenAI-compatible endpoint `lib/ai/providers/select-provider.ts` routes through to reach both triage assessors' underlying models (Claude and GPT) via one key, instead of wiring two separate vendor SDKs. See `OPENROUTER_API_KEY` in `.env.example`. |
| **ChatGPT Go** | Fixing Railway deployment issues | Interactive debugging of the worker service's Railway build/deploy configuration (start command, environment variables, build failures) — the always-on `worker/index.ts` process described in `docs/deployment.md`. |
| **Supabase bot** | Fixing SQL migration & RLS errors | Diagnosing failed migrations and row-level-security policy errors directly against the live Supabase project (e.g. constraint violations against existing rows, RLS silently denying reads on a newly added table) — used alongside the migration/RLS fixes already logged in `docs/dev-ai-usage.md`. |

## Why split this way, not one tool for everything

- **Backend correctness is the highest-graded area** (queue concurrency,
  escalation consensus, safety evaluation — see `prd-specs/24-written-deliverables.md`),
  so it went to the tool with the most sustained, session-logged accountability
  (Claude Code), not spread across tools.
- **Frontend, testing, CI, docs, and deployment** are comparatively
  well-isolated concerns with clear inputs/outputs, which made them a good
  fit for tools specialized in each — a design-to-code tool for UI, an
  autonomous testing agent for test generation, a CI-focused agent for the
  pipeline itself, and a docs-focused model for writing up already-working
  code.
- **OpenSpec's output is why the build could move doc-by-doc at all**: the
  26-file spec pack (`prd-specs/00-MASTER-BRIEF.md` through
  `prd-specs/25-optional-standout-features.md`) gave every later session —
  regardless of which tool ran it — a self-contained, dependency-ordered unit
  of work instead of one undifferentiated PRD.
- **OpenRouter, ChatGPT Go, and the Supabase bot are infrastructure/ops
  tools, not code-generation tools** — they're listed here because they're
  still part of "AI used on this project," but their role is operational
  (routing API calls, debugging a deploy, debugging a migration) rather than
  authoring features.

See [`docs/ai-prompts.md`](ai-prompts.md) for representative prompts used
with each tool above, and [`docs/dev-ai-usage.md`](dev-ai-usage.md) for the
full Claude Code session log.
