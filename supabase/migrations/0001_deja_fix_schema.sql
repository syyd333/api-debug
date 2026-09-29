-- ══════════════════════════════════════════════════════════════════════════
-- Deja Fix — Supabase schema
-- Hindsight (retain/recall) for API & integration bugs
-- Run in Supabase Dashboard → SQL Editor, or: supabase db push
-- ═════════════════════════════ anon.auth ⋅ extensions below ⋅ RLS on ═════════

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;   -- fuzzy matching for recall
create extension if not exists vector;    -- pgvector for semantic recall

-- ═══════════════════════════════ cards ═════════════════════════════════════
create table if not exists public.cards (
  id                text primary key,
  title             text not null,
  error_signal      text not null,
  problem           text not null,
  fix               text not null,
  service           text not null,
  error_code        text,
  resolution_steps  jsonb not null default '[]'::jsonb,
  tags              text[] not null default '{}',
  status            text not null default 'unverified'
                    check (status in ('verified','unverified','stale','archived')),
  reviewer          text,
  review_due        timestamptz,
  reviewed_at       timestamptz,
  last_review_note  text,
  created_by        text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_recalled_at  timestamptz,
  recall_count      integer not null default 0,
  use_count         integer not null default 0,
  vote_score        integer not null default 0,
  archived_at       timestamptz,
  embedding         vector(1536)          -- optional; app falls back to text scoring
);

create index if not exists cards_service_idx   on public.cards (service);
create index if not exists cards_status_idx    on public.cards (status);
create index if not exists cards_updated_idx   on public.cards (updated_at desc);
create index if not exists cards_error_code_idx on public.cards (error_code);
create index if not exists cards_tags_idx      on public.cards using gin (tags);
create index if not exists cards_trgm_idx      on public.cards using gin (title gin_trgm_ops, error_signal gin_trgm_ops);

-- ═════════════════════════ typed memory relationships ══════════════════════
create table if not exists public.memory_edges (
  id          text primary key,
  from_card   text not null references public.cards(id) on delete cascade,
  to_card     text not null references public.cards(id) on delete cascade,
  relation    text not null check (relation in
              ('TRIGGERS','SOLVED_BY','CAUSED_BY','SIMILAR_TO','SUPERSEDES','REQUIRES_CONTEXT','BLOCKS')),
  note        text,
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists edges_from_idx on public.memory_edges (from_card);
create index if not exists edges_to_idx   on public.memory_edges (to_card);

-- ═══════════════════════════ ask → diagnose → retain ═══════════════════════
create table if not exists public.ask_sessions (
  id               text primary key,
  question         text not null,
  context          jsonb not null default '{}'::jsonb,
  asks             jsonb not null default '[]'::jsonb,
  answer           text not null default '',
  citations        jsonb not null default '[]'::jsonb,
  confidence       text not null default 'low'
                   check (confidence in ('high','medium','low','no-recall')),
  resolved         boolean not null default false,
  outcome          text,
  outcome_worked   boolean,
  asked_by         text not null,
  channel          text not null default 'web'
                   check (channel in ('web','slack','teams','extension','mcp','api')),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);

-- ═══════════════════════════ channel delivery log ══════════════════════════
create table if not exists public.channel_events (
  id          text primary key,
  channel     text not null check (channel in ('web','slack','teams','extension','mcp','api')),
  kind        text not null check (kind in ('recall','retain','review','vote','archive')),
  summary     text not null,
  created_at  timestamptz not null default now()
);

-- ═══════════════════════════ version history ═══════════════════════════════
create table if not exists public.card_versions (
  id          text primary key,
  card_id     text not null references public.cards(id) on delete cascade,
  version     integer not null,
  snapshot    jsonb not null,
  changed_by  text not null,
  change_note text not null default '',
  created_at  timestamptz not null default now(),
  unique (card_id, version)
);

-- ═══════════════════════════ permissions ═══════════════════════════════════
create table if not exists public.card_permissions (
  card_id     text not null references public.cards(id) on delete cascade,
  principal   text not null,          -- user id | team:x | role:y | public
  level       text not null check (level in ('read','comment','edit','admin')),
  granted_by  text not null,
  created_at  timestamptz not null default now(),
  primary key (card_id, principal)
);

-- ═══════════════════════════ votes (one per voter) ═════════════════════════
create table if not exists public.card_votes (
  card_id     text not null references public.cards(id) on delete cascade,
  voter       text not null,
  value       integer not null check (value in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (card_id, voter)
);

-- ═══════════════════════════ reputation ledger ═════════════════════════════
create table if not exists public.reputation_ledger (
  id          bigint generated always as identity primary key,
  engineer    text not null,
  points      integer not null,
  reason      text not null,
  card_id     text references public.cards(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ═══════════════════════════ RPCs used by the app ══════════════════════════

-- Atomic voting: one vote per voter, updates denormalized score.
create or replace function public.vote_card(p_card_id text, p_delta int, p_voter text)
returns void language plpgsql as $$
declare existing int;
begin
  select value into existing from public.card_votes
   where card_id = p_card_id and voter = p_voter;

  if existing is null then
    insert into public.card_votes (card_id, voter, value) values (p_card_id, p_voter, p_delta);
    update public.cards set vote_score = vote_score + p_delta where id = p_card_id;
  elsif existing <> p_delta then
    update public.card_votes set value = p_delta
     where card_id = p_card_id and voter = p_voter;
    update public.cards set vote_score = vote_score + 2 * p_delta where id = p_card_id;
  end if;
end;
$$;

-- Recall: bump telemetry (recall_count, last_recalled_at) and un-stale on use.
create or replace function public.mark_recalled(p_card_id text)
returns void language sql as $$
  update public.cards
     set recall_count = recall_count + 1,
         last_recalled_at = now(),
         status = case when status = 'stale' then 'unverified' else status end,
         archived_at = case when status = 'archived' then null else archived_at end
   where id = p_card_id;
$$;

-- The verification loop's auto-archiver, in two phases:
--   phase 1: no recall/activity for 30d → mark 'stale'
--   phase 2: still stale after 14 more days with no recalls → 'archived'
create or replace function public.auto_archive_stale_cards()
returns setof text language plpgsql as $$
declare touched text;
begin
  -- phase 1: become stale
  for touched in
    update public.cards
       set status = 'stale',
           updated_at = updated_at   -- keep updated_at; staleness anchored on last_recalled_at
     where status in ('verified','unverified')
       and coalesce(last_recalled_at, updated_at, created_at) < now() - interval '30 days'
    returning id
  loop
    return next 'stale:' || touched;
  end loop;

  -- phase 2: stale past grace window and still unused → archived
  for touched in
    update public.cards
       set status = 'archived',
           archived_at = now()
     where status = 'stale'
       and coalesce(last_recalled_at, 'epoch'::timestamptz) < now() - interval '14 days'
       and use_count < 3
    returning id
  loop
    insert into public.channel_events (id, channel, kind, summary)
    values ('evt_arch_' || touched || '_' || extract(epoch from now())::bigint,
            'mcp', 'archive',
            'auto-archived ' || touched || ' — stale and unused past grace window');
    return next 'archived:' || touched;
  end loop;
end;
$$;

-- ═══════════════════════════ Row Level Security ════════════════════════════
-- The publishable key is public by design; policies below give read to
-- everyone and write to any authenticated principal the app presents.
-- Tighten `app.current_engineer` mapping when you wire real auth.

alter table public.cards             enable row level security;
alter table public.memory_edges      enable row level security;
alter table public.ask_sessions      enable row level security;
alter table public.channel_events    enable row level security;
alter table public.card_versions     enable row level security;
alter table public.card_permissions  enable row level security;
alter table public.card_votes        enable row level security;
alter table public.reputation_ledger enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'cards','memory_edges','ask_sessions','channel_events',
    'card_versions','card_permissions','card_votes','reputation_ledger'
  ] loop
    execute format('drop policy if exists "deja_fix_public_read" on public.%I', t);
    execute format($f$create policy "deja_fix_public_read" on public.%I for select using (true)$f$, t);
    execute format('drop policy if exists "deja_fix_public_write" on public.%I', t);
    execute format($f$create policy "deja_fix_public_write" on public.%I for all using (true) with check (true)$f$, t);
  end loop;
end;
$$;

-- ═══════════════════════════ Seed demo corpus ══════════════════════════════
insert into public.cards (id, title, error_signal, problem, fix, service, error_code,
                          resolution_steps, tags, status, reviewer, reviewed_at,
                          last_review_note, created_by, created_at, updated_at,
                          last_recalled_at, recall_count, use_count, vote_score)
values
('card_stripe_sig',
 'Stripe webhook 400 ''No signatures found'' behind nginx',
 'POST /api/webhooks/stripe → 400 {"error":"No signatures found matching the expected signature for payload"} — only in production; localhost works.',
 'nginx terminated TLS and rewrote the request, stripping the raw body the Stripe signature check needs; constructEvent was handed the JSON-parsed body instead of the raw bytes.',
 'Read the raw body with `await req.text()` before any JSON parsing, disable body parsing in the route, and pass the `stripe-signature` header through unchanged.',
 'stripe-webhooks', '400',
 '[{"step":"Set runtime nodejs and remove body parsers"},{"step":"Read raw body via req.text()"},{"step":"constructEvent(payload, stripe-signature header, whsec)"}]'::jsonb,
 array['stripe','webhooks','signatures','nginx'],
 'verified', 'maya.chen', now() - interval '11 days',
 'Confirmed on staging; added header passthrough note.',
 'arun.patel', now() - interval '120 days', now() - interval '11 days',
 now() - interval '2 days', 34, 19, 42),
('card_gql_timeout',
 'GraphQL resolver ETIMEDOUT after VPC peering change',
 'Apollo Server logs: `ETIMEDOUT 10.4.12.9:5432` on every resolver hitting Postgres; healthcheck passes but queries hang 30s then die.',
 'The VPC peering route was added on the database subnet, but the pod network was never added to the DB security group egress — connections opened, SYN sent, response dropped.',
 'Add the pod CIDR (10.6.0.0/16) as an allowed ingress client on the DB security group and lower statement_timeout so failures surface in seconds, not 30.',
 'graphql-api', 'ETIMEDOUT',
 '[{"step":"psql from pod — hangs"},{"step":"Add pod CIDR to DB security group, port 5432"},{"step":"statement_timeout = 5s on the role"}]'::jsonb,
 array['graphql','postgres','networking','vpc'],
 'verified', 'sam.okafor', now() - interval '25 days', 'Re-verified after cluster migration.',
 'maya.chen', now() - interval '95 days', now() - interval '25 days',
 now() - interval '6 days', 21, 12, 27),
('card_saml_clock',
 'SAML login loop — NameID issued ''in the future''',
 'Okta SAML response valid XML but our IdP check throws `NotBefore condition violated`; clock skew 00:02:17 between pod and Okta.',
 'Pod clocks drifting up to 3 minutes ahead meant the NotBefore condition rejected every assertion before processing.',
 'Enable NTP sync in the node image and allow a 180s notBeforeSkew in the SAML verification config.',
 'auth-svc', '401',
 '[{"step":"Compare pod date -u vs Okta header date"},{"step":"Enable chrony, alert offset > 500ms"},{"step":"notBeforeSkew: 180 in saml-verifier"}]'::jsonb,
 array['saml','okta','sso','clock-skew'],
 'unverified', null, null, null,
 'jules.romain', now() - interval '60 days', now() - interval '60 days',
 now() - interval '4 days', 9, 5, 8),
('card_rabbit_prefetch',
 'RabbitMQ consumer OOM-killed when batch sizes spike',
 'Consumer pods OOMKilled at 512Mi during merchant backfills; RabbitMQ unacked per channel ~9,000.',
 'Default prefetch of unlimited let the broker push the entire backlog into a single consumer process.',
 'Set prefetch: 50 per channel plus manual ack; enqueue backfill jobs with a per-tenant rate limiter.',
 'billing-worker', 'OOMKilled',
 '[{"step":"channel.prefetch(50)"},{"step":"Manual ack per batch"},{"step":"k8s limits 768Mi with 80% alert"}]'::jsonb,
 array['rabbitmq','memory','kubernetes','backpressure'],
 'verified', 'arun.patel', now() - interval '40 days', 'Numbers hold after Q3 scale test.',
 'sam.okafor', now() - interval '210 days', now() - interval '40 days',
 now() - interval '21 days', 15, 9, 18),
('card_salesforce_dupes',
 'Salesforce CRM sync creating duplicate Accounts on retry',
 'Nightly sync logs show `DUPLICATE_VALUE duplicate external id` for 3% of accounts; two pods processed the same batch after a visibility timeout lapse.',
 'The sync used upsert-by-name instead of the external Id; retried batches raced and both pods created records.',
 'Idempotent upsert keyed on External_Id__c plus a distributed lock per batch id (Redis, TTL 15m) before dispatch.',
 'crm-sync', 'DUPLICATE_VALUE',
 '[{"step":"Upsert keyed on External_Id__c"},{"step":"SET lock:sync:<batch> NX EX 900"},{"step":"Dedupe keeping earliest CreatedDate"}]'::jsonb,
 array['salesforce','idempotency','sync','race-condition'],
 'unverified', 'maya.chen', null, null,
 'maya.chen', now() - interval '38 days', now() - interval '38 days',
 now() - interval '33 days', 7, 3, 5),
('card_oauth_pkce',
 'OAuth PKCE flow fails on Safari 17 — ''state mismatch''',
 'Users on Safari 17 get `redirect_uri_mismatch` then `state mismatch`; cookies work in Chrome. Errors only on the final /callback leg.',
 'Safari partitions cookies for the auth subdomain behind ITP; the state cookie was scoped to the callback origin instead of the parent domain.',
 'Move state/nonce cookies to the parent domain with SameSite=None; Secure, and fall back to a signed state JWT when cookies are unavailable.',
 'auth-svc', 'redirect_uri_mismatch',
 '[{"step":"Domain=.example.com SameSite=None Secure"},{"step":"Signed state JWT fallback"},{"step":"Browser matrix tests"}]'::jsonb,
 array['oauth','pkce','safari','cookies','itp'],
 'unverified', null, null, null,
 'arun.patel', now() - interval '52 days', now() - interval '52 days',
 now() - interval '41 days', 4, 1, 3),
('card_twilio_unicode',
 'Twilio SMS bodies truncated mid-emoji — Unicode split',
 'SMS delivery reports show `body truncated`; bodies >70 chars with emoji split into malformed segments and cost 3x.',
 'Templates rendered with surrogate pairs split at segment boundaries; no GSM-7 vs UCS-2 detection before send.',
 'Detect encoding (GSM-7 vs UCS-2) and segment at grapheme boundaries with Intl.Segmenter before calling Twilio.',
 'notify-svc', '21606',
 '[{"step":"Intl.Segmenter grapheme splitter"},{"step":"Outside GSM-7 → UCS-2 (70-char segments)"},{"step":"Re-segment and re-send failed queue"}]'::jsonb,
 array['twilio','sms','unicode','segmentation'],
 'stale', 'sam.okafor', now() - interval '122 days', 'Verified a while ago; no recalls since Q1.',
 'jules.romain', now() - interval '400 days', now() - interval '122 days',
 now() - interval '48 days', 6, 2, 7),
('card_heroku_router',
 'Heroku router H12 timeout on long CSV exports (superseded)',
 'Router log `at=error code=H12 desc=Request timeout` after 30s on /exports?range=all.',
 'Synchronous export streamed >30s; Heroku kills idle responses at 30s.',
 'Move export to a background job with a pre-signed S3 URL delivered by email. NOTE: superseded by streaming NDJSON on /exports/v2.',
 'exports-api', 'H12',
 '[{"step":"Enqueue job, return 202"},{"step":"Deliver pre-signed S3 link"},{"step":"Legacy path returns 410"}]'::jsonb,
 array['heroku','exports','background-jobs'],
 'verified', 'maya.chen', now() - interval '70 days', 'Kept for lineage; see SUPERSEDES edge.',
 'maya.chen', now() - interval '320 days', now() - interval '70 days',
 now() - interval '90 days', 11, 4, 12)
on conflict (id) do nothing;

-- Typed edges seed
insert into public.memory_edges (id, from_card, to_card, relation, note, created_by, created_at) values
('edge_1','card_stripe_sig','card_gql_timeout','SIMILAR_TO','Both were ''works locally, dies behind infra'' — check proxy/ingress layer first.','arun.patel', now() - interval '90 days'),
('edge_2','card_saml_clock','card_oauth_pkce','SIMILAR_TO','Auth handshake family; check clock/cookies before protocol internals.','maya.chen', now() - interval '45 days'),
('edge_3','card_rabbit_prefetch','card_salesforce_dupes','BLOCKS','Prefetch fix must land before backfill reruns or dupes return.','sam.okafor', now() - interval '30 days'),
('edge_4','card_heroku_router','card_rabbit_prefetch','CAUSED_BY','Export job burst filled the queue that later OOM''d consumers.','maya.chen', now() - interval '28 days')
on conflict (id) do nothing;

-- Versions seed
insert into public.card_versions (id, card_id, version, snapshot, changed_by, change_note, created_at) values
('ver_1','card_stripe_sig',1,
 jsonb_build_object('id','card_stripe_sig','title','Stripe webhook 400 ''No signatures found'' behind nginx','fix','Restart the ingress pod and retry the webhook.'),
 'arun.patel','Initial retain from incident INC-2214.', now() - interval '120 days'),
('ver_2','card_stripe_sig',2,
 jsonb_build_object('id','card_stripe_sig','title','Stripe webhook 400 ''No signatures found'' behind nginx','fix','Read the raw body with `await req.text()` before any JSON parsing, disable body parsing in the route, and pass the `stripe-signature` header through unchanged.'),
 'maya.chen','Review pass: replaced anecdotal fix with raw-body steps; verified.', now() - interval '11 days'),
('ver_3','card_rabbit_prefetch',1,
 jsonb_build_object('id','card_rabbit_prefetch','title','RabbitMQ consumer OOM-killed when batch sizes spike','fix','Increase consumer memory to 1Gi and redeploy.'),
 'sam.okafor','First pass — memory bump only.', now() - interval '210 days'),
('ver_4','card_rabbit_prefetch',2,
 jsonb_build_object('id','card_rabbit_prefetch','title','RabbitMQ consumer OOM-killed when batch sizes spike','fix','Set prefetch: 50 per channel plus a manual ack; enqueue backfill jobs with a per-tenant rate limiter.'),
 'arun.patel','Root cause was unbounded prefetch; replaced memory-bump fix.', now() - interval '40 days')
on conflict (id) do nothing;

-- Permissions seed
insert into public.card_permissions (card_id, principal, level, granted_by, created_at) values
('card_stripe_sig','team:payments','edit','maya.chen', now() - interval '120 days'),
('card_stripe_sig','role:engineer','read','maya.chen', now() - interval '120 days'),
('card_gql_timeout','team:platform','edit','sam.okafor', now() - interval '95 days'),
('card_saml_clock','team:identity','admin','jules.romain', now() - interval '60 days'),
('card_salesforce_dupes','team:revenue-systems','comment','maya.chen', now() - interval '38 days')
on conflict (card_id, principal) do nothing;

-- Reputation seed
insert into public.reputation_ledger (engineer, points, reason, card_id, created_at) values
('maya.chen',25,'verified card_stripe_sig via review loop','card_stripe_sig', now() - interval '11 days'),
('arun.patel',20,'retained outcome for ask_1','card_stripe_sig', now() - interval '2 days'),
('sam.okafor',15,'verified card_rabbit_prefetch','card_rabbit_prefetch', now() - interval '40 days'),
('jules.romain',8,'tagged card_saml_clock (clock-skew)','card_saml_clock', now() - interval '55 days'),
('maya.chen',12,'linked SIMILAR_TO edge (proxy-family errors)',null, now() - interval '45 days'),
('arun.patel',10,'created card_oauth_pkce','card_oauth_pkce', now() - interval '52 days'),
('sam.okafor',9,'vote +5 on card_gql_timeout','card_gql_timeout', now() - interval '26 days');

-- Ask sessions seed
insert into public.ask_sessions (id, question, context, asks, answer, citations, confidence, resolved, outcome, outcome_worked, asked_by, channel, created_at, resolved_at) values
('ask_1',
 'Stripe webhooks return 400 in prod after the ingress change. Signature error every time.',
 '{"service":"stripe-webhooks","environment":"production","changed_recently":"nginx ingress rollout"}'::jsonb,
 '[{"id":"q1","question":"Which host/ingress fronts the webhook route, and did TLS termination move?","question_kind":"environment","answer":"nginx ingress, TLS terminated at the LB since yesterday","asked_at":"2026-09-27T10:00:00Z","answered_at":"2026-09-27T10:01:00Z"}]'::jsonb,
 'High-confidence recall: matches card_stripe_sig — raw-body loss behind ingress change. Fix: req.text() before parsing, forward stripe-signature unchanged.',
 '[{"card_id":"card_stripe_sig","card_title":"Stripe webhook 400 ''No signatures found'' behind nginx","field":"fix","quote":"Read the raw body with `await req.text()` before any JSON parsing, disable body parsing in the route, and pass the `stripe-signature` header through unchanged.","locator":"fix","score":0.94}]'::jsonb,
 'high', true, 'Confirmed: switching to req.text() and forwarding stripe-signature fixed 100% of prod 400s. Ingress change was the trigger.', true,
 'arun.patel', 'slack', now() - interval '2 days', now() - interval '2 days'),
('ask_2',
 'CRM sync keeps creating duplicate accounts overnight. Where do I start?',
 '{"service":"crm-sync","environment":"production"}'::jsonb,
 '[]'::jsonb,
 'Matched card_salesforce_dupes (medium): retried batches race when visibility timeouts lapse. Land the RabbitMQ prefetch fix first (BLOCKS edge).',
 '[{"card_id":"card_salesforce_dupes","card_title":"Salesforce CRM sync creating duplicate Accounts on retry","field":"fix","quote":"Idempotent upsert keyed on `External_Id__c` plus a distributed lock per batch id (Redis, TTL 15m) before dispatch.","locator":"fix","score":0.82}]'::jsonb,
 'medium', false, null, null,
 'jules.romain', 'web', now() - interval '9 days', null);

-- Channel events seed
insert into public.channel_events (id, channel, kind, summary, created_at) values
('evt_1','slack','recall','#incidents · stripe webhook recall served from card_stripe_sig (confidence high)', now() - interval '2 days'),
('evt_2','web','retain','arun.patel retained outcome for ask_1 → card_stripe_sig use_count +1', now() - interval '2 days'),
('evt_3','extension','recall','Browser extension surface-recall on github.com/pulls — 2 cards shown, 1 clicked', now() - interval '3 days'),
('evt_4','teams','review','Teams review nudge sent to maya.chen for card_salesforce_dupes (unverified 38d)', now() - interval '5 days'),
('evt_5','mcp','recall','MCP tool search_bug_memory called by IDE agent — top hit card_gql_timeout', now() - interval '7 days');
