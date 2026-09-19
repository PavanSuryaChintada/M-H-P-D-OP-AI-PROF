// Doc 20 R5 — graceful shutdown: on SIGTERM, stop claiming new tasks,
// allow up to 30s for in-flight work to finish, release capacity, exit.
//
// Honest scope note: this build's queue/event processing runs as
// on-demand function calls (claimNextTask, processNextEvent) invoked per
// request in a serverless-style Next.js app, not as a long-running worker
// daemon — see docs/queue-design.md's doc 08 section. There is currently no
// persistent process for SIGTERM to signal. This module is the handler a
// real always-on worker process (a separate Node process running a claim
// loop, the shape doc 06/07 assume in production) would install; it's
// exercised directly by tests/reliability-shutdown.test.ts rather than by
// an actual running daemon in this environment.

const GRACE_PERIOD_MS = 30_000;

export interface ShutdownController {
  isShuttingDown(): boolean;
  registerInFlight(promise: Promise<unknown>): void;
  shutdown(): Promise<void>;
}

export function createShutdownController(onShutdown?: () => Promise<void>): ShutdownController {
  let shuttingDown = false;
  const inFlight = new Set<Promise<unknown>>();

  return {
    isShuttingDown: () => shuttingDown,

    registerInFlight(promise: Promise<unknown>) {
      inFlight.add(promise);
      promise.finally(() => inFlight.delete(promise));
    },

    async shutdown() {
      shuttingDown = true; // stop claiming new tasks — callers check isShuttingDown() before claimNextTask
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, GRACE_PERIOD_MS));
      await Promise.race([Promise.allSettled([...inFlight]), timeout]);
      if (onShutdown) await onShutdown();
    },
  };
}

/** Wires the controller to the real process signal — call once at process startup for an actual long-running worker. */
export function installShutdownHandler(controller: ShutdownController): void {
  process.on("SIGTERM", () => {
    controller.shutdown().then(() => process.exit(0));
  });
}
