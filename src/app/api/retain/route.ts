import { NextResponse } from "next/server";
import { getCard, listAsks, logEvent, newId, saveAskSession, upsertCard, awardReputation } from "@/lib/data";
import type { AskSession } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/retain  { sessionId, outcome, worked, engineer? }
 * Closes the hindsight loop: retains the resolved outcome, bumps use_count,
 * awards reputation and refreshes the card's recall telemetry.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    outcome?: string;
    worked?: boolean;
    engineer?: string;
  };
  if (!body.sessionId || !body.outcome) {
    return NextResponse.json({ error: "sessionId and outcome are required" }, { status: 400 });
  }

  const asks = await listAsks();
  const session = asks.find((a) => a.id === body.sessionId);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const now = new Date().toISOString();
  const updated: AskSession = {
    ...session,
    resolved: true,
    outcome: body.outcome,
    outcome_worked: body.worked ?? true,
    resolved_at: now,
  };
  await saveAskSession(updated);

  // Retention telemetry flows into every cited card.
  for (const c of session.citations) {
    const card = await getCard(c.card_id);
    if (!card) continue;
    await upsertCard({
      ...card,
      use_count: card.use_count + 1,
      recall_count: card.recall_count + 1,
      last_recalled_at: now,
      updated_at: now,
      status: card.status === "stale" ? "unverified" : card.status,
      archived_at: null,
    });
    await awardReputation({
      engineer: body.engineer ?? session.asked_by,
      points: 10,
      reason: `retained outcome for ${session.id}`,
      card_id: card.id,
      created_at: now,
    });
  }

  await logEvent({
    id: newId("evt"),
    channel: session.channel,
    kind: "retain",
    summary: `${body.engineer ?? session.asked_by} retained outcome for ${session.id} (${body.worked === false ? "did not work" : "worked"})`,
    created_at: now,
  });

  return NextResponse.json({ ok: true, session: updated });
}
