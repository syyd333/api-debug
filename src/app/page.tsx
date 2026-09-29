import Link from "next/link";
import { listCards, listEdges, listEvents, listAsks, listReputation, supabaseReady } from "@/lib/data";
import { CardRow, ConfidenceBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [cards, edges, events, asks, reputation, live] = await Promise.all([
    listCards(), listEdges(), listEvents(), listAsks(), listReputation(), supabaseReady(),
  ]);

  const verified = cards.filter((c) => c.status === "verified").length;
  const stale = cards.filter((c) => c.status === "stale").length;
  const archived = cards.filter((c) => c.status === "archived").length;
  const due = cards.filter((c) => c.review_due && new Date(c.review_due) < new Date() && c.status !== "archived");

  const reputationBoard = Object.entries(
    reputation.reduce<Record<string, number>>((acc, r) => {
      acc[r.engineer] = (acc[r.engineer] ?? 0) + r.points;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const stats = [
    { label: "Knowledge cards", value: cards.length, href: "/cards" },
    { label: "Verified", value: verified, href: "/cards?status=verified" },
    { label: "Typed edges", value: edges.length, href: "/graph" },
    { label: "Reviews due", value: due.length, href: "/review" },
    { label: "Stale", value: stale, href: "/cards?status=stale" },
    { label: "Archived", value: archived, href: "/cards?status=archived" },
  ];

  return (
    <div className="space-y-8">
      <section className="panel animate-fade-up relative overflow-hidden p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-teal-100/50 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-amber-100/40 blur-3xl" />
        <div className="relative">
          <p className="font-mono text-xs uppercase tracking-widest text-teal-700">hindsight · retain / recall</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-stone-900">
            Every integration bug you fix becomes an answer you never debug twice.
          </h1>
          <p className="mt-3 max-w-2xl text-stone-500">
            Deja Fix turns resolved API/integration bugs into verified knowledge cards with typed relationships, cites every answer
            it gives, and delivers recalls where engineers already work — Slack, Teams, browser, MCP.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/ask" className="btn btn-primary">Ask Deja Fix →</Link>
            <Link href="/cards" className="btn btn-ghost">Browse memory</Link>
          </div>
          {!live && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Running on the in-memory demo corpus. Run <code className="font-mono">supabase/migrations/0001_deja_fix_schema.sql</code> in
              your project&apos;s SQL editor to go live.
            </p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s, i) => (
          <Link
            key={s.label}
            href={s.href}
            className={`panel panel-hover animate-fade-up animate-fade-up-${Math.min(i + 1, 3)} p-4`}
          >
            <div className="text-2xl font-semibold text-stone-900">{s.value}</div>
            <div className="text-xs text-stone-500">{s.label}</div>
          </Link>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">Recent channel activity</h2>
          {events.map((e, i) => (
            <div key={e.id} className={`panel animate-fade-up animate-fade-up-${Math.min(i + 1, 3)} flex items-start gap-3 p-3`}>
              <span className="chip chip-stone mt-0.5 font-mono uppercase">{e.channel}</span>
              <div className="min-w-0">
                <p className="text-sm text-stone-700">{e.summary}</p>
                <p className="text-[11px] text-stone-400">{new Date(e.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
          <h2 className="pt-4 text-sm font-semibold uppercase tracking-wider text-stone-400">Recently retained</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {cards.slice(0, 4).map((c) => (
              <CardRow key={c.id} card={c} />
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <section className="panel animate-fade-up-1 p-4">
            <h2 className="text-sm font-semibold text-stone-700">Verification loop</h2>
            <p className="mt-1 text-xs text-stone-400">Expert reviewers keep knowledge trustworthy; unused memory ages out.</p>
            <ul className="mt-3 space-y-2 text-sm">
              {due.slice(0, 4).map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <StatusBadge status={c.status} />
                  <Link href={`/cards/${c.id}`} className="truncate text-stone-600 transition-colors hover:text-teal-700">{c.title}</Link>
                </li>
              ))}
              {due.length === 0 && <li className="text-stone-400">Nothing overdue. 🎉</li>}
            </ul>
            <Link href="/review" className="mt-3 inline-block text-xs font-medium text-teal-700 transition-colors hover:text-teal-600">Open review queue →</Link>
          </section>

          <section className="panel animate-fade-up-2 p-4">
            <h2 className="text-sm font-semibold text-stone-700">Latest ask sessions</h2>
            <ul className="mt-3 space-y-3">
              {asks.slice(0, 3).map((a) => (
                <li key={a.id} className="border-l-2 border-[#e7e0d2] pl-3">
                  <div className="flex items-center gap-2">
                    <ConfidenceBadge confidence={a.confidence} />
                    <span className="text-[11px] text-stone-400">{a.channel}</span>
                    {a.resolved && <span className="text-[11px] font-medium text-teal-700">✓ retained</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-stone-600">{a.question}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel animate-fade-up-3 p-4">
            <h2 className="text-sm font-semibold text-stone-700">Reputation</h2>
            <ol className="mt-3 space-y-1.5 text-sm">
              {reputationBoard.slice(0, 5).map(([eng, pts], i) => (
                <li key={eng} className="flex items-center justify-between">
                  <span className="text-stone-600">{i + 1}. {eng}</span>
                  <span className="font-mono text-xs text-teal-700">{pts} pts</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
