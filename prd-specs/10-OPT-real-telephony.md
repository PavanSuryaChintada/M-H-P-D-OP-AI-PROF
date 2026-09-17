# 10-OPT — Real Telephony (Optional, High Impact)

**PRD:** §14, §31 Should-Have · **Only after 06–08, 12, 13, 21 are done**

---

## Why it is worth it
PRD §34 rates real telephony as an Enhancement, not Critical. But it is the single most memorable thing in a demo video. Do it **only if the queue and safety layers are finished**.

## Minimal viable version (2–3 hours)
- Twilio programmable voice, outbound
- TwiML `<Gather input="speech">` loop → your agent endpoint → `<Say>` response
- No streaming, no barge-in. Turn-based is fine and far more reliable.
- One verified number, one hospital, a demo campaign of 3 patients (your own phone)

## Better version (+2 hours)
- Twilio Media Streams → Deepgram streaming ASR → agent → ElevenLabs TTS
- Barge-in support
- Only attempt this if everything else is green

## Requirements
- Telephony sits behind a `CallProvider` interface with `SimulatedCallProvider` and `TwilioCallProvider`. The queue must not know which is in use.
- Real calls still respect calling hours, capacity, and the state machine — no bypass path.
- Webhook handlers are idempotent (Twilio retries).
- Map Twilio statuses → your outcomes: `no-answer`→`NO_ANSWER`, `busy`→`BUSY`, `failed`→`INVALID_NUMBER` or `PROVIDER_ERROR` by error code, `completed` + short duration → `VOICEMAIL` heuristic.
- **Consent line at call start**, recorded in the transcript.
- Record only with explicit consent; default recording off.

## Key deliverables
- [ ] `CallProvider` interface + both implementations, switchable by env var
- [ ] Twilio webhook handlers, idempotent
- [ ] Status → outcome mapping table
- [ ] A demo campaign that actually calls your phone, filmed

## Claude Code prompt
```
Add real outbound telephony behind a provider interface, without changing the queue.

1. lib/calls/provider.ts: CallProvider interface {placeCall(task, ctx), endCall(callId)}.
   Implement SimulatedCallProvider (existing simulator) and TwilioCallProvider. Select by
   CALL_PROVIDER env var. The scheduler must be unaware of which is active.
2. TwilioCallProvider: outbound call, TwiML Gather with speech input, POST each utterance to
   /api/calls/:id/turn which runs the real intake agent and returns TwiML Say plus the next
   Gather.
3. Idempotent webhook handlers keyed on Twilio CallSid plus sequence number.
4. Map Twilio call statuses to our outcomes per the table in this spec, including the
   short-duration voicemail heuristic.
5. First agent utterance states this is an automated call from the hospital and is being
   processed by an AI system. Persist that to the transcript.
6. Recording defaults to off and only enables on explicit patient consent captured in-call.
7. Real calls respect calling hours, capacity and the state machine with no bypass.
```
