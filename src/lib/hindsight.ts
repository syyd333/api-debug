import type {
  AskSession,
  CardStatus,
  Citation,
  ContextAsk,
  KnowledgeCard,
  MemoryEdge,
  ReviewOutcome,
} from "./types";
import { STALE_AFTER_DAYS } from "./types";

// ─── Stage 1: what context is missing before we diagnose? ────────────────────

export interface ContextGap {
  key: string;
  label: string;
  question: string;
  question_kind: ContextAsk["question_kind"];
  placeholder: string;
}

const GAP_TEMPLATES: ContextGap[] = [
  {
    key: "service",
    label: "Service / vendor",
    question: "Which service or vendor is misbehaving?",
    question_kind: "environment",
    placeholder: "e.g. stripe-webhooks, auth-svc, crm-sync",
  },
  {
    key: "environment",
    label: "Environment",
    question: "Where is it happening?",
    question_kind: "environment",
    placeholder: "production / staging / local / CI",
  },
  {
    key: "status_code",
    label: "Status or error code",
    question: "What exact status code or error code do you see?",
    question_kind: "payload",
    placeholder: "e.g. 401, ETIMEDOUT, DUPLICATE_VALUE",
  },
  {
    key: "message",
    label: "Error message",
    question: "Paste the raw error message or log line.",
    question_kind: "payload",
    placeholder: "e.g. No signatures found matching the expected signature",
  },
  {
    key: "changed_recently",
    label: "Recent changes",
    question: "What changed right before this started?",
    question_kind: "timeline",
    placeholder: "e.g. nginx ingress rollout, dependency bump",
  },
  {
    key: "payload_snippet",
    label: "Payload / request snippet",
    question: "Can you share a redacted payload or request shape?",
    question_kind: "payload",
    placeholder: "e.g. { id: evt_..., type: invoice.paid }",
  },
  {
    key: "auth_flow",
    label: "Auth mechanism",
    question: "How does the failing call authenticate?",
    question_kind: "auth",
    placeholder: "e.g. HMAC signature, OAuth bearer, mTLS",
  },
];

/** Deduce which gaps remain unanswered given what the engineer typed. */
export function detectContextGaps(question: string, provided: Record<string, string>): ContextGap[] {
  const q = question.toLowerCase();
  const gaps: ContextGap[] = [];
  const filled = new Set(Object.keys(provided).filter((k) => (provided[k] ?? "").trim().length > 0));

  const wants: Record<string, boolean> = {
    service: true,
    environment: /\b(prod|production|staging|local|ci|deploy)\b/.test(q) || true,
    status_code: /\b(\d{3}|code|status)\b/.test(q),
    message: /\b(error|exception|fail|trace|log)\b/.test(q),
    changed_recently: /\b(since|after|started|suddenly|broke|regress|change)\b/.test(q),
    payload_snippet: /\b(payload|body|request|webhook|post|json)\b/.test(q),
    auth_flow: /\b(auth|signature|token|oauth|saml|401|403|permission)\b/.test(q),
  };

  for (const t of GAP_TEMPLATES) {
    if (wants[t.key] && !filled.has(t.key)) gaps.push(t);
  }
  // Always keep it tight: at most 3 questions per turn.
  return gaps.slice(0, 3);
}

// ─── Stage 2: recall — rank memories and build citations ─────────────────────

const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of", "and", "or",
  "with", "after", "before", "keeps", "keep", "every", "returns", "return", "fails", "failing",
  "how", "why", "what", "when", "where", "start", "starts", "my", "our", "it", "its", "this", "that",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Deterministic, explainable scorer. When a pgvector column is present the data
 * layer can seed `similarity` and we blend it in (embedding cosine dominates).
 */
export function scoreCard(card: KnowledgeCard, tokens: string[], context: Record<string, string>): number {
  if (card.status === "archived") return 0;
  const hay = tokenize(
    [card.title, card.error_signal, card.problem, card.fix, card.service, card.error_code ?? "", card.tags.join(" ")].join(" "),
  );
  const haySet = new Set(hay);
  let score = 0;
  for (const t of tokens) {
    if (haySet.has(t)) score += 2;
    else if (hay.some((h) => h.startsWith(t) || t.startsWith(h))) score += 1;
  }

  // Context fields act as hard-ish boosts when they agree with the card.
  const svc = (context.service ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (svc && card.service.toLowerCase().replace(/[\s_-]/g, "") === svc) score += 6;
  if (context.status_code && card.error_code && context.status_code === card.error_code) score += 5;
  if (context.error_code && card.error_code && context.error_code === card.error_code) score += 5;

  // Verification loop: verified knowledge outranks unverified; stale sinks.
  if (card.status === "verified") score *= 1.25;
  if (card.status === "stale") score *= 0.5;
  score += Math.min(card.vote_score, 50) * 0.04; // community signal, capped
  score += Math.min(card.use_count, 30) * 0.05; // "this helped me" signal
  score += Math.min(card.recall_count, 100) * 0.01;

  // Vector similarity (if supplied by pgvector) is blended on top.
  if (typeof card.similarity === "number") score = score * 0.4 + card.similarity * 100 * 0.6;

  return Math.round(score * 100) / 100;
}

/** Quote the exact material an answer drew on — lineage for every claim. */
export function buildCitations(card: KnowledgeCard, tokens: string[], max: number): Citation[] {
  const candidates: Array<Pick<Citation, "field" | "quote" | "locator">> = [
    { field: "fix", quote: card.fix, locator: "fix" },
    { field: "problem", quote: card.problem, locator: "problem" },
    { field: "error_signal", quote: card.error_signal, locator: "error_signal" },
    ...card.resolution_steps.map((s, i) => ({
      field: "resolution_steps" as const,
      quote: s,
      locator: `resolution_steps[${i}]`,
    })),
  ];
  const scored = candidates
    .map((c) => {
      const cq = tokenize(c.quote);
      const uniqueTokens = new Set(tokens);
      const overlap = [...uniqueTokens].filter((t) => cq.includes(t)).length;
      return { ...c, score: Math.min(1, overlap / Math.max(cq.length, 1)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
  return scored.map((c) => ({
    card_id: card.id,
    card_title: card.title,
    field: c.field,
    quote: c.quote,
    locator: c.locator,
    score: Math.round(c.score * 100) / 100,
  }));
}

export interface RecallResult {
  top: KnowledgeCard | null;
  ranked: Array<{ card: KnowledgeCard; score: number }>;
  citations: Citation[];
  related: Array<{ edge: MemoryEdge; other: KnowledgeCard }>;
}

export function recall(
  question: string,
  context: Record<string, string>,
  cards: KnowledgeCard[],
  edges: MemoryEdge[],
): RecallResult {
  const tokens = tokenize(question + " " + Object.values(context).join(" "));
  const ranked = cards
    .map((card) => ({ card, score: scoreCard(card, tokens, context) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = ranked[0] ?? null;
  const citations = top ? buildCitations(top.card, tokens, 3) : [];
  const related: Array<{ edge: MemoryEdge; other: KnowledgeCard }> = [];
  if (top) {
    for (const e of edges) {
      const otherId = e.from_card === top.card.id ? e.to_card : e.to_card === top.card.id ? e.from_card : null;
      if (!otherId) continue;
      const other = cards.find((c) => c.id === otherId);
      if (other && other.status !== "archived") related.push({ edge: e, other });
    }
  }
  return { top: top?.card ?? null, ranked: ranked.slice(0, 5), citations, related };
}

// ─── Stage 3: diagnose — compose an answer with provenance ───────────────────

export function confidenceFor(topScore: number, hasContext: boolean): AskSession["confidence"] {
  if (topScore <= 0) return "no-recall";
  if (topScore >= 14 && hasContext) return "high";
  if (topScore >= 7) return "medium";
  return "low";
}

export function diagnose(
  question: string,
  context: Record<string, string>,
  result: RecallResult,
): { answer: string; confidence: AskSession["confidence"] } {
  const hasContext = Object.keys(context).length > 0;
  const confidence = confidenceFor(result.ranked[0]?.score ?? 0, hasContext);
  if (!result.top) {
    return {
      answer:
        "No retained memory matches this yet. Once you resolve it, retain the outcome here and the next engineer (or your future self) will get an instant, cited answer.",
      confidence,
    };
  }
  const c = result.top;
  const ctxLine = hasContext
    ? `Given your context (${Object.entries(context)
        .map(([k, v]) => `${k}=${v}`)
        .slice(0, 4)
        .join(", ")}), `
    : "";
  const relLine = result.related.length
    ? ` Related memory: ${result.related
        .slice(0, 2)
        .map((r) => `${r.other.title} [${r.edge.relation}]`)
        .join("; ")}.`
    : "";
  const answer =
    `${confidence === "high" ? "High-confidence recall" : confidence === "medium" ? "Possible match" : "Weak match"}: ` +
    `${ctxLine}this resembles [${c.id}] “${c.title}”. ` +
    `Observed signal: ${c.error_signal.slice(0, 140)}${c.error_signal.length > 140 ? "…" : ""} ` +
    `Root cause: ${c.problem} Fix: ${c.fix}.${relLine} ` +
    `Every claim above is cited to the card fields below — verify against the review status (${c.status}).`;
  return { answer, confidence };
}

// ─── Stage 4: retain — persist the resolved outcome ──────────────────────────

export function retentionSummary(session: AskSession): string {
  const worked = session.outcome_worked ? "worked" : "did NOT work";
  return `${session.asked_by} retained outcome (${worked}) on ${session.resolved_at ?? session.created_at}: ${session.outcome ?? "n/a"}`;
}

// ─── Review loop ─────────────────────────────────────────────────────────────

export function applyReviewOutcome(
  card: KnowledgeCard,
  outcome: ReviewOutcome,
  note: string,
  now: Date = new Date(),
): KnowledgeCard {
  const next: KnowledgeCard = {
    ...card,
    reviewed_at: now.toISOString(),
    last_review_note: note,
    review_due: new Date(now.getTime() + 90 * 86_400_000).toISOString(),
    updated_at: now.toISOString(),
  };
  if (outcome === "confirmed") next.status = "verified";
  if (outcome === "corrected") next.status = "verified";
  if (outcome === "rejected") next.status = "archived";
  return next;
}

export function stalenessOf(card: KnowledgeCard, now: Date = new Date()): "fresh" | "aging" | "stale" | "archived" {
  if (card.status === "archived") return "archived";
  const last = card.last_recalled_at ?? card.updated_at ?? card.created_at;
  const days = (now.getTime() - new Date(last).getTime()) / 86_400_000;
  if (days >= STALE_AFTER_DAYS) return "stale";
  if (days >= STALE_AFTER_DAYS / 2) return "aging";
  return "fresh";
}

/** The auto-archive rule: stale + unused past the grace window → archived. */
export function shouldAutoArchive(card: KnowledgeCard, now: Date = new Date()): boolean {
  if (card.status !== "stale") return false;
  const staleSince = new Date(card.updated_at).getTime();
  return now.getTime() - staleSince >= 14 * 86_400_000 && card.recall_count === 0;
}
