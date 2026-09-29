import { NextResponse } from "next/server";
import { listCards, listEdges, logEvent, newId } from "@/lib/data";
import { diagnose, recall } from "@/lib/hindsight";
import type { Channel } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/recall?q=...&service=...&channel=slack
 * Multi-channel recall endpoint shared by web, Slack, Teams, extension, MCP.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const channel = (url.searchParams.get("channel") ?? "api") as Channel;
  const context: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (!["q", "channel"].includes(k)) context[k] = v;
  }
  if (!q.trim()) {
    return NextResponse.json({ error: "Missing ?q=" }, { status: 400 });
  }

  const [cards, edges] = await Promise.all([listCards(), listEdges()]);
  const result = recall(q, context, cards, edges);
  const { answer, confidence } = diagnose(q, context, result);

  await logEvent({
    id: newId("evt"),
    channel,
    kind: "recall",
    summary: `${channel} recall "${q.slice(0, 60)}" → ${result.top ? result.top.id : "no match"} (${confidence})`,
    created_at: new Date().toISOString(),
  });

  return NextResponse.json({
    query: q,
    context,
    confidence,
    answer,
    top: result.top,
    ranked: result.ranked.map((r) => ({ id: r.card.id, title: r.card.title, score: r.score, status: r.card.status })),
    citations: result.citations,
    related: result.related.map((r) => ({ relation: r.edge.relation, card: r.other.id, title: r.other.title })),
  });
}
