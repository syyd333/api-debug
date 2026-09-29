import Link from "next/link";
import { notFound } from "next/navigation";
import { listCards, listEdges, versionsFor, permissionsFor } from "@/lib/data";
import { stalenessOf } from "@/lib/hindsight";
import { StatusBadge } from "@/components/ui";
import { RELATION_ARROW, type RelationType } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CardDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [cards, edges, versions, permissions] = await Promise.all([
    listCards(), listEdges(), versionsFor(id), permissionsFor(id),
  ]);
  const card = cards.find((c) => c.id === id);
  if (!card) notFound();

  const related = edges
    .filter((e) => e.from_card === id || e.to_card === id)
    .map((e) => ({
      edge: e,
      direction: e.from_card === id ? "out" : "in",
      other: cards.find((c) => c.id === (e.from_card === id ? e.to_card : e.from_card)),
    }))
    .filter((r) => r.other);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="animate-fade-up flex flex-wrap items-center gap-2">
          <StatusBadge status={card.status} />
          <span className="chip font-mono">{card.service}</span>
          {card.error_code && <span className="chip chip-rose font-mono">{card.error_code}</span>}
          <span className="ml-auto font-mono text-[11px] text-stone-400">{card.id}</span>
        </div>

        <h1 className="animate-fade-up-1 text-2xl font-semibold tracking-tight text-stone-900">{card.title}</h1>

        <div className="space-y-3">
          <Section title="Error signal" body={card.error_signal} accent="border-rose-400" titleColor="text-rose-700" delay="animate-fade-up-1" />
          <Section title="Problem" body={card.problem} accent="border-amber-400" titleColor="text-amber-700" delay="animate-fade-up-2" />
          <Section title="Fix" body={card.fix} accent="border-teal-500" titleColor="text-teal-700" delay="animate-fade-up-3" />
          <section className="panel animate-fade-up-3 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Resolution steps</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-stone-600">
              {card.resolution_steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </section>
        </div>

        {related.length > 0 && (
          <section className="panel animate-fade-up-3 p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Typed relationships</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-stone-600">
              {related.map(({ edge, direction, other }) => (
                <li key={edge.id}>
                  {direction === "out" ? (
                    <>
                      <span className="font-mono text-xs text-teal-700">{RELATION_ARROW[edge.relation as RelationType]}</span>{" "}
                      <Link href={`/cards/${other!.id}`} className="transition-colors hover:text-teal-700">{other!.title}</Link>
                    </>
                  ) : (
                    <>
                      <Link href={`/cards/${other!.id}`} className="transition-colors hover:text-teal-700">{other!.title}</Link>{" "}
                      <span className="font-mono text-xs text-teal-700">→ {edge.relation} →</span> this
                    </>
                  )}
                  {edge.note && <span className="text-stone-400"> — {edge.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel animate-fade-up-3 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Version history</h2>
          <ol className="mt-3 space-y-3">
            {versions.map((v) => (
              <li key={v.id} className="border-l-2 border-[#e7e0d2] pl-3">
                <div className="flex items-center gap-2 text-xs text-stone-400">
                  <span className="chip font-mono">v{v.version}</span>
                  <span>{v.changed_by}</span>
                  <span>{new Date(v.created_at).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-stone-600">{v.change_note}</p>
                {v.snapshot.fix && v.snapshot.fix !== card.fix && (
                  <p className="mt-1 text-xs text-stone-400">fix at v{v.version}: {v.snapshot.fix}</p>
                )}
              </li>
            ))}
            {versions.length === 0 && <li className="text-sm text-stone-400">No versions recorded yet.</li>}
          </ol>
        </section>
      </div>

      <aside className="space-y-4">
        <section className="panel animate-fade-up-1 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Votes & reputation</h2>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-teal-700">{card.vote_score}</span>
            <span className="text-xs text-stone-400">votes · one per engineer, atomic via vote_card() RPC</span>
          </div>
        </section>

        <section className="panel animate-fade-up-2 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Retention telemetry</h2>
          <dl className="mt-2 space-y-1 text-sm text-stone-600">
            <Row k="Recalls" v={String(card.recall_count)} />
            <Row k="Confirmed uses" v={String(card.use_count)} />
            <Row k="Last recalled" v={card.last_recalled_at ? new Date(card.last_recalled_at).toLocaleDateString() : "never"} />
            <Row k="Staleness" v={stalenessOf(card)} />
          </dl>
        </section>

        <section className="panel animate-fade-up-2 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Review schedule</h2>
          <dl className="mt-2 space-y-1 text-sm text-stone-600">
            <Row k="Reviewer" v={card.reviewer ?? "unassigned"} />
            <Row k="Review due" v={card.review_due ? new Date(card.review_due).toLocaleDateString() : "—"} />
            <Row k="Last reviewed" v={card.reviewed_at ? new Date(card.reviewed_at).toLocaleDateString() : "—"} />
            <Row k="Status" v={card.status} />
          </dl>
          {card.last_review_note && <p className="mt-2 text-xs italic text-stone-400">“{card.last_review_note}”</p>}
          <Link href="/review" className="mt-3 inline-block text-xs font-medium text-teal-700 transition-colors hover:text-teal-600">Review this card →</Link>
        </section>

        <section className="panel animate-fade-up-3 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Permissions</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {permissions.map((p) => (
              <li key={p.principal} className="flex items-center justify-between">
                <span className="font-mono text-xs text-stone-600">{p.principal}</span>
                <span className="chip chip-stone text-[10px] uppercase">{p.level}</span>
              </li>
            ))}
            {permissions.length === 0 && <li className="text-stone-400">No explicit grants (default read).</li>}
          </ul>
        </section>

        <section className="panel animate-fade-up-3 p-4 text-xs text-stone-400">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Provenance</h2>
          <p className="mt-2">Created by <span className="text-stone-600">{card.created_by}</span> on {new Date(card.created_at).toLocaleDateString()}</p>
          <p className="mt-1">Tags: {card.tags.map((t) => `#${t}`).join(" ") || "—"}</p>
        </section>
      </aside>
    </div>
  );
}

function Section({ title, body, accent, titleColor, delay }: { title: string; body: string; accent: string; titleColor: string; delay: string }) {
  return (
    <section className={`panel ${delay} p-4`}>
      <h2 className={`border-l-2 pl-2 text-xs font-semibold uppercase tracking-wider ${accent} ${titleColor}`}>{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">{body}</p>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs text-stone-400">{k}</dt>
      <dd className="text-xs text-stone-600">{v}</dd>
    </div>
  );
}
