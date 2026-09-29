"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AskSession, Citation } from "@/lib/types";
import { EXAMPLE_BUGS } from "@/lib/examples";

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

const STAGES = [
  { key: "gaps", label: "Checking for missing context" },
  { key: "recall", label: "Scanning retained memory" },
  { key: "rank", label: "Ranking knowledge cards" },
  { key: "citations", label: "Assembling citations" },
  { key: "done", label: "Diagnosis ready" },
] as const;

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState<Record<string, string>>({});
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [session, setSession] = useState<AskSession | null>(null);
  const [ranked, setRanked] = useState<AskResponse["ranked"]>([]);
  const [related, setRelated] = useState<AskResponse["related"]>([]);
  const [phase, setPhase] = useState<"question" | "context" | "answer">("question");
  const [busy, setBusy] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);
  const [activeExample, setActiveExample] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const [worked, setWorked] = useState(true);
  const [retained, setRetained] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Clear any pending stage timers when unmounting mid-run.
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  /** Run the staged pipeline: real fetch, animated stages, min ~3s so the
   *  prototype visibly "works on it" before revealing the cited answer. */
  function runPipeline() {
    setBusy(true);
    setStageIdx(0);
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    const advance = (i: number, delay: number, after?: () => void) => {
      timersRef.current.push(setTimeout(() => { setStageIdx(i); after?.(); }, delay));
    };

    advance(1, 900);  // scanning memory
    advance(2, 1800); // ranking
    advance(3, 2600); // citations

    const start = Date.now();
    fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, context }),
    })
      .then((r) => r.json())
      .then((data: AskResponse) => {
        const show = () => {
          setStageIdx(4);
          timersRef.current.push(
            setTimeout(() => {
              if (data.needs_context && data.gaps) {
                setGaps(data.gaps);
                setPhase("context");
              } else if (data.session) {
                setSession(data.session);
                setRanked(data.ranked ?? []);
                setRelated(data.related ?? []);
                setPhase("answer");
              }
              setBusy(false);
            }, 600),
          );
        };
        // Enforce a minimum showtime so the pipeline is visible even on instant responses.
        const elapsed = Date.now() - start;
        timersRef.current.push(setTimeout(show, Math.max(0, 3200 - elapsed)));
      })
      .catch(() => setBusy(false));
  }

  function submitQuestion() {
    if (!question.trim() || busy) return;
    runPipeline();
  }

  function loadExample(exId: string) {
    const ex = EXAMPLE_BUGS.find((e) => e.id === exId);
    if (!ex || busy) return;
    setActiveExample(exId);
    setQuestion(ex.question);
    setContext(ex.context);
    setGaps([]);
    setSession(null);
    setOutcome("");
    setRetained(false);
    setPhase("question");
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

  const activeEx = EXAMPLE_BUGS.find((e) => e.id === activeExample);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="animate-fade-up">
        <h1 className="text-xl font-semibold text-stone-900">Ask Deja Fix</h1>
        <p className="mt-1 text-sm text-stone-500">
          Hindsight, stage 1: Deja Fix asks for missing context <em>before</em> diagnosing, so recalls are trustworthy — and stage 4:
          the resolved outcome gets retained for the next engineer.
        </p>
      </header>

      {/* Example bugs */}
      <section className="animate-fade-up-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Try an example bug</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLE_BUGS.map((ex) => (
            <button
              key={ex.id}
              onClick={() => loadExample(ex.id)}
              disabled={busy}
              title={`${ex.teaser} → recalls ${ex.expectedConfidence}-confidence card`}
              className={`group flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-all duration-200 disabled:opacity-50 ${
                activeExample === ex.id
                  ? "border-teal-500 bg-teal-50 shadow-sm"
                  : "border-[#e7e0d2] bg-white hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md"
              }`}
            >
              <span className="text-base transition-transform duration-200 group-hover:scale-110">{ex.emoji}</span>
              <span>
                <span className="block font-medium text-stone-700">{ex.label}</span>
                <span className="block text-[11px] text-stone-400">{ex.teaser}</span>
              </span>
            </button>
          ))}
        </div>
        {activeEx && phase === "question" && (
          <p className="mt-2 text-xs text-stone-500">
            Loaded <span className="font-medium text-teal-700">{activeEx.label}</span> — context pre-filled. Hit{" "}
            <span className="font-medium">Diagnose →</span> to watch the hindsight pipeline recall the fix.
            {activeEx.expectedConfidence === "medium" && (
              <> This one deliberately recalls at <span className="chip chip-amber mx-0.5">medium</span> confidence so you can compare.</>
            )}
          </p>
        )}
      </section>

      {phase === "question" && (
        <section className="animate-fade-up-2 space-y-3">
          <textarea
            value={question}
            onChange={(e) => { setQuestion(e.target.value); if (activeExample) setActiveExample(null); }}
            rows={4}
            placeholder="Describe the bug — or click an example above to pre-fill everything."
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
            {busy ? "Working…" : "Diagnose →"}
          </button>
        </section>
      )}

      {/* Staged pipeline animation */}
      {busy && (
        <section className="panel animate-fade-up p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <span className="inline-block h-2 w-2 animate-ping rounded-full bg-teal-500" />
            Deja Fix is working on it…
          </div>
          <ol className="mt-4 space-y-2.5">
            {STAGES.map((s, i) => {
              const state = i < stageIdx ? "done" : i === stageIdx ? "active" : "pending";
              return (
                <li key={s.key} className="flex items-center gap-3 text-sm">
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] transition-all duration-500 ${
                      state === "done"
                        ? "border-teal-500 bg-teal-500 text-white"
                        : state === "active"
                          ? "border-teal-500 text-teal-700"
                          : "border-[#e7e0d2] text-stone-300"
                    }`}
                  >
                    {state === "done" ? "✓" : i + 1}
                  </span>
                  <span className={`transition-colors duration-500 ${state === "done" ? "text-stone-400" : state === "active" ? "font-medium text-teal-800" : "text-stone-300"}`}>
                    {s.label}
                  </span>
                  {state === "active" && <span className="ml-1 inline-block h-1 w-1 animate-pulse rounded-full bg-teal-500" />}
                </li>
              );
            })}
          </ol>
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
              {activeEx && <span className="chip chip-accent ml-auto">example: {activeEx.label}</span>}
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
