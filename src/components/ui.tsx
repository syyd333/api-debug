import Link from "next/link";
import type { KnowledgeCard } from "@/lib/types";

export function StatusBadge({ status }: { status: KnowledgeCard["status"] }) {
  const styles: Record<KnowledgeCard["status"], string> = {
    verified: "chip chip-accent",
    unverified: "chip chip-amber",
    stale: "chip",
    archived: "chip chip-stone",
  };
  const dot: Record<KnowledgeCard["status"], string> = {
    verified: "bg-teal-500",
    unverified: "bg-amber-500",
    stale: "bg-orange-400",
    archived: "bg-stone-400",
  };
  return (
    <span className={styles[status]}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot[status]}`} />
      {status}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cls =
    confidence === "high" ? "chip chip-accent" : confidence === "medium" ? "chip" : confidence === "low" ? "chip chip-amber" : "chip chip-stone";
  return <span className={cls}>{confidence}</span>;
}

export function CardRow({ card }: { card: KnowledgeCard }) {
  return (
    <Link
      href={`/cards/${card.id}`}
      className="panel panel-hover animate-fade-up block p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={card.status} />
        <span className="chip font-mono">{card.service}</span>
        {card.error_code && <span className="chip chip-rose font-mono">{card.error_code}</span>}
        <span className="ml-auto text-[11px] text-stone-400">
          ▲ {card.vote_score} · ↻ {card.recall_count} · ✔ {card.use_count}
        </span>
      </div>
      <h3 className="mt-2 font-medium text-stone-800">{card.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-stone-500">{card.error_signal}</p>
      {card.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.map((t) => (
            <span key={t} className="chip"># {t}</span>
          ))}
        </div>
      )}
    </Link>
  );
}
