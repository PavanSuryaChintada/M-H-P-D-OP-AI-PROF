// Doc 08 R4 — the /simulation page polls this route rather than the sim
// script pushing over a socket: sim/queue-sim.ts is a standalone tsx
// process (not the Next.js server), so a shared JSON file it writes after
// every tick is the simplest thing that can possibly work for a 6-day
// build. Not a pattern to carry into anything that isn't a demo harness.

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export async function GET() {
  const liveStatePath = path.join(process.cwd(), "sim", "runs", "live-state.json");
  try {
    const raw = await fs.readFile(liveStatePath, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ tick: 0, notStarted: true }, { status: 200 });
  }
}
