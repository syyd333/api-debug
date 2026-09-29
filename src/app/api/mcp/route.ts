import { NextResponse } from "next/server";
import { listCards, listEdges, logEvent, newId, getCard, upsertCard, reviewCard } from "@/lib/data";
import { diagnose, recall } from "@/lib/hindsight";
import { REVIEW_INTERVAL_DAYS } from "@/lib/types";
import type { ReviewOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/mcp — JSON-RPC 2.0 Model Context Protocol endpoint.
 * Tools: search_bug_memory, get_card, retain_outcome, submit_review.
 * Point any MCP client (Claude Desktop, Cursor, VS Code) at this URL.
 */
export async function POST(req: Request) {
  const rpc = (await req.json().catch(() => ({}))) as {
    jsonrpc?: string;
    id?: string | number;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  const id = rpc.id ?? null;

  if (rpc.method === "initialize") {
    return NextResponse.json({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "deja-fix", version: "0.1.0" },
      },
    });
  }

  if (rpc.method === "tools/list") {
    return NextResponse.json({
      jsonrpc: "2.0", id,
      result: {
        tools: [
          {
            name: "search_bug_memory",
            description: "Recall retained fixes for API/integration bugs. Returns cited, ranked memories.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
                service: { type: "string" },
                error_code: { type: "string" },
              },
              required: ["query"],
            },
          },
          {
            name: "get_card",
            description: "Fetch one knowledge card with full lineage: problem, fix, steps, relationships.",
            inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
          },
          {
            name: "retain_outcome",
            description: "Retain the resolved outcome of a fix so hindsight recalls it next time.",
            inputSchema: {
              type: "object",
              properties: {
                title: { type: "string" },
                error_signal: { type: "string" },
                problem: { type: "string" },
                fix: { type: "string" },
                service: { type: "string" },
                error_code: { type: "string" },
                steps: { type: "array", items: { type: "string" } },
                engineer: { type: "string" },
              },
              required: ["title", "error_signal", "problem", "fix", "service"],
            },
          },
          {
            name: "submit_review",
            description: "Verification loop: confirm, correct or reject a knowledge card as an expert reviewer.",
            inputSchema: {
              type: "object",
              properties: {
                card_id: { type: "string" },
                outcome: { type: "string", enum: ["confirmed", "corrected", "rejected"] },
                note: { type: "string" },
                reviewer: { type: "string" },
              },
              required: ["card_id", "outcome"],
            },
          },
        ],
      },
    });
  }

  if (rpc.method === "tools/call") {
    const name = rpc.params?.name ?? "";
    const a = rpc.params?.arguments ?? {};
    try {
      if (name === "search_bug_memory") {
        const query = String(a.query ?? "");
        const context: Record<string, string> = {};
        if (a.service) context.service = String(a.service);
        if (a.error_code) context.status_code = String(a.error_code);
        const [cards, edges] = await Promise.all([listCards(), listEdges()]);
        const result = recall(query, context, cards, edges);
        const { answer, confidence } = diagnose(query, context, result);
        await logEvent({
          id: newId("evt"), channel: "mcp", kind: "recall",
          summary: `MCP search_bug_memory: "${query.slice(0, 50)}" → ${result.top ? result.top.id : "no match"} (${confidence})`,
          created_at: new Date().toISOString(),
        });
        return NextResponse.json({
          jsonrpc: "2.0", id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({
                confidence,
                answer,
                top: result.top ? {
                  id: result.top.id, title: result.top.title, status: result.top.status,
                  problem: result.top.problem, fix: result.top.fix,
                  steps: result.top.resolution_steps,
                  recall_count: result.top.recall_count + 1,
                } : null,
                citations: result.citations,
                related: result.related.map(r => ({ relation: r.edge.relation, title: r.other.title })),
              }, null, 2),
            }],
          },
        });
      }

      if (name === "get_card") {
        const card = await getCard(String(a.id ?? ""));
        if (!card) return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "card not found" } });
        return NextResponse.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(card, null, 2) }] },
        });
      }

      if (name === "retain_outcome") {
        const nowIso = new Date().toISOString();
        const id0 = newId("card");
        const card = {
          id: id0,
          title: String(a.title),
          error_signal: String(a.error_signal ?? ""),
          problem: String(a.problem),
          fix: String(a.fix),
          service: String(a.service),
          error_code: a.error_code ? String(a.error_code) : null,
          resolution_steps: Array.isArray(a.steps) ? a.steps.map(String) : [],
          tags: [],
          status: "unverified" as const,
          reviewer: null,
          review_due: new Date(Date.now() + REVIEW_INTERVAL_DAYS * 86_400_000).toISOString(),
          reviewed_at: null,
          last_review_note: null,
          created_by: String(a.engineer ?? "mcp-agent"),
          created_at: nowIso,
          updated_at: nowIso,
          last_recalled_at: null,
          recall_count: 0,
          use_count: 0,
          vote_score: 0,
          archived_at: null,
        };
        await upsertCard(card);
        await logEvent({
          id: newId("evt"), channel: "mcp", kind: "retain",
          summary: `MCP retain_outcome created ${id0}: ${card.title}`,
          created_at: nowIso,
        });
        return NextResponse.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: `Retained as ${id0} (status: unverified, queued for expert review).` }] },
        });
      }

      if (name === "submit_review") {
        const updated = await reviewCard(
          String(a.card_id),
          String(a.outcome ?? "confirmed") as ReviewOutcome,
          String(a.note ?? ""),
          String(a.reviewer ?? "mcp-agent"),
        );
        if (!updated) return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "card not found" } });
        return NextResponse.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: `Review recorded: ${updated.id} is now ${updated.status}.` }] },
        });
      }

      return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown tool ${name}` } });
    } catch (e) {
      return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } });
    }
  }

  return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `method ${rpc.method} not found` } });
}
