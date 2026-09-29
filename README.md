# Deja Fix ↻

**Hindsight for API & integration bugs.** Retain the fix once — recall it forever, with citations, wherever engineers work.

Deja Fix turns every resolved integration bug into a **knowledge card** with a verification loop, typed memory relationships, and cited recall delivered through Slack, Teams, a browser extension, and MCP.

## The hindsight loop

```
      ┌────────────── 1. ASK ───────────────┐
      │  engineer describes the bug          │
      │  → asks for missing context FIRST    │
      └──────────────┬──────────────────────┘
                     ▼
      ┌──────────── 2. RECALL ──────────────┐
      │  rank knowledge cards                │
      │  (verified ▲, stale ▼, votes, use)   │
      │  answer cites exact card fields      │
      └──────────────┬──────────────────────┘
                     ▼
      ┌──────────── 3. RESOLVE ─────────────┐
      │  engineer applies the fix            │
      └──────────────┬──────────────────────┘
                     ▼
      ┌──────────── 4. RETAIN ──────────────┐
      │  outcome stored, use_count++         │
      │  reputation awarded, staleness reset │
      └──────────────┬──────────────────────┘
                     ▼
      ┌──────────── 5. VERIFY ──────────────┐
      │  expert reviewer + review schedule   │
      │  stale + unused → auto-archive       │
      └─────────────────────────────────────┘
```

## Key features

| Feature | Where |
|---|---|
| **Verification loop** — status (verified/unverified/stale/archived), assigned expert reviewer, review schedule, auto-archive when stale & unused | `/review`, `auto_archive_stale_cards()` RPC, `/api/cron/stale-archive` |
| **Voting + reputation + tags** — one vote per engineer (atomic RPC), reputation ledger for verifies/retains/tags | `/reputation`, `vote_card()` RPC |
| **Citations/lineage on every AI answer** — each claim quotes the exact card field + locator | `buildCitations()` in `src/lib/hindsight.ts` |
| **Multi-channel delivery** — Slack, Teams, browser extension, MCP, web, plain API | `/api/integrations/*`, `/api/mcp`, `/integrations` |
| **Asks for missing context before diagnosing, retains the resolved outcome** | `detectContextGaps()` + `/api/ask` → `/api/retain`, `/ask` |
| **Typed relationships** — `error → TRIGGERS → problem → SOLVED_BY → fix` plus CAUSED_BY, SIMILAR_TO, SUPERSEDES, REQUIRES_CONTEXT, BLOCKS | `memory_edges` table, `/graph` |
| **Version history + permissions** — immutable snapshots per change; per-card grants (read/comment/edit/admin) | `card_versions`, `card_permissions`, card detail page |

## Quick start

```bash
cd deja-fix
npm install
cp .env.example .env.local   # already filled in this workspace
npm run dev                  # http://localhost:3000
```

The app runs on an in-memory demo corpus until Supabase is provisioned; the header badge shows which store is live.

## Supabase setup

Project: `https://tgcflypoeqreddlzmgct.supabase.co`

1. **Apply the schema** — either open Dashboard → SQL Editor and paste
   [`supabase/migrations/0001_deja_fix_schema.sql`](supabase/migrations/0001_deja_fix_schema.sql),
   or use the CLI:

   ```bash
   supabase login
   supabase init
   supabase link --project-ref tgcflypoeqreddlzmgct
   supabase db push
   ```

   The migration creates all tables, indexes, RLS policies, the `vote_card` /
   `mark_recalled` / `auto_archive_stale_cards` RPCs, and seeds the demo corpus.

2. **Env** — `.env.local` already contains:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://tgcflypoeqreddlzmgct.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   The direct connection (`postgresql://postgres:[YOUR-PASSWORD]@db.tgcflypoeqreddlzmgct.supabase.co:5432/postgres`) is only needed for `supabase db` CLI operations — never expose it to the client.

3. **Optional: schedule the retention sweeper** (auto-archive) daily:

   ```sql
   select cron.schedule('deja-fix-stale-archive', '0 3 * * *',
     $$ select * from auto_archive_stale_cards(); $$);
   ```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/recall?q=…&service=…&channel=slack` | Ranked, cited recall for any channel |
| `POST /api/ask {question, context}` | Context-gap detection → diagnosis |
| `POST /api/retain {sessionId, outcome, worked}` | Close the loop, bump telemetry + reputation |
| `POST /api/review {cardId, outcome, note}` | Verification loop actions |
| `POST /api/integrations/slack` | Slack slash command + app_mention |
| `POST /api/integrations/teams` | Bot Framework activity handler |
| `POST /api/mcp` | JSON-RPC MCP: `search_bug_memory`, `get_card`, `retain_outcome`, `submit_review` |
| `GET /api/cron/stale-archive` | Staleness sweeper |

## MCP client config (Cursor / Claude Desktop / VS Code)

```json
{
  "mcpServers": {
    "deja-fix": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

## Recalls are honest by design

- Verified cards outrank unverified; stale cards sink; archived cards never surface (unless recalled, which un-archives them).
- Every answer states its confidence (`high / medium / low / no-recall`) and every sentence is traceable to a cited card field.
- Knowledge that stops being used fades: 30 days unused → `stale`; 14 more days with no recalls → auto-`archived` (with a channel-event audit trail).
