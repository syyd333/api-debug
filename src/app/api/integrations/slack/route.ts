import { NextResponse } from "next/server";
import { listCards, listEdges, logEvent, newId } from "@/lib/data";
import { diagnose, recall } from "@/lib/hindsight";
import type { Channel } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/integrations/slack  — Slack Events API / slash command target.
 * Parses both `text` payloads (slash commands) and `event` payloads (app mentions).
 * Configure in Slack: Request URL → https://<host>/api/integrations/slack
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  // Slack slash commands arrive form-encoded.
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = Object.fromEntries((await req.formData()).entries());
    const text = String(form.text ?? "");
    const user = String(form.user_name ?? "slack-user");
    return NextResponse.json(await handleRecall(text, "slack", user, String(form.channel_name ?? "slack")));
  }

  // Slack Events API: JSON with possible url_verification challenge.
  const payload = (await req.json().catch(() => ({}))) as {
    type?: string;
    challenge?: string;
    event?: { type?: string; text?: string; user?: string; bot_id?: string };
  };
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }
  const event = payload.event;
  if (event?.type === "app_mention" && event.text && !event.bot_id) {
    const text = event.text.replace(/<@[A-Z0-9]+>/gi, "").trim();
    return NextResponse.json(await handleRecall(text, "slack", event.user ?? "slack-user", "slack"));
  }
  return NextResponse.json({ ok: true });
}

async function handleRecall(text: string, channel: Channel, user: string, target: string) {
  if (!text.trim()) {
    return { response_type: "ephemeral", text: "Usage: `/deja <error message or question>`" };
  }
  const [cards, edges] = await Promise.all([listCards(), listEdges()]);
  const result = recall(text, {}, cards, edges);
  const { answer, confidence } = diagnose(text, {}, result);

  await logEvent({
    id: newId("evt"),
    channel,
    kind: "recall",
    summary: `#${target} · ${user} recalled "${text.slice(0, 50)}" → ${result.top ? result.top.id : "no match"} (${confidence})`,
    created_at: new Date().toISOString(),
  });

  const lines: string[] = [];
  if (result.top) {
    lines.push(`*Recalled* ${result.top.title} — _${result.top.service}_ · status: ${result.top.status}`);
    lines.push(`*Problem:* ${result.top.problem}`);
    lines.push(`*Fix:* ${result.top.fix}`);
    for (const [i, step] of result.top.resolution_steps.slice(0, 3).entries()) lines.push(`${i + 1}. ${step}`);
    if (result.related.length) {
      lines.push(`_Related: ${result.related.map((r) => `${r.edge.relation} → ${r.other.title}`).join(" · ")}_`);
    }
    lines.push(`_${result.top.recall_count + 1} recalls · ${result.top.use_count} confirmed fixes · votes ${result.top.vote_score}_`);
  } else {
    lines.push(`No retained memory matches. Resolve it, then run \`/deja retain\` and next time this answer writes itself.`);
  }
  return { response_type: "in-channel", text: lines.join("\n"), confidence };
}
