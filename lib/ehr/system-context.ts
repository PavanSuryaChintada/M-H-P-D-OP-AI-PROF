// Doc 15 R2 — the mock EHR runs as system/worker code, not a signed-in
// user. Re-exports the shared system actor (lib/db/system-context.ts, also
// used by doc 16's event handlers) under this module's existing name so
// doc 15's callers don't need to change.

export { systemContext as ehrSystemContext } from "../db/system-context";
