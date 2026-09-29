// ─── Deja Fix domain types ────────────────────────────────────────────────────

export type CardStatus = "verified" | "unverified" | "stale" | "archived";
export type ReviewOutcome = "confirmed" | "corrected" | "rejected";
export type VoteValue = 1 | -1;

export const RELATION_TYPES = [
  "TRIGGERS", // error → problem
  "SOLVED_BY", // problem → fix
  "CAUSED_BY", // problem → root cause
  "SIMILAR_TO", // memory ↔ memory
  "SUPERSEDES", // fix → fix (newer replaces older)
  "REQUIRES_CONTEXT", // problem → missing-context question
  "BLOCKS", // fix → fix (deployment ordering)
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const RELATION_ARROW: Record<RelationType, string> = {
  TRIGGERS: "—TRIGGERS→",
  SOLVED_BY: "—SOLVED_BY→",
  CAUSED_BY: "—CAUSED_BY→",
  SIMILAR_TO: "—SIMILAR_TO→",
  SUPERSEDES: "—SUPERSEDES→",
  REQUIRES_CONTEXT: "—REQUIRES_CONTEXT→",
  BLOCKS: "—BLOCKS→",
};

export interface Tag {
  id: string;
  name: string;
  color: string;
}

/** A knowledge card: the atomic unit of retained engineering memory. */
export interface KnowledgeCard {
  id: string;
  title: string;
  /** The error / signal observed (stack line, status code, log excerpt). */
  error_signal: string;
  /** What the problem actually was, once understood. */
  problem: string;
  /** The fix that resolved it, with enough detail to replay. */
  fix: string;
  /** Service / vendor where this happened, e.g. "stripe-webhooks", "auth-svc". */
  service: string;
  /** HTTP status / error code, e.g. "401", "ETIMEDOUT". */
  error_code: string | null;
  /** Exact resolution steps so the fix is reproducible. */
  resolution_steps: string[];
  tags: string[];
  status: CardStatus;
  /** Review-loop fields. */
  reviewer: string | null;
  review_due: string | null;
  reviewed_at: string | null;
  last_review_note: string | null;
  /** Retention telemetry — drives staleness + ranking. */
  created_by: string;
  created_at: string;
  updated_at: string;
  last_recalled_at: string | null;
  recall_count: number;
  use_count: number; // how many times a recall was marked "this helped"
  vote_score: number;
  archived_at: string | null;
  /** Supabase pgvector similarity, when available. */
  similarity?: number;
}

/** Typed edge between two memories. */
export interface MemoryEdge {
  id: string;
  from_card: string;
  to_card: string;
  relation: RelationType;
  /** Free-text nuance, e.g. "only when retries are enabled". */
  note: string | null;
  created_by: string;
  created_at: string;
}

/** A clarification the ask-engine wanted before diagnosing, plus the answer. */
export interface ContextAsk {
  id: string;
  question: string;
  question_kind: "environment" | "payload" | "timeline" | "config" | "auth" | "other";
  answer: string | null;
  asked_at: string;
  answered_at: string | null;
}

/** A full Ask → diagnose → retain cycle. */
export interface AskSession {
  id: string;
  question: string;
  /** Engineer-supplied context gathered before diagnosing. */
  context: Record<string, string>;
  asks: ContextAsk[];
  answer: string;
  /** Every card the answer drew on, with the exact lines cited. */
  citations: Citation[];
  confidence: "high" | "medium" | "low" | "no-recall";
  resolved: boolean;
  /** The retained outcome: what actually worked. */
  outcome: string | null;
  outcome_worked: boolean | null;
  asked_by: string;
  channel: Channel;
  created_at: string;
  resolved_at: string | null;
}

/** A pointer to the exact evidence inside a card that an answer used. */
export interface Citation {
  card_id: string;
  card_title: string;
  field: "error_signal" | "problem" | "fix" | "resolution_steps";
  /** Quote of the cited material (lineage trail). */
  quote: string;
  /** Human-readable pointer, e.g. "fix" or "resolution_steps[1]". */
  locator: string;
  score: number;
}

export type Channel = "web" | "slack" | "teams" | "extension" | "mcp" | "api";

export interface ChannelEvent {
  id: string;
  channel: Channel;
  kind: "recall" | "retain" | "review" | "vote" | "archive";
  summary: string;
  created_at: string;
}

/** Point-in-time snapshot for version history. */
export interface CardVersion {
  id: string;
  card_id: string;
  version: number;
  snapshot: KnowledgeCard;
  changed_by: string;
  change_note: string;
  created_at: string;
}

export interface CardPermission {
  card_id: string;
  principal: string; // user id, "team:payments", "role:engineer", "public"
  level: "read" | "comment" | "edit" | "admin";
  granted_by: string;
  created_at: string;
}

export interface ReputationLedger {
  engineer: string;
  points: number;
  reason: string;
  card_id: string | null;
  created_at: string;
}

export interface ReviewQueueItem {
  card: KnowledgeCard;
  overdue_by_days: number | null;
}

// ─── Ranking / recall config ─────────────────────────────────────────────────

export const STALE_AFTER_DAYS = 30;
export const ARCHIVE_AFTER_STALE_DAYS = 14;
export const REVIEW_INTERVAL_DAYS = 90;
