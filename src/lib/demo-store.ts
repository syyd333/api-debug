import type {
  AskSession,
  ChannelEvent,
  CardPermission,
  CardVersion,
  KnowledgeCard,
  MemoryEdge,
  ReputationLedger,
} from "./types";

// Deterministic id helper so SSR/CSR renders agree.
let counter = 0;
export function demoId(prefix: string): string {
  counter += 1;
  return `${prefix}_demo_${String(counter).padStart(4, "0")}`;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

const cards: KnowledgeCard[] = [
  {
    id: "card_stripe_sig",
    title: "Stripe webhook 400 'No signatures found' behind nginx",
    error_signal:
      'POST /api/webhooks/stripe → 400 {"error":"No signatures found matching the expected signature for payload"} — only in production; localhost works.',
    problem:
      "nginx terminated TLS and rewrote the request, stripping the raw body the Stripe signature check needs; constructEvent was handed the JSON-parsed body instead of the raw bytes.",
    fix:
      "Read the raw body with `await req.text()` before any JSON parsing, disable body parsing in the route, and pass the `stripe-signature` header through unchanged.",
    service: "stripe-webhooks",
    error_code: "400",
    resolution_steps: [
      "Set `export const runtime = 'nodejs'` and remove any bodyParser/parser middleware from the webhook route.",
      "Read raw body: `const payload = await req.text()`.",
      "Verify with `stripe.webhooks.constructEvent(payload, req.headers.get('stripe-signature')!, whsec)`. Signature must be validated on the concatenated, unparsed string.",
    ],
    tags: ["stripe", "webhooks", "signatures", "nginx"],
    status: "verified",
    reviewer: "maya.chen",
    review_due: null,
    reviewed_at: daysAgo(11),
    last_review_note: "Confirmed on staging; added header passthrough note.",
    created_by: "arun.patel",
    created_at: daysAgo(120),
    updated_at: daysAgo(11),
    last_recalled_at: daysAgo(2),
    recall_count: 34,
    use_count: 19,
    vote_score: 42,
    archived_at: null,
  },
  {
    id: "card_gql_timeout",
    title: "GraphQL resolver ETIMEDOUT after VPC peering change",
    error_signal:
      "Apollo Server logs: `ETIMEDOUT 10.4.12.9:5432` on every resolver hitting Postgres; healthcheck passes but queries hang 30s then die.",
    problem:
      "The VPC peering route was added on the database subnet, but the pod network was never added to the DB security group egress — connections opened, SYN sent, response dropped.",
    fix:
      "Add the pod CIDR (10.6.0.0/16) as an allowed ingress client on the DB security group and lower statement_timeout so failures surface in seconds, not 30.",
    service: "graphql-api",
    error_code: "ETIMEDOUT",
    resolution_steps: [
      "Reproduce: `psql 'host=db.internal ...' -c 'select 1'` from a pod — hangs.",
      "DB security group → inbound rules → add pod CIDR with port 5432.",
      "Set `statement_timeout = 5s` on the role to fail fast in future.",
    ],
    tags: ["graphql", "postgres", "networking", "vpc"],
    status: "verified",
    reviewer: "sam.okafor",
    review_due: null,
    reviewed_at: daysAgo(25),
    last_review_note: "Steps re-verified after migration to new DB cluster.",
    created_by: "maya.chen",
    created_at: daysAgo(95),
    updated_at: daysAgo(25),
    last_recalled_at: daysAgo(6),
    recall_count: 21,
    use_count: 12,
    vote_score: 27,
    archived_at: null,
  },
  {
    id: "card_saml_clock",
    title: "SAML login loop — NameID issued 'in the future'",
    error_signal:
      "Okta SAML response valid XML but our IdP check throws `NotBefore condition violated`; clock skew is 00:02:17 between pod and Okta.",
    problem:
      "Pod clocks drifting up to 3 minutes ahead meant the NotBefore condition rejected every assertion before processing.",
    fix:
      "Enable NTP sync in the node image and allow a 180s `notBeforeSkew` in the SAML verification config as a belt-and-braces.",
    service: "auth-svc",
    error_code: "401",
    resolution_steps: [
      "Confirm skew: compare `date -u` inside pod vs `curl -sI https://okta.com | grep -i date`.",
      "Enable `chrony` in node image; alert when offset > 500ms.",
      "Set `notBeforeSkew: 180` in saml-verifier config.",
    ],
    tags: ["saml", "okta", "sso", "clock-skew"],
    status: "unverified",
    reviewer: null,
    review_due: daysAgo(3),
    reviewed_at: null,
    last_review_note: null,
    created_by: "jules.romain",
    created_at: daysAgo(60),
    updated_at: daysAgo(60),
    last_recalled_at: daysAgo(4),
    recall_count: 9,
    use_count: 5,
    vote_score: 8,
    archived_at: null,
  },
  {
    id: "card_rabbit_prefetch",
    title: "RabbitMQ consumer OOM-killed when batch sizes spike",
    error_signal:
      "Consumer pods OOMKilled at 512Mi during merchant backfills; RabbitMQ unacked message count per channel hits ~9,000.",
    problem:
      "Default prefetch of unlimited let the broker push the entire backlog into a single consumer process.",
    fix:
      "Set `prefetch: 50` per channel plus a manual ack; enqueue backfill jobs with a per-tenant rate limiter.",
    service: "billing-worker",
    error_code: "OOMKilled",
    resolution_steps: [
      "`channel.prefetch(50)` in worker bootstrap.",
      "Switch consumer to manual ack, ack per handled batch.",
      "Add k8s memory request 384Mi / limit 768Mi with alert on 80%.",
    ],
    tags: ["rabbitmq", "memory", "kubernetes", "backpressure"],
    status: "verified",
    reviewer: "arun.patel",
    review_due: null,
    reviewed_at: daysAgo(40),
    last_review_note: "Numbers hold after Q3 scale test.",
    created_by: "sam.okafor",
    created_at: daysAgo(210),
    updated_at: daysAgo(40),
    last_recalled_at: daysAgo(21),
    recall_count: 15,
    use_count: 9,
    vote_score: 18,
    archived_at: null,
  },
  {
    id: "card_salesforce_dupes",
    title: "Salesforce CRM sync creating duplicate Accounts on retry",
    error_signal:
      "Nightly sync logs show `DUPLICATE_VALUE duplicate external id` for 3% of accounts; two pods processed the same batch after a visibility timeout lapse.",
    problem:
      "The sync used upsert-by-name instead of the external Id; retried batches raced and both pods created records.",
    fix:
      "Idempotent upsert keyed on `External_Id__c` plus a distributed lock per batch id (Redis, TTL 15m) before dispatch.",
    service: "crm-sync",
    error_code: "DUPLICATE_VALUE",
    resolution_steps: [
      "Replace account upsert payload with external-id keying.",
      "Acquire `SET lock:sync:<batch> NX EX 900` before sending a batch.",
      "Backfill: dedupe accounts by external id keeping earliest CreatedDate.",
    ],
    tags: ["salesforce", "idempotency", "sync", "race-condition"],
    status: "unverified",
    reviewer: "maya.chen",
    review_due: null,
    reviewed_at: null,
    last_review_note: null,
    created_by: "maya.chen",
    created_at: daysAgo(38),
    updated_at: daysAgo(38),
    last_recalled_at: daysAgo(33),
    recall_count: 7,
    use_count: 3,
    vote_score: 5,
    archived_at: null,
  },
  {
    id: "card_oauth_pkce",
    title: "OAuth PKCE flow fails on Safari 17 — 'state mismatch'",
    error_signal:
      "Users on Safari 17 get `redirect_uri_mismatch` then `state mismatch`; cookies work in Chrome. Errors only on the final /callback leg.",
    problem:
      "Safari partitions cookies for the auth subdomain behind ITP; the short-lived state cookie was scoped to the callback origin instead of the parent domain.",
    fix:
      "Move state/nonce cookies to the parent domain with SameSite=None; Secure, and fall back to a signed state JWT when cookies are unavailable.",
    service: "auth-svc",
    error_code: "redirect_uri_mismatch",
    resolution_steps: [
      "Set cookie Domain=.example.com, SameSite=None, Secure=true.",
      "Embed signed state JWT so validation does not depend on cookie presence.",
      "Add integration test matrix: Safari 17, Firefox ESR, Chrome.",
    ],
    tags: ["oauth", "pkce", "safari", "cookies", "itp"],
    status: "unverified",
    reviewer: null,
    review_due: daysAgo(6),
    reviewed_at: null,
    last_review_note: null,
    created_by: "arun.patel",
    created_at: daysAgo(52),
    updated_at: daysAgo(52),
    last_recalled_at: daysAgo(41),
    recall_count: 4,
    use_count: 1,
    vote_score: 3,
    archived_at: null,
  },
  {
    id: "card_twilio_unicode",
    title: "Twilio SMS bodies truncated mid-emoji — Unicode split",
    error_signal:
      "SMS delivery reports show `body truncated`; bodies >70 chars with emoji split into malformed segments and cost 3x.",
    problem:
      "Templates were rendered with surrogate pairs split at segment boundaries; no GSM-7 vs UCS-2 detection before send.",
    fix:
      "Detect encoding (GSM-7 charset vs UCS-2) and segment at grapheme boundaries with `Intl.Segmenter` before calling Twilio.",
    service: "notify-svc",
    error_code: "21606",
    resolution_steps: [
      "Add grapheme-aware splitter: `new Intl.Segmenter('en', {granularity:'grapheme'})`.",
      "If any char outside GSM-7 → treat whole body as UCS-2 (70-char segments).",
      "Re-send failed queue messages after re-segmentation.",
    ],
    tags: ["twilio", "sms", "unicode", "segmentation"],
    status: "stale",
    reviewer: "sam.okafor",
    review_due: daysAgo(18),
    reviewed_at: daysAgo(122),
    last_review_note: "Verified a while ago; no recalls since Q1.",
    created_by: "jules.romain",
    created_at: daysAgo(400),
    updated_at: daysAgo(122),
    last_recalled_at: daysAgo(48),
    recall_count: 6,
    use_count: 2,
    vote_score: 7,
    archived_at: null,
  },
  {
    id: "card_heroku_router",
    title: "Heroku router H12 timeout on long CSV exports (superseded)",
    error_signal:
      "Router log `at=error code=H12 desc=Request timeout` after 30s on /exports?range=all — worked on smaller ranges.",
    problem:
      "Synchronous export streamed >30s; Heroku kills idle responses at 30s.",
    fix:
      "Move export to a background job with a pre-signed S3 URL delivered by email. NOTE: superseded by the streaming NDJSON approach on the /exports/v2 route.",
    service: "exports-api",
    error_code: "H12",
    resolution_steps: [
      "Enqueue export job, return 202 with job id.",
      "Deliver pre-signed S3 link on completion.",
      "Legacy sync path returns 410 Gone since v2.",
    ],
    tags: ["heroku", "exports", "background-jobs"],
    status: "verified",
    reviewer: "maya.chen",
    review_due: null,
    reviewed_at: daysAgo(70),
    last_review_note: "Kept for lineage; see SUPERSEDES edge to v2 card.",
    created_by: "maya.chen",
    created_at: daysAgo(320),
    updated_at: daysAgo(70),
    last_recalled_at: daysAgo(90),
    recall_count: 11,
    use_count: 4,
    vote_score: 12,
    archived_at: null,
  },
];

const edges: MemoryEdge[] = [
  {
    id: "edge_1",
    from_card: "card_stripe_sig",
    to_card: "card_gql_timeout",
    relation: "SIMILAR_TO",
    note: "Both were 'works locally, dies behind infra' — proxy/ingress layer suspects first.",
    created_by: "arun.patel",
    created_at: daysAgo(90),
  },
  {
    id: "edge_2",
    from_card: "card_saml_clock",
    to_card: "card_oauth_pkce",
    relation: "SIMILAR_TO",
    note: "Auth handshake family; check clock/cookies before protocol internals.",
    created_by: "maya.chen",
    created_at: daysAgo(45),
  },
  {
    id: "edge_3",
    from_card: "card_rabbit_prefetch",
    to_card: "card_salesforce_dupes",
    relation: "BLOCKS",
    note: "Prefetch fix must land before backfill reruns or dupes return.",
    created_by: "sam.okafor",
    created_at: daysAgo(30),
  },
  {
    id: "edge_4",
    from_card: "card_heroku_router",
    to_card: "card_rabbit_prefetch",
    relation: "CAUSED_BY",
    note: "Export job burst filled the queue that later OOM'd consumers.",
    created_by: "maya.chen",
    created_at: daysAgo(28),
  },
];

const asks: AskSession[] = [
  {
    id: "ask_1",
    question: "Stripe webhooks return 400 in prod after the ingress change. Signature error every time.",
    context: {
      service: "stripe-webhooks",
      environment: "production",
      changed_recently: "nginx ingress rollout",
      payload_snippet: '{"error":"No signatures found matching the expected signature"}',
    },
    asks: [
      {
        id: "q1",
        question: "Which host/ingress fronts the webhook route, and did TLS termination move?",
        question_kind: "environment",
        answer: "nginx ingress, TLS terminated at the LB since yesterday",
        asked_at: daysAgo(2),
        answered_at: daysAgo(2),
      },
      {
        id: "q2",
        question: "Is the route reading the raw request body or a parsed JSON object?",
        question_kind: "payload",
        answer: "req.json() was used; we switched to req.text()",
        asked_at: daysAgo(2),
        answered_at: daysAgo(2),
      },
    ],
    answer:
      "High-confidence recall: this matches [card_stripe_sig] — Stripe 400 signature errors behind an ingress change are almost always raw-body loss. The fix: read `req.text()` before parsing, pass the `stripe-signature` header through unchanged, and validate against the concatenated raw string. Steps 1–3 in the cited card apply directly.",
    citations: [
      {
        card_id: "card_stripe_sig",
        card_title: "Stripe webhook 400 'No signatures found' behind nginx",
        field: "fix",
        quote:
          "Read the raw body with `await req.text()` before any JSON parsing, disable body parsing in the route, and pass the `stripe-signature` header through unchanged.",
        locator: "fix",
        score: 0.94,
      },
      {
        card_id: "card_stripe_sig",
        card_title: "Stripe webhook 400 'No signatures found' behind nginx",
        field: "resolution_steps",
        quote: "Read raw body: `const payload = await req.text()`.",
        locator: "resolution_steps[1]",
        score: 0.91,
      },
    ],
    confidence: "high",
    resolved: true,
    outcome:
      "Confirmed: switching to req.text() and forwarding stripe-signature fixed 100% of prod 400s. Ingress change was the trigger.",
    outcome_worked: true,
    asked_by: "arun.patel",
    channel: "slack",
    created_at: daysAgo(2),
    resolved_at: daysAgo(2),
  },
  {
    id: "ask_2",
    question: "CRM sync keeps creating duplicate accounts overnight. Where do I start?",
    context: { service: "crm-sync", environment: "production" },
    asks: [
      {
        id: "q3",
        question: "Are multiple worker pods consuming from the same queue, and do batches have visibility timeouts?",
        question_kind: "config",
        answer: "Yes, 3 pods, 2-minute visibility timeout on 10-minute batches",
        asked_at: daysAgo(9),
        answered_at: daysAgo(9),
      },
    ],
    answer:
      "Matched [card_salesforce_dupes] with medium confidence: retried batches race when visibility timeouts lapse mid-batch, and upsert-by-name allows both to create. Apply the External_Id__c keying + distributed lock fix, but note the BLOCKS edge: land the RabbitMQ prefetch fix first so pods stop re-consuming batches.",
    citations: [
      {
        card_id: "card_salesforce_dupes",
        card_title: "Salesforce CRM sync creating duplicate Accounts on retry",
        field: "fix",
        quote:
          "Idempotent upsert keyed on `External_Id__c` plus a distributed lock per batch id (Redis, TTL 15m) before dispatch.",
        locator: "fix",
        score: 0.82,
      },
      {
        card_id: "card_rabbit_prefetch",
        card_title: "RabbitMQ consumer OOM-killed when batch sizes spike",
        field: "problem",
        quote:
          "Default prefetch of unlimited let the broker push the entire backlog into a single consumer process.",
        locator: "problem",
        score: 0.71,
      },
    ],
    confidence: "medium",
    resolved: false,
    outcome: null,
    outcome_worked: null,
    asked_by: "jules.romain",
    channel: "web",
    created_at: daysAgo(9),
    resolved_at: null,
  },
];

const events: ChannelEvent[] = [
  {
    id: "evt_1",
    channel: "slack",
    kind: "recall",
    summary: "#incidents · stripe webhook recall served from card_stripe_sig (confidence high)",
    created_at: daysAgo(2),
  },
  {
    id: "evt_2",
    channel: "web",
    kind: "retain",
    summary: "arun.patel retained outcome for ask_1 → card_stripe_sig use_count +1",
    created_at: daysAgo(2),
  },
  {
    id: "evt_3",
    channel: "extension",
    kind: "recall",
    summary: "Browser extension surface-recall on github.com/pulls — 2 cards shown, 1 clicked",
    created_at: daysAgo(3),
  },
  {
    id: "evt_4",
    channel: "teams",
    kind: "review",
    summary: "Teams review nudge sent to maya.chen for card_salesforce_dupes (unverified 38d)",
    created_at: daysAgo(5),
  },
  {
    id: "evt_5",
    channel: "mcp",
    kind: "recall",
    summary: "MCP tool search_bug_memory called by IDE agent — top hit card_gql_timeout",
    created_at: daysAgo(7),
  },
];

const versions: CardVersion[] = [
  {
    id: "ver_1",
    card_id: "card_stripe_sig",
    version: 1,
    snapshot: { ...cards[0], fix: "Restart the ingress pod and retry the webhook." },
    changed_by: "arun.patel",
    change_note: "Initial retain from incident INC-2214.",
    created_at: daysAgo(120),
  },
  {
    id: "ver_2",
    card_id: "card_stripe_sig",
    version: 2,
    snapshot: cards[0],
    changed_by: "maya.chen",
    change_note: "Review pass: replaced anecdotal fix with raw-body steps; verified.",
    created_at: daysAgo(11),
  },
  {
    id: "ver_3",
    card_id: "card_rabbit_prefetch",
    version: 1,
    snapshot: { ...cards[3], fix: "Increase consumer memory to 1Gi and redeploy." },
    changed_by: "sam.okafor",
    change_note: "First pass — memory bump only.",
    created_at: daysAgo(210),
  },
  {
    id: "ver_4",
    card_id: "card_rabbit_prefetch",
    version: 2,
    snapshot: cards[3],
    changed_by: "arun.patel",
    change_note: "Root cause was unbounded prefetch; replaced memory-bump fix.",
    created_at: daysAgo(40),
  },
];

const permissions: CardPermission[] = [
  {
    card_id: "card_stripe_sig",
    principal: "team:payments",
    level: "edit",
    granted_by: "maya.chen",
    created_at: daysAgo(120),
  },
  {
    card_id: "card_stripe_sig",
    principal: "role:engineer",
    level: "read",
    granted_by: "maya.chen",
    created_at: daysAgo(120),
  },
  {
    card_id: "card_gql_timeout",
    principal: "team:platform",
    level: "edit",
    granted_by: "sam.okafor",
    created_at: daysAgo(95),
  },
  {
    card_id: "card_saml_clock",
    principal: "team:identity",
    level: "admin",
    granted_by: "jules.romain",
    created_at: daysAgo(60),
  },
  {
    card_id: "card_salesforce_dupes",
    principal: "team:revenue-systems",
    level: "comment",
    granted_by: "maya.chen",
    created_at: daysAgo(38),
  },
];

const reputation: ReputationLedger[] = [
  { engineer: "maya.chen", points: 25, reason: "verified card_stripe_sig via review loop", card_id: "card_stripe_sig", created_at: daysAgo(11) },
  { engineer: "arun.patel", points: 20, reason: "retained outcome for ask_1", card_id: "card_stripe_sig", created_at: daysAgo(2) },
  { engineer: "sam.okafor", points: 15, reason: "verified card_rabbit_prefetch", card_id: "card_rabbit_prefetch", created_at: daysAgo(40) },
  { engineer: "jules.romain", points: 8, reason: "tagged card_saml_clock (clock-skew)", card_id: "card_saml_clock", created_at: daysAgo(55) },
  { engineer: "maya.chen", points: 12, reason: "linked SIMILAR_TO edge (proxy-family errors)", card_id: null, created_at: daysAgo(45) },
  { engineer: "arun.patel", points: 10, reason: "created card_oauth_pkce", card_id: "card_oauth_pkce", created_at: daysAgo(52) },
  { engineer: "sam.okafor", points: 9, reason: "vote +5 on card_gql_timeout", card_id: "card_gql_timeout", created_at: daysAgo(26) },
];

export const DEMO_CARDS = cards;
export const DEMO_EDGES = edges;
export const DEMO_ASKS = asks;
export const DEMO_EVENTS = events;
export const DEMO_VERSIONS = versions;
export const DEMO_PERMISSIONS = permissions;
export const DEMO_REPUTATION = reputation;

/** Per-card version history (demuxed from the shared array). */
export function demoVersionsFor(cardId: string): CardVersion[] {
  return versions.filter((v) => v.card_id === cardId).sort((a, b) => b.version - a.version);
}

export function demoPermissionsFor(cardId: string): CardPermission[] {
  return permissions.filter((p) => p.card_id === cardId);
}

export const ENGINEER_REPUTATION: Record<string, number> = reputation.reduce(
  (acc, r) => {
    acc[r.engineer] = (acc[r.engineer] ?? 0) + r.points;
    return acc;
  },
  {} as Record<string, number>,
);

export const KNOWN_ENGINEERS = [
  "arun.patel",
  "maya.chen",
  "sam.okafor",
  "jules.romain",
  "you",
];
