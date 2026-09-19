// Doc 20 R5 — graceful shutdown. No real process to signal in this build
// (see lib/reliability/shutdown.ts's own note), so this exercises the
// controller directly: stops accepting new work immediately, waits for
// in-flight work up to the grace period, then runs cleanup.

import { describe, expect, it, vi } from "vitest";
import { createShutdownController } from "../lib/reliability/shutdown";

describe("graceful shutdown controller (doc 20 R5)", () => {
  it("marks shutting-down immediately, so callers stop claiming new work", async () => {
    const controller = createShutdownController();
    expect(controller.isShuttingDown()).toBe(false);
    const shutdownPromise = controller.shutdown();
    expect(controller.isShuttingDown()).toBe(true);
    await shutdownPromise;
  });

  it("waits for registered in-flight work to finish before running cleanup", async () => {
    let inFlightFinished = false;
    let cleanupRan = false;
    const onShutdown = vi.fn(async () => {
      cleanupRan = true;
    });
    const controller = createShutdownController(onShutdown);

    const inFlight = new Promise<void>((resolve) =>
      setTimeout(() => {
        inFlightFinished = true;
        resolve();
      }, 50),
    );
    controller.registerInFlight(inFlight);

    await controller.shutdown();
    expect(inFlightFinished).toBe(true); // shutdown genuinely waited for it
    expect(cleanupRan).toBe(true);
  });
});
