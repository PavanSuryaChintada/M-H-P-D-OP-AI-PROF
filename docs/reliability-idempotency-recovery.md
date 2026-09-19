# Reliability, Idempotency & Recovery (Doc 20)

## Idempotency: five of seven operations already had it, more strongly

Of R1's seven listed operations, five already have DB-level idempotency from earlier docs — a stronger guarantee than a generic key-value replay table, since a unique constraint can't be bypassed by forgetting to check first: start call / record outcome (`calls` UNIQUE(outreach_task_id, attempt_number), doc 07), create escalation (`escalations` same shape, doc 13), EHR write (`ehr_idempotency_records`, doc 15), consume event (`events.idempotency_key` UNIQUE, doc 16). The new `idempotency_keys` table + `withIdempotency()` helper (`lib/reliability/idempotency.ts`) covers the two that didn't: send notification, process discharge.

## Circuit breaker reuses doc 12/13's existing failure handling — zero new escalation logic

`lib/reliability/circuit-breaker.ts` is a small in-memory per-dependency state machine (5 consecutive failures → open 60s → one half-open probe). Wired into `managed-call.ts`'s `runGenerate`/`runStructured`: an open breaker fails fast in the **exact same `PROVIDER_ERROR` shape** a real provider outage already produces. This means doc 12's repair loop and doc 13's consensus rule 4 (reduced-assessor escalation) handle a tripped breaker correctly with **no changes to either** — they already can't tell the difference between "the provider is actually down" and "the breaker decided to stop asking," which is precisely the point: the reduced-assessor case escalates either way, never silently proceeding with fewer voters.

A malformed-output validation failure does **not** count toward the breaker — R2's own taxonomy treats "AI malformed output" (repair once) as a different failure class from "AI provider outage" (breaker-worthy); conflating them would trip the breaker on a prompt/schema mismatch that has nothing to do with the provider's health.

## Timeouts

AI: 30s (already existed, doc 09). EHR: 10s, added this doc (`lib/ehr/client.ts`). Call turn (20s per R4): **not implemented** — doc 10's voice intake is a deterministic, synchronous simulated conversation (no real telephony, no real per-turn network latency to bound), so a timeout here would have nothing meaningful to time. Documented as N/A rather than adding a timeout wrapper around code that never actually awaits anything slow.

## Graceful shutdown is a ready-to-wire handler, not a running daemon

This build's queue/event processing runs as on-demand function calls (`claimNextTask`, `processNextEvent`) invoked per request, not a long-running worker process — see `docs/queue-design.md`'s doc 08 section. There is no persistent process for `SIGTERM` to signal today. `lib/reliability/shutdown.ts` is the handler a real always-on worker (the shape doc 06/07 assume in production) would install; it's exercised directly by its own test rather than by an actual daemon in this environment. Documented rather than left silently unimplemented.

## The chaos test

`tests/reliability-chaos.test.ts`: 50 tasks, a seeded deterministic RNG splits outcomes ~70% success / 15% call failure (`PROVIDER_ERROR`) / 15% simulated worker crash (lease backdated, never released until the real reaper runs — not a shortcut around doc 07's actual recovery path). Two real bugs found writing it (same class as doc 18/19's): `createHospital` doesn't auto-create a `hospital_capacity` row (fixed by inserting one, not updating); and `COMPLETED` is only reachable from `CONNECTED`, not directly from `CALLING` (doc 10's own known state-machine asymmetry) — fixed by connecting first, exactly as `run-call.ts`'s `finishWithOutcome` already does.

**Doesn't assert a fixed claim count.** A simulated crash holds its capacity slot until the reaper runs (after the loop, matching the real recovery path), so enough accumulated crashes can legitimately exhaust capacity before all 50 tasks are reachable in a single pass — that's a real, correct property (capacity never over-allocates even under a flood of unrecovered crashes), not a bug to hide behind a fixed iteration count. What's asserted instead: internal consistency (claimed = crashed + failed + completed), zero tasks left in CALLING/CONNECTED after reaping, capacity returns to exactly 0, and zero duplicate `calls` rows.

## What this build does not cover

- `withIdempotency()` is built but not yet wired into the notification/discharge-ingestion call sites it was built for (both already have narrower ad-hoc protections — doc 16's `hasNotificationTagged` tag check, doc 04's source-message dedup — that work today; wiring the generic helper in on top is follow-on work, not done here).
- Full timeout coverage of every external call (only AI and EHR are wrapped explicitly; call-turn timing is N/A per above).
- The shutdown handler is unit-tested but has no real process to attach to in this build's architecture.
