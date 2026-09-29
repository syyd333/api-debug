import type { KnowledgeCard } from "./types";

export interface ExampleBug {
  id: string;
  emoji: string;
  label: string;
  /** The question text pasted into the ask box. */
  question: string;
  /** Pre-filled context so the ask engine can diagnose immediately. */
  context: Record<string, string>;
  /** The card this example is designed to recall. */
  expectedCardId: string;
  expectedConfidence: "high" | "medium" | "low";
  /** One-line teaser shown on the chip. */
  teaser: string;
}

/**
 * Each example is a real integration-bug story wired to a knowledge card in the
 * corpus, so asking it demos the full hindsight loop: context → recall → cited
 * answer → retain.
 */
export const EXAMPLE_BUGS: ExampleBug[] = [
  {
    id: "stripe",
    emoji: "💳",
    label: "Stripe webhook 400s",
    question:
      "Stripe webhooks started returning 400 'No signatures found matching the expected signature' right after we rolled out the new nginx ingress. Every delivery fails in production but the same code works fine when I test locally with the Stripe CLI.",
    context: {
      service: "stripe-webhooks",
      environment: "production",
      status_code: "400",
      message: "No signatures found matching the expected signature for payload",
      changed_recently: "nginx ingress rollout yesterday",
      payload_snippet: '{"error":"No signatures found matching the expected signature for payload"}',
      auth_flow: "HMAC signature via stripe-signature header",
    },
    expectedCardId: "card_stripe_sig",
    expectedConfidence: "high",
    teaser: "works locally, dies in prod after ingress change",
  },
  {
    id: "graphql",
    emoji: "🕸️",
    label: "GraphQL ETIMEDOUT",
    question:
      "Every GraphQL resolver that touches Postgres hangs for 30 seconds and then dies with ETIMEDOUT to 10.4.12.9:5432 ever since the VPC peering change. The healthcheck passes but real queries just hang.",
    context: {
      service: "graphql-api",
      environment: "production",
      status_code: "ETIMEDOUT",
      message: "ETIMEDOUT 10.4.12.9:5432 on resolver queries",
      changed_recently: "VPC peering change last week",
      payload_snippet: "query { orders(first: 10) { id } } → hangs 30s → ETIMEDOUT",
    },
    expectedCardId: "card_gql_timeout",
    expectedConfidence: "high",
    teaser: "healthcheck passes, resolvers hang since VPC change",
  },
  {
    id: "crm",
    emoji: "🔁",
    label: "Salesforce duplicate accounts",
    question:
      "Our nightly Salesforce sync keeps creating duplicate Accounts — about 3% of records come back DUPLICATE_VALUE. It started when we added a third worker pod and batches sometimes get processed twice.",
    context: {
      service: "crm-sync",
      environment: "production",
      status_code: "DUPLICATE_VALUE",
      message: "DUPLICATE_VALUE duplicate external id on account upsert",
      changed_recently: "scaled from 2 to 3 worker pods",
      payload_snippet: "upsert Account by Name; batch visibility timeout 2m, batches take 10m",
    },
    expectedCardId: "card_salesforce_dupes",
    expectedConfidence: "medium",
    teaser: "duplicates appear when a batch is retried",
  },
  {
    id: "saml",
    emoji: "🔐",
    label: "SAML login loop",
    question:
      "Okta SAML login is stuck in a redirect loop — our IdP check throws 'NotBefore condition violated' on every assertion. Clock inside the pods is about 2 minutes ahead of real time.",
    context: {
      service: "auth-svc",
      environment: "production",
      status_code: "401",
      message: "NotBefore condition violated in SAML assertion",
      changed_recently: "new node image last week",
      auth_flow: "SAML 2.0 via Okta",
      payload_snippet: "pod clock skew 00:02:17 ahead of Okta",
    },
    expectedCardId: "card_saml_clock",
    expectedConfidence: "medium",
    teaser: "assertions rejected before they're even read",
  },
];

/** Find the example whose expected card matches, used by the demo pipeline. */
export function exampleForCard(card: KnowledgeCard): ExampleBug | undefined {
  return EXAMPLE_BUGS.find((e) => e.expectedCardId === card.id);
}
