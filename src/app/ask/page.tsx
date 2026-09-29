"use client";

import { useState } from "react";
import Link from "next/link";
import type { AskSession, Citation } from "@/lib/types";

interface Gap {
  key: string;
  label: string;
  question: string;
  placeholder: string;
}

interface AskResponse {
  needs_context: boolean;
  message?: string;
  gaps?: Gap[];
  session?: AskSession;
  ranked?: Array<{ id: string; title: string; score: number }>;
  related?: Array<{ relation: string; card: string; title: string }>;
}

const CONTEXT_KEYS = ["service", "environment", "status_code", "message", "changed_recently", "payload_snippet", "auth_flow"];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState<Record<string, string>>({});
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [session, setSession] = useState<AskSession | null>(null);
  const [ranked, setRanked] = useState<AskResponse["ranked"]>([]);
  const [related, setRelated] = useState<AskResponse["related"]>([]);
  const [phase, setPhase] = useState<"question" | "context" | "answer">("question");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [worked, setWorked] = useState(true);
  const [retained, setRetained] = useState(false);

  async function submitQuestion() {
    if (!question.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, context }),
      });
      const data: AskResponse = await res.json();
      if (data.needs_context && data.gaps) {
        setGaps(data.gaps);
        setPhase("context");
      } else if (data.session) {
        setSession(data.session);
        setRanked(data.ranked ?? []);
        setRelated(data.related ?? []);
        setPhase("answer");
      }
    } finally {
      setBusy(false);
    }
  }

  async function retain() {
    if (!session || !outcome.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/retain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, outcome, worked, engineer: "you" }),
      });
      if (res.ok) setRetained(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="animate-fade-up">
        <h1 className="text-xl font-semibold text-stone-900">Ask Deja Fix</h1>
        <p className="mt-1 text-sm text-stone-500">
          Hindsight, stage 1: Deja Fix asks for missing context <em>before</em> diagnosing, so recalls are trustworthy — and stage 4:
          the resolved outcome gets retained for the next engineer.
        </p>
      </header>

      {phase === "question" && (
        <section className="animate-fade-up-1 space-y-3">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={4}
            placeholder="e.g. Stripe webhooks return 400 in prod after the ingress change — signature error every time."
            className="input resize-none p-4 leading-relaxed"
          />
          <details className="panel p-4 text-sm">
            <summary className="cursor-pointer select-none font-medium text-stone-600 transition-colors hover:text-stone-900">
              Optional: provide context up front
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {CONTEXT_KEYS.map((k) => (
                <label key={k} className="text-xs text-stone-500">
                  {k.replace(/_/g, " ")}
                  <input
                    value={context[k] ?? ""}
                    onChange={(e) => setContext((c) => ({ ...c, [k]: e.target.value }))}
                    className="input mt-1"
                  />
                </label>
              ))}
            </div>
          </details>
          <button onClick={submitQuestion} disabled={busy || !question.trim()} className="btn btn-primary">
            {busy ? "Thinking…" : "Diagnose →"}
          </button>
        </section>
      )}

      {phase === "context" && (
        <section className="animate-fade-up space-y-3">
          <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
            Before I diagnose, I need a few details so the recall is trustworthy:
          </p>
          {gaps.map((g) => (
            <label key={g.key} className="panel animate-fade-up block p-4 text-sm">
              <span className="font-medium text-stone-700">{g.question}</span>
              <input
                value={context[g.key] ?? ""}
                onChange={(e) => setContext((c) => ({ ...c, [g.key]: e.target.value }))}
                placeholder={g.placeholder}
                className="input mt-2"
              />
            </label>
          ))}
          <div className="flex gap-2">
            <button onClick={submitQuestion} disabled={busy} className="btn btn-primary">
              {busy ? "Recalling…" : "Diagnose with this context →"}
            </button>
            <button onClick={() => setPhase("question")} className="btn btn-ghost">Back</button>
          </div>
        </section>
      )}

      {phase === "answer" && session && (
        <section className="space-y-4">
          <div className="panel animate-fade-up p-5">
            <div className="flex items-center gap-2">
              <span className={`chip ${session.confidence === "high" ? "chip-accent" : session.confidence === "medium" ? "" : "chip-amber"}`}>
                {session.confidence}
              </span>
              <span className="text-xs text-stone-400">every claim below is cited</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{session.answer}</p>
          </div>

          {session.citations.length > 0 && (
            <div className="animate-fade-up-1 space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">Citations / lineage</h2>
              {session.citations.map((c: Citation, i) => (
                <div key={i} className="panel p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
                    <span className="chip font-mono">[{i + 1}]</span>
                    <Link href={`/cards/${c.card_id}`} className="font-medium text-stone-600 transition-colors hover:text-teal-700">{c.card_title}</Link>
                    <span className="font-mono">{c.locator}</span>
                    <span className="ml-auto">{Math.round(c.score * 100)}% match</span>
                  </div>
                  <blockquote className="mt-2 border-l-2 border-teal-500/60 pl-3 text-stone-600">&ldquo;{c.quote}&rdquo;</blockquote>
                </div>
              ))}
            </div>
          )}

          {related && related.length > 0 && (
            <div className="panel animate-fade-up-2 p-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Typed relationships</h2>
              <ul className="mt-2 space-y-1 text-stone-600">
                {related.map((r, i) => (
                  <li key={i}>
                    <span className="font-mono text-[11px] text-teal-700">{r.relation}</span> →{" "}
                    <Link href={`/cards/${r.card}`} className="transition-colors hover:text-teal-700">{r.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ranked && ranked.length > 1 && (
            <div className="panel animate-fade-up-2 p-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Other candidates</h2>
              <ul className="mt-2 space-y-1">
                {ranked.slice(1).map((r) => (
                  <li key={r.id} className="flex items-center justify-between">
                    <Link href={`/cards/${r.id}`} className="text-stone-600 transition-colors hover:text-teal-700">{r.title}</Link>
                    <span className="font-mono text-xs text-stone-400">{r.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel animate-fade-up-3 border-teal-200 bg-teal-50/50 p-5">
            <h2 className="text-sm font-semibold text-teal-800">Resolve it? Retain the outcome.</h2>
            <p className="mt-1 text-xs text-stone-500">
              Retention closes the loop: bump the cited cards&apos; use counts, refresh their staleness, and award reputation.
            </p>
            <textarea
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              rows={3}
              placeholder="What actually happened? e.g. 'Switching to req.text() fixed all prod 400s; trigger was the ingress rollout.'"
              className="input mt-3 resize-none bg-white"
            />
            <div className="mt-2 flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-500">
                <input type="checkbox" checked={worked} onChange={(e) => setWorked(e.target.checked)} className="accent-teal-700" /> the fix worked
              </label>
              <button onClick={retain} disabled={busy || !outcome.trim() || retained} className="btn btn-primary ml-auto">
                {retained ? "✓ Retained" : busy ? "Retaining…" : "Retain outcome"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
