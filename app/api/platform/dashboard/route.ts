import { NextResponse } from "next/server";
import { guardPlatformAdmin } from "@/lib/auth/guard";
import { getPlatformOverview, getPlatformAiUsage } from "@/lib/analytics/platform-admin";

// Doc 18 R3 — Platform Admin dashboard. Not hospital-scoped (no
// [hospitalId] in the path) — this is the one dashboard that spans
// hospitals, via guardPlatformAdmin rather than guard().
export async function GET() {
  const gate = await guardPlatformAdmin("analytics:platform_aggregate");
  if (gate instanceof Response) return gate;

  const [overview, aiUsage] = await Promise.all([getPlatformOverview(), getPlatformAiUsage()]);
  return NextResponse.json({ overview, aiUsage });
}
