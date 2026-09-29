import { listReputation } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ReputationPage() {
  const ledger = await listReputation();
  const totals = Object.entries(
    ledger.reduce<Record<string, number>>((acc, r) => {
      acc[r.engineer] = (acc[r.engineer] ?? 0) + r.points;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="space-y-6">
      <header className="animate-fade-up">
        <h1 className="text-xl font-semibold text-stone-900">Reputation</h1>
        <p className="mt-1 text-sm text-stone-500">
          Points flow from the actions that make memory trustworthy: verifying cards, retaining outcomes, tagging and linking.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel animate-fade-up-1 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">Leaderboard</h2>
          <ol className="mt-3 space-y-2">
            {totals.map(([eng, pts], i) => (
              <li key={eng} className="flex items-center gap-3">
                <span className="w-6 text-center">{medals[i] ?? i + 1}</span>
                <span className="flex-1 text-sm text-stone-700">{eng}</span>
                <div className="h-2 w-40 overflow-hidden rounded-full bg-[#f0ead9]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-700"
                    style={{ width: `${Math.min(100, (pts / Math.max(totals[0][1], 1)) * 100)}%` }}
                  />
                </div>
                <span className="w-14 text-right font-mono text-xs text-teal-700">{pts} pts</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel animate-fade-up-2 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">Ledger</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {ledger.slice(0, 12).map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-3 border-l-2 border-[#e7e0d2] pl-3">
                <div>
                  <p className="text-stone-700">{r.reason}</p>
                  <p className="text-[11px] text-stone-400">{r.engineer} · {new Date(r.created_at).toLocaleDateString()}</p>
                </div>
                <span className="font-mono text-xs text-teal-700">+{r.points}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
