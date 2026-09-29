"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { KnowledgeCard, ReviewOutcome } from "@/lib/types";
import { StatusBadge } from "@/components/ui";

export default function ReviewPage() {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/cron/stale-archive");
      const info = await res.json();
      if (info.became_stale?.length || info.archived?.length) {
        setMessage(`Verification loop: ${info.became_stale.length} card(s) went stale, ${info.archived.length} auto-archived.`);
      }
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    const res = await fetch("/api/cards");
    const data = await res.json();
    setCards(data.cards ?? []);
    setLoading(false);
  }

  async function review(cardId: string, outcome: ReviewOutcome) {
    setBusyId(cardId);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId, outcome, note: notes[cardId] ?? "", reviewer: "maya.chen" }),
      });
      const data = await res.json();
      if (data.ok) {
        setCards((cs) => cs.map((c) => (c.id === cardId ? data.card : c)));
        setMessage(`Review recorded: ${cardId} → ${data.card.status}`);
      }
    } finally {
      setBusyId(null);
    }
  }

  const due = cards
    .filter((c) => c.status !== "archived" && c.review_due && new Date(c.review_due) < new Date())
    .concat(cards.filter((c) => c.status === "unverified" && !c.review_due));

  const uniqueDue = Array.from(new Map(due.map((c) => [c.id, c])).values());

  return (
    <div className="space-y-4">
      <header className="animate-fade-up">
        <h1 className="text-xl font-semibold text-stone-900">Review queue</h1>
        <p className="mt-1 text-sm text-stone-500">
          Every card carries a status, an assigned expert reviewer and a review schedule. Confirmed/corrected cards become{" "}
          <span className="font-medium text-teal-700">verified</span> (+25 reputation); rejected ones are archived. Stale, unused cards
          auto-archive past the grace window.
        </p>
      </header>

      {message && <p className="animate-fade-up rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">{message}</p>}
      {loading && <p className="text-sm text-stone-400">Loading queue…</p>}

      <div className="space-y-3">
        {uniqueDue.map((c) => (
          <div key={c.id} className="panel animate-fade-up p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={c.status} />
              <span className="chip font-mono">{c.service}</span>
              <span className="text-[11px] text-stone-400">
                reviewer: {c.reviewer ?? "unassigned"} · due {c.review_due ? new Date(c.review_due).toLocaleDateString() : "—"} · recalls {c.recall_count}
              </span>
              <Link href={`/cards/${c.id}`} className="ml-auto text-xs font-medium text-teal-700 transition-colors hover:text-teal-600">open →</Link>
            </div>
            <h2 className="mt-2 font-medium text-stone-800">{c.title}</h2>
            <p className="mt-1 text-sm text-stone-500">{c.problem}</p>
            <p className="mt-1 text-sm text-teal-800/80">Fix: {c.fix}</p>
            <input
              value={notes[c.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
              placeholder="Review note (e.g. re-verified on staging; corrected step 2)"
              className="input mt-3"
            />
            <div className="mt-2 flex gap-2">
              <button onClick={() => review(c.id, "confirmed")} disabled={busyId === c.id}
                className="btn btn-primary btn-xs">✓ Confirm</button>
              <button onClick={() => review(c.id, "corrected")} disabled={busyId === c.id}
                className="btn btn-ghost btn-xs border-sky-300 text-sky-700 hover:bg-sky-50">✎ Correct</button>
              <button onClick={() => review(c.id, "rejected")} disabled={busyId === c.id}
                className="btn btn-ghost btn-xs border-rose-200 text-rose-700 hover:bg-rose-50">✕ Reject</button>
            </div>
          </div>
        ))}
        {!loading && uniqueDue.length === 0 && (
          <p className="panel p-8 text-center text-sm text-stone-400">
            Review queue is clear — every card is verified and scheduled. 🎉
          </p>
        )}
      </div>
    </div>
  );
}
