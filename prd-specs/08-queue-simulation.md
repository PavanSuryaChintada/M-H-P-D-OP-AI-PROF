# 08 — Queue Simulation (Mandatory Deliverable)

**PRD:** §12 — *"A queue simulation is mandatory"* · **Depends on:** 06, 07

---

## Scope
A harness that lets the evaluator watch the scheduler behave correctly without telephony. This is how the grader verifies doc 06 and 07. Treat it as a demo artefact, not a test.

## Requirements

**R1 — Dataset:** 20–30 mock patients, one hospital, **capacity deliberately set to 3**. Low capacity makes the constraint visible.

Composition, fixed and committed:
- 6 low risk, 10 medium, 8 high, 4 critical
- 4 patients within 2h of window expiry at t=0 (proves Tier 1)
- 3 who request callbacks (proves Tier 0)
- 3 invalid numbers (proves no-retry → manual)
- 4 who will drop mid-call (proves context resumption)
- 2 who will present red flags (proves escalation path)
- 2 campaigns running simultaneously with weights 0.7 / 0.3 (proves fairness)

**R2 — Deterministic:** seeded RNG. Same seed → same trace, every run. The evaluator must be able to reproduce your recording.

**R3 — Accelerated clock:** a virtual clock so 24h of scheduling runs in ~3 minutes. Backoff, calling hours and deadlines all read from the injectable clock, never `Date.now()` directly. Build this on day 1 — retrofitting it is painful.

**R4 — Live view:** `/simulation` page showing, updating in real time:
- Capacity gauge: `active / max` — **must never exceed max**
- Queue table: tier, score, patient, risk, time-to-deadline, attempts, state
- Event stream: claims, outcomes, retries, callbacks, escalations, reaper actions
- Counters: completed, escalated, manual follow-up, failed

**R5 — Forced scenarios:** buttons the evaluator can press
- `Kill worker` → shows reaper reclaiming capacity within 60s
- `Drop next call` → shows context-preserving resume
- `Spike capacity to 1` → shows graceful degradation and deadline prioritisation
- `Inject provider error` → shows attempt not consumed

**R6 — Trace export:** every run writes `sim/runs/<seed>-<timestamp>.json` containing every decision with the score breakdown. This is your evidence when the grader asks "why was this patient chosen?"

**R7 — Assertions run at the end:** capacity never exceeded, no duplicate calls, no task stuck, every invalid number in manual, every callback honoured within grace, no patient starved beyond N ticks. Print PASS/FAIL. **A simulation that self-verifies is far stronger than one that just animates.**

## Key deliverables
- [ ] `sim/queue-sim.ts` runner + `npm run sim`
- [ ] `sim/fixtures/queue-sim-patients.json` (committed)
- [ ] Virtual clock injected throughout the queue layer
- [ ] `/simulation` live dashboard
- [ ] Forced-scenario controls
- [ ] Trace export + end-of-run assertion report
- [ ] 60–90s screen recording of a full run (feeds the demo video)

## Acceptance criteria
- `npm run sim` completes in under 4 minutes and prints all assertions PASS.
- Capacity gauge never reads above 3 at any frame of the recording.

## Claude Code prompt
```
Build the mandatory queue simulation per docs 06 and 07.

1. Introduce an injectable Clock interface (now(), advance(ms)) and refactor the queue layer,
   backoff, calling-hours checks and reaper to use it instead of Date.now(). Production uses
   a real clock; the simulation uses a virtual one.
2. sim/fixtures/queue-sim-patients.json: 26 patients with the exact composition in this spec.
   Commit it.
3. sim/queue-sim.ts: seeded deterministic runner, capacity 3, two campaigns weighted 0.7/0.3,
   virtual clock compressing 24h into about 3 minutes of wall time. Uses the real scheduler,
   claim and state machine - not a reimplementation.
4. A deterministic call simulator producing the outcome mix from the fixture.
5. /simulation page: capacity gauge, live queue table with tier/score/deadline/attempts/state,
   scrolling event stream, and outcome counters.
6. Buttons: Kill worker, Drop next call, Set capacity to 1, Inject provider error.
7. Write every scheduling decision with its full score breakdown to
   sim/runs/<seed>-<timestamp>.json.
8. At the end of the run assert and print PASS/FAIL for: capacity never exceeded, no task
   claimed twice, no task left in a non-terminal state, invalid numbers reached
   MANUAL_FOLLOW_UP, callbacks honoured within the grace period, no task waited more than
   N ticks without being considered.
```
