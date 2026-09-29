import { listEvents } from "@/lib/data";

export const dynamic = "force-dynamic";

const CHANNELS = [
  {
    name: "Slack",
    endpoint: "/api/integrations/slack",
    how: "Create a Slack app → Slash Commands `/deja` + Event Subscriptions (app_mention) → Request URL this endpoint. Bot responds with recalled fix + citations.",
  },
  {
    name: "Microsoft Teams",
    endpoint: "/api/integrations/teams",
    how: "Register an Azure Bot → set Messaging endpoint to this URL → add the bot to a channel. Post an error message; the bot replies with the retained fix.",
  },
  {
    name: "Browser extension",
    endpoint: "/api/recall?channel=extension",
    how: "Content script watches active tab (console, network panel, docs pages) → GET /api/recall?q=<tab error>&channel=extension → surfaces a 'Deja vu?' pill with the cited fix.",
  },
  {
    name: "MCP (IDE agents)",
    endpoint: "/api/mcp",
    how: "Point Claude Desktop / Cursor / VS Code at this JSON-RPC URL. Tools: search_bug_memory, get_card, retain_outcome, submit_review.",
  },
];

export default async function IntegrationsPage() {
  const events = await listEvents();

  return (
    <div className="space-y-6">
      <header className="animate-fade-up">
        <h1 className="text-xl font-semibold text-stone-900">Multi-channel delivery</h1>
        <p className="mt-1 text-sm text-stone-500">
          One memory, every surface engineers already use. Recalls and retains are logged per channel below.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {CHANNELS.map((ch, i) => (
          <section key={ch.name} className={`panel panel-hover animate-fade-up animate-fade-up-${Math.min(i + 1, 3)} p-5`}>
            <div className="flex items-center gap-2">
              <h2 className="font-medium text-stone-800">{ch.name}</h2>
              <code className="ml-auto rounded-md bg-[#f5f1e8] px-2 py-0.5 font-mono text-[10px] text-teal-800">{ch.endpoint}</code>
            </div>
            <p className="mt-2 text-sm text-stone-500">{ch.how}</p>
          </section>
        ))}
      </div>

      <section className="panel animate-fade-up-2 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">Channel event feed</h2>
        <div className="mt-3 space-y-2">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-3 text-sm">
              <span className="chip chip-stone mt-0.5 font-mono uppercase">{e.channel}</span>
              <span className="min-w-0 flex-1 text-stone-600">{e.summary}</span>
              <span className="whitespace-nowrap text-[11px] text-stone-400">{new Date(e.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel animate-fade-up-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">Try it from the CLI</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-stone-900 p-4 font-mono text-xs leading-relaxed text-stone-100">{`# recall from any channel
curl "$BASE_URL/api/recall?q=stripe+signature+400&channel=extension"

# MCP: list tools
curl -X POST "$BASE_URL/api/mcp" -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# MCP: recall a fix
curl -X POST "$BASE_URL/api/mcp" -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_bug_memory","arguments":{"query":"ETIMEDOUT after VPC peering","service":"graphql-api"}}}'`}</pre>
      </section>
    </div>
  );
}
