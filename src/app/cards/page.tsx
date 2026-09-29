import Link from "next/link";
import { listCards } from "@/lib/data";
import { CardRow } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CardsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; service?: string }> }) {
  const sp = await searchParams;
  const cards = await listCards();
  const q = (sp.q ?? "").toLowerCase();
  const status = sp.status ?? "all";
  const service = sp.service ?? "all";

  const services = Array.from(new Set(cards.map((c) => c.service))).sort();
  const filtered = cards.filter((c) => {
    if (status !== "all" && c.status !== status) return false;
    if (service !== "all" && c.service !== service) return false;
    if (!q) return true;
    return (
      c.title.toLowerCase().includes(q) ||
      c.error_signal.toLowerCase().includes(q) ||
      c.problem.toLowerCase().includes(q) ||
      c.fix.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  const STATUSES = ["all", "verified", "unverified", "stale", "archived"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-stone-900">Knowledge cards</h1>
        <form className="ml-auto flex flex-wrap items-center gap-2" action="/cards">
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search error, fix, tag…"
            className="input w-64"
          />
          <select name="status" defaultValue={status} className="input w-auto pr-8">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select name="service" defaultValue={service} className="input w-auto pr-8">
            <option value="all">all services</option>
            {services.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-ghost btn-xs">Filter</button>
        </form>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c, i) => <CardRow key={c.id} card={c} />)}
      </div>
      {filtered.length === 0 && (
        <p className="panel p-8 text-center text-sm text-stone-400">
          No cards match. Every unsolved bug is future knowledge — <Link href="/ask" className="font-medium text-teal-700 hover:text-teal-600">ask and retain</Link>.
        </p>
      )}
    </div>
  );
}
