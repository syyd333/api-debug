import { NextResponse } from "next/server";
import { listCards, listEdges, newId } from "@/lib/data";
import { detectContextGaps, diagnose, recall } from "@/lib/hindsight";
import type { AskSession, Channel } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/ask  { question, context?, channel? }
 * Stage 1 of hindsight: if context is missing, asks the engineer before diagnosing.
 * Returns either { needs_context, gaps } or a fully-cited { answer }.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    question?: string;
    context?: Record<string, string>;
    channel?: Channel;
  };
  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 });

  const context = body.context ?? {};
  const gaps = detectContextGaps(question, context);

  if (gaps.length > 0) {
    return NextResponse.json({
      needs_context: true,
      message: "Before I diagnose, I need a few details so the recall is trustworthy.",
      gaps,
    });
  }

  const [cards, edges] = await Promise.all([listCards(), listEdges()]);
  const result = recall(question, context, cards, edges);
  const { answer, confidence } = diagnose(question, context, result);

  const session: AskSession = {
    id: newId("ask"),
    question,
    context,
    asks: [],
    answer,
    citations: result.citations,
    confidence,
    resolved: false,
    outcome: null,
    outcome_worked: null,
    asked_by: "you",
    channel: body.channel ?? "web",
    created_at: new Date().toISOString(),
    resolved_at: null,
  };

  return NextResponse.json({ needs_context: false, session, ranked: result.ranked.map((r) => ({ id: r.card.id, title: r.card.title, score: r.score })), related: result.related.map((r) => ({ relation: r.edge.relation, card: r.other.id, title: r.other.title })) });
}
