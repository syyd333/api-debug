import { NextResponse } from "next/server";
import { getSupabase, listCards, logEvent, newId, upsertCard } from "@/lib/data";
import { stalenessOf } from "@/lib/hindsight";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stale-archive
 * The verification loop's retention sweeper:
 *   1. cards untouched for 30d → status 'stale'
 *   2. stale cards with no recalls in 14 more days (and low usage) → 'archived'
 * Schedule with Supabase cron, GitHub Actions, or Vercel Cron (daily).
 */
export async function GET() {
  const cards = await listCards();
  const now = new Date();
  const becameStale: string[] = [];
  const archived: string[] = [];

  for (const card of cards) {
    if (card.status === "archived") continue;
    const staleness = stalenessOf(card, now);
    if (staleness === "stale" && card.status !== "stale") {
      becameStale.push(card.id);
      await upsertCard({ ...card, status: "stale", updated_at: card.updated_at });
    } else if (
      card.status === "stale" &&
      now.getTime() - new Date(card.last_recalled_at ?? card.updated_at).getTime() > 14 * 86_400_000 &&
      card.use_count < 3
    ) {
      archived.push(card.id);
      await upsertCard({ ...card, status: "archived", archived_at: now.toISOString() });
      await logEvent({
        id: newId("evt"),
        channel: "web",
        kind: "archive",
        summary: `auto-archived ${card.id} — stale and unused past grace window`,
        created_at: now.toISOString(),
      });
    }
  }

  const sb = getSupabase();
  return NextResponse.json({
    ok: true,
    mode: sb ? "supabase" : "demo",
    became_stale: becameStale,
    archived,
    note: "Cards un-stale automatically the next time they are recalled or their outcome is retained.",
  });
}
