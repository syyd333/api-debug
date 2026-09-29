import { NextResponse } from "next/server";
import { reviewCard } from "@/lib/data";
import type { ReviewOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    cardId?: string;
    outcome?: ReviewOutcome;
    note?: string;
    reviewer?: string;
  };
  if (!body.cardId || !body.outcome) {
    return NextResponse.json({ error: "cardId and outcome are required" }, { status: 400 });
  }
  const card = await reviewCard(body.cardId, body.outcome, body.note ?? "", body.reviewer ?? "you");
  if (!card) return NextResponse.json({ error: "card not found" }, { status: 404 });
  return NextResponse.json({ ok: true, card });
}
