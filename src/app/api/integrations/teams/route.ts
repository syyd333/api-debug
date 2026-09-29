import { NextResponse } from "next/server";
import { listCards, listEdges, logEvent, newId } from "@/lib/data";
import { diagnose, recall } from "@/lib/hindsight";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/teams — Azure Bot Service messaging target.
 * Handles Bot Framework activity schema; replies with a card-style text.
 * Configure in Azure Bot: Messaging endpoint → https://<host>/api/integrations/teams
 */
export async function POST(req: Request) {
  const activity = (await req.json().catch(() => ({}))) as {
    type?: string;
    text?: string;
    from?: { name?: string };
    conversation?: { name?: string };
    serviceUrl?: string;
  };

  if (activity.type === "ping" || !activity.text) {
    return NextResponse.json({ type: "message", text: "Deja Fix is listening. Post an error and I will recall the fix." });
  }

  const [cards, edges] = await Promise.all([listCards(), listEdges()]);
  const result = recall(activity.text, {}, cards, edges);
  const { answer, confidence } = diagnose(activity.text, {}, result);
  const user = activity.from?.name ?? "teams-user";

  await logEvent({
    id: newId("evt"),
    channel: "teams",
    kind: "recall",
    summary: `Teams · ${user} recalled "${activity.text.slice(0, 50)}" → ${result.top ? result.top.id : "no match"} (${confidence})`,
    created_at: new Date().toISOString(),
  });

  const facts: string[] = [];
  if (result.top) {
    facts.push(`**Recalled** — ${result.top.title}`);
    facts.push(`**Problem:** ${result.top.problem}`);
    facts.push(`**Fix:** ${result.top.fix}`);
    result.top.resolution_steps.slice(0, 3).forEach((s, i) => facts.push(`${i + 1}. ${s}`));
    facts.push(`_Status: ${result.top.status} · recalls ${result.top.recall_count + 1} · votes ${result.top.vote_score}_`);
  } else {
    facts.push("No retained memory matches yet. Retain the outcome when resolved and it will be recalled instantly next time.");
  }

  return NextResponse.json({ type: "message", text: facts.join("  \n"), confidence });
}
