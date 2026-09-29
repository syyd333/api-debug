import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { applyReviewOutcome } from "./hindsight";
import {
  DEMO_ASKS,
  DEMO_CARDS,
  DEMO_EDGES,
  DEMO_EVENTS,
  DEMO_PERMISSIONS,
  DEMO_REPUTATION,
  demoPermissionsFor,
  demoVersionsFor,
} from "./demo-store";
import type {
  AskSession,
  CardPermission,
  CardVersion,
  ChannelEvent,
  KnowledgeCard,
  MemoryEdge,
  ReputationLedger,
  ReviewOutcome,
} from "./types";

export type { KnowledgeCard };

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const usingSupabase = () => Boolean(getSupabase());

/** True when the Supabase tables actually exist (migration applied). */
export async function supabaseReady(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from(TABLES.cards).select("id", { count: "exact", head: true });
  return !error;
}

/** Tables expected in Supabase; when absent we serve the in-memory demo set. */
const TABLES = {
  cards: "cards",
  edges: "memory_edges",
  asks: "ask_sessions",
  events: "channel_events",
  versions: "card_versions",
  permissions: "card_permissions",
  reputation: "reputation_ledger",
} as const;

// ─── Runtime fallback store ─────────────────────────────────────────────────
// Supabase is the source of truth, but when it is unreachable we still keep
// writes in server memory so the prototype works end-to-end (e.g. ask → retain).

const runtimeCards = new Map<string, KnowledgeCard>();
const runtimeAsks = new Map<string, AskSession>();
const runtimeEvents: ChannelEvent[] = [];

// ─── Cards ───────────────────────────────────────────────────────────────────

export async function listCards(): Promise<KnowledgeCard[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from(TABLES.cards).select("*").order("updated_at", { ascending: false });
    if (!error && data) {
      // overlay runtime mutations (review/retain changes) onto DB rows
      const db = data as KnowledgeCard[];
      return db.map((c) => runtimeCards.get(c.id) ?? c);
    }
    console.warn("[deja-fix] Supabase cards unavailable, using demo store:", error?.message);
  }
  return [...runtimeCards.values(), ...DEMO_CARDS.filter((d) => !runtimeCards.has(d.id))]
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export async function getCard(id: string): Promise<KnowledgeCard | null> {
  const runtime = runtimeCards.get(id);
  if (runtime) return runtime;
  const sb = getSupabase();
  if (!sb) return DEMO_CARDS.find((c) => c.id === id) ?? null;
  const { data, error } = await sb.from(TABLES.cards).select("*").eq("id", id).maybeSingle();
  if (error) {
    console.warn("[deja-fix] Supabase getCard unavailable, using demo store:", error.message);
    return DEMO_CARDS.find((c) => c.id === id) ?? null;
  }
  return (data as KnowledgeCard) ?? null;
}

export async function upsertCard(card: KnowledgeCard): Promise<void> {
  runtimeCards.set(card.id, card);
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from(TABLES.cards).upsert(card);
  if (error) console.warn("[deja-fix] card write kept in memory only:", error.message);
}

// ─── Edges ───────────────────────────────────────────────────────────────────

export async function listEdges(): Promise<MemoryEdge[]> {
  const sb = getSupabase();
  if (!sb) return DEMO_EDGES;
  const { data, error } = await sb.from(TABLES.edges).select("*");
  if (error || !data) return DEMO_EDGES;
  return data as MemoryEdge[];
}

export async function createEdge(edge: MemoryEdge): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from(TABLES.edges).insert(edge);
}

// ─── Ask sessions ────────────────────────────────────────────────────────────

export async function listAsks(): Promise<AskSession[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from(TABLES.asks).select("*").order("created_at", { ascending: false });
    if (!error && data) {
      const db = data as AskSession[];
      const dbIds = new Set(db.map((a) => a.id));
      return [...[...runtimeAsks.values()].filter((a) => !dbIds.has(a.id)), ...db];
    }
  }
  return [...runtimeAsks.values(), ...DEMO_ASKS.filter((d) => !runtimeAsks.has(d.id))].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
}

export async function saveAskSession(session: AskSession): Promise<void> {
  runtimeAsks.set(session.id, session); // always retained in memory first
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from(TABLES.asks).upsert(session);
  if (error) console.warn("[deja-fix] ask session kept in memory only:", error.message);
}

// ─── Channel events ─────────────────────────────────────────────────────────

export async function listEvents(): Promise<ChannelEvent[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from(TABLES.events).select("*").order("created_at", { ascending: false }).limit(30);
    if (!error && data) return data as ChannelEvent[];
  }
  return [...runtimeEvents, ...DEMO_EVENTS]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 30);
}

export async function logEvent(event: ChannelEvent): Promise<void> {
  runtimeEvents.unshift(event);
  if (runtimeEvents.length > 100) runtimeEvents.pop();
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from(TABLES.events).insert(event);
  if (error) console.warn("[deja-fix] event kept in memory only:", error.message);
}

// ─── Versions + permissions (per card) ──────────────────────────────────────

export async function versionsFor(cardId: string): Promise<CardVersion[]> {
  const sb = getSupabase();
  if (!sb) return demoVersionsFor(cardId);
  const { data, error } = await sb
    .from(TABLES.versions)
    .select("*")
    .eq("card_id", cardId)
    .order("version", { ascending: false });
  if (error || !data) return demoVersionsFor(cardId);
  return data as CardVersion[];
}

export async function saveVersion(v: CardVersion): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from(TABLES.versions).insert(v);
}

export async function permissionsFor(cardId: string): Promise<CardPermission[]> {
  const sb = getSupabase();
  if (!sb) return demoPermissionsFor(cardId);
  const { data, error } = await sb.from(TABLES.permissions).select("*").eq("card_id", cardId);
  if (error || !data) return demoPermissionsFor(cardId);
  return data as CardPermission[];
}

export async function savePermission(p: CardPermission): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from(TABLES.permissions).upsert(p);
}

export async function removePermission(cardId: string, principal: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from(TABLES.permissions).delete().eq("card_id", cardId).eq("principal", principal);
}

// ─── Reputation ─────────────────────────────────────────────────────────────

export async function listReputation(): Promise<ReputationLedger[]> {
  const sb = getSupabase();
  if (!sb) return DEMO_REPUTATION;
  const { data, error } = await sb.from(TABLES.reputation).select("*").order("points", { ascending: false });
  if (error || !data) return DEMO_REPUTATION;
  return data as ReputationLedger[];
}

export async function awardReputation(entry: ReputationLedger): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from(TABLES.reputation).insert(entry);
}

export async function voteCard(cardId: string, delta: 1 | -1, voter: string): Promise<void> {
  const card = await getCard(cardId);
  if (!card) return;
  const next = { ...card, vote_score: card.vote_score + delta };
  await upsertCard(next);
  const sb = getSupabase();
  if (sb) await sb.rpc("vote_card", { p_card_id: cardId, p_delta: delta, p_voter: voter }).then(() => {}, () => {});
}

// ─── Review loop ────────────────────────────────────────────────────────────

export async function reviewCard(
  cardId: string,
  outcome: ReviewOutcome,
  note: string,
  reviewer: string,
): Promise<KnowledgeCard | null> {
  const card = await getCard(cardId);
  if (!card) return null;
  const now = new Date();
  const next = applyReviewOutcome(card, outcome, note, now);
  await upsertCard(next);
  if (outcome !== "rejected") {
    await awardReputation({
      engineer: reviewer,
      points: 25,
      reason: `verified ${cardId} via review loop`,
      card_id: cardId,
      created_at: now.toISOString(),
    });
  }
  await logEvent({
    id: `evt_${now.getTime()}`,
    channel: "web",
    kind: "review",
    summary: `${reviewer} ${outcome} review on ${cardId}`,
    created_at: now.toISOString(),
  });
  return next;
}

// ─── Ask pipeline helpers used by API routes ────────────────────────────────

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
