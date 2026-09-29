"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RELATION_ARROW, type KnowledgeCard, type MemoryEdge, type RelationType } from "@/lib/types";

const COLOR: Record<RelationType, string> = {
  TRIGGERS: "#e11d48",
  SOLVED_BY: "#0d9488",
  CAUSED_BY: "#d97706",
  SIMILAR_TO: "#0891b2",
  SUPERSEDES: "#7c3aed",
  REQUIRES_CONTEXT: "#4f46e5",
  BLOCKS: "#f43f5e",
};

const STATUS_STROKE: Record<string, string> = {
  verified: "#0d9488",
  unverified: "#d97706",
  stale: "#ea580c",
  archived: "#a8a29e",
};

const RELATIONS = Object.keys(COLOR) as RelationType[];

interface NodeState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const VB_W = 820;
const VB_H = 560;

export default function GraphPage() {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [edges, setEdges] = useState<MemoryEdge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [activeRelations, setActiveRelations] = useState<Set<RelationType>>(new Set(RELATIONS));
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const nodesRef = useRef<Map<string, NodeState>>(new Map());
  const dragRef = useRef<{ id: string | null; panning: boolean; sx: number; sy: number; ox: number; oy: number }>({
    id: null, panning: false, sx: 0, sy: 0, ox: 0, oy: 0,
  });
  const alphaRef = useRef(1);
  const rafRef = useRef<number>(0);
  const movedRef = useRef(false);
  const [, setTick] = useState(0); // re-render on physics ticks

  useEffect(() => {
    Promise.all([
      fetch("/api/cards").then((r) => r.json()),
      fetch("/api/graph").then((r) => r.json()),
    ]).then(([c, g]) => {
      const cs: KnowledgeCard[] = c.cards ?? [];
      const es: MemoryEdge[] = g.edges ?? [];
      setCards(cs);
      setEdges(es);
      // seed positions on a circle
      const R = Math.min(VB_W, VB_H) * 0.32;
      cs.forEach((card, i) => {
        const angle = (2 * Math.PI * i) / Math.max(cs.length, 1) - Math.PI / 2;
        nodesRef.current.set(card.id, {
          id: card.id,
          x: VB_W / 2 + R * Math.cos(angle),
          y: VB_H / 2 + R * Math.sin(angle),
          vx: 0, vy: 0,
        });
      });
      alphaRef.current = 1;
    });
  }, []);

  // ─── force simulation ──────────────────────────────────────────────────────
  useEffect(() => {
    const visibleIds = new Set(cards.map((c) => c.id));
    const simEdges = edges.filter((e) => activeRelations.has(e.relation) && visibleIds.has(e.from_card) && visibleIds.has(e.to_card));

    function step() {
      const nodes = [...nodesRef.current.values()].filter((n) => visibleIds.has(n.id));
      const alpha = alphaRef.current;
      if (alpha > 0.015 || dragRef.current.id || dragRef.current.panning) {
        // repulsion (O(n²) fine for knowledge-graph scale)
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
            const d = Math.sqrt(d2);
            const f = Math.min(2400 / d2, 4) * alpha;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          }
        }
        // springs along edges
        for (const e of simEdges) {
          const a = nodesRef.current.get(e.from_card), b = nodesRef.current.get(e.to_card);
          if (!a || !b) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const rest = 165;
          const f = (d - rest) * 0.045 * alpha;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
        // gentle centering + integrate
        for (const n of nodes) {
          n.vx += (VB_W / 2 - n.x) * 0.0035 * alpha;
          n.vy += (VB_H / 2 - n.y) * 0.0035 * alpha;
          if (dragRef.current.id === n.id) { n.vx = 0; n.vy = 0; continue; }
          n.vx *= 0.82; n.vy *= 0.82;
          n.x += n.vx; n.y += n.vy;
          n.x = Math.max(40, Math.min(VB_W - 40, n.x));
          n.y = Math.max(34, Math.min(VB_H - 40, n.y));
        }
        alphaRef.current = alpha * 0.994;
        setTick((t) => t + 1);
      }
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [cards, edges, activeRelations]);

  // wake the simulation on interaction
  const wake = () => { alphaRef.current = Math.max(alphaRef.current, 0.45); };

  // ─── wheel zoom around pointer ─────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = ((ev.clientX - rect.left) / rect.width) * VB_W;
      const my = ((ev.clientY - rect.top) / rect.height) * VB_H;
      setTransform((t) => {
        const k = Math.min(3.2, Math.max(0.45, t.k * (ev.deltaY < 0 ? 1.12 : 0.89)));
        const scale = k / t.k;
        return { k, x: mx - (mx - t.x) * scale, y: my - (my - t.y) * scale };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function svgPoint(ev: { clientX: number; clientY: number }) {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const vx = ((ev.clientX - rect.left) / rect.width) * VB_W;
    const vy = ((ev.clientY - rect.top) / rect.height) * VB_H;
    return { x: (vx - transform.x) / transform.k, y: (vy - transform.y) / transform.k };
  }

  function onNodePointerDown(ev: React.PointerEvent, id: string) {
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    dragRef.current = { id, panning: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    movedRef.current = false;
    setDragging(true);
    wake();
    setSelected(id);
  }

  function onBackgroundPointerDown(ev: React.PointerEvent) {
    dragRef.current = { id: null, panning: true, sx: ev.clientX, sy: ev.clientY, ox: transform.x, oy: transform.y };
    movedRef.current = false;
    setDragging(true);
  }

  function onPointerMove(ev: React.PointerEvent) {
    const d = dragRef.current;
    if (Math.abs(ev.movementX) + Math.abs(ev.movementY) > 1) movedRef.current = true;
    if (d.id) {
      const p = svgPoint(ev);
      const n = nodesRef.current.get(d.id);
      if (n) { n.x = p.x; n.y = p.y; wake(); }
    } else if (d.panning) {
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const scaleX = VB_W / rect.width;
      setTransform((t) => ({ ...t, x: d.ox + (ev.clientX - d.sx) * scaleX, y: d.oy + (ev.clientY - d.sy) * scaleX }));
    }
  }

  function onPointerUp() {
    // A click (press + release without dragging) on empty canvas deselects.
    if (dragRef.current.panning && !movedRef.current) setSelected(null);
    dragRef.current = { id: null, panning: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    setDragging(false);
  }

  const focusId = hovered ?? selected;

  const visibleEdges = useMemo(
    () => edges.filter((e) => activeRelations.has(e.relation)),
    [edges, activeRelations],
  );

  const neighbors = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const e of visibleEdges) {
      if (e.from_card === focusId) set.add(e.to_card);
      if (e.to_card === focusId) set.add(e.from_card);
    }
    return set;
  }, [focusId, visibleEdges]);

  const selectedCard = cards.find((c) => c.id === selected);

  function zoomBy(factor: number) {
    setTransform((t) => {
      const k = Math.min(3.2, Math.max(0.45, t.k * factor));
      const scale = k / t.k;
      const cx = VB_W / 2, cy = VB_H / 2;
      return { k, x: cx - (cx - t.x) * scale, y: cy - (cy - t.y) * scale };
    });
  }

  return (
    <div className="space-y-4">
      <header className="animate-fade-up flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Memory graph</h1>
          <p className="mt-1 text-sm text-stone-500">
            Typed relationships between memories: error <span className="font-mono text-teal-700">→ TRIGGERS →</span> problem{" "}
            <span className="font-mono text-teal-700">→ SOLVED_BY →</span> fix. Drag nodes, scroll to zoom, drag the canvas to pan.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {RELATIONS.map((rel) => {
            const on = activeRelations.has(rel);
            return (
              <button
                key={rel}
                onClick={() =>
                  setActiveRelations((s) => {
                    const next = new Set(s);
                    if (next.has(rel)) { next.delete(rel); } else { next.add(rel); }
                    return next.size ? next : new Set(RELATIONS);
                  })
                }
                className={`chip cursor-pointer select-none transition-all duration-200 ${on ? "opacity-100" : "opacity-35 saturate-0"}`}
                style={on ? { borderColor: COLOR[rel] + "55", color: COLOR[rel], background: COLOR[rel] + "0f" } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: COLOR[rel] }} />
                {rel}
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={`panel relative overflow-hidden lg:col-span-2 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="h-[560px] w-full touch-none select-none"
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <defs>
              {RELATIONS.map((rel) => (
                <marker key={rel} id={`arrow-${rel}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill={COLOR[rel]} />
                </marker>
              ))}
            </defs>

            {/* soft grid backdrop */}
            <rect width={VB_W} height={VB_H} fill="url(#grid)" />
            <defs>
              <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
                <path d="M 34 0 L 0 0 0 34" fill="none" stroke="#efe9db" strokeWidth="1" />
              </pattern>
            </defs>

            <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
              {visibleEdges.map((e) => {
                const a = nodesRef.current.get(e.from_card);
                const b = nodesRef.current.get(e.to_card);
                if (!a || !b) return null;
                const highlighted = !focusId || e.from_card === focusId || e.to_card === focusId;
                // shorten line to node edge
                const dx = b.x - a.x, dy = b.y - a.y;
                const d = Math.max(Math.hypot(dx, dy), 1);
                const r = 20;
                const ax = a.x + (dx / d) * r, ay = a.y + (dy / d) * r;
                const bx = b.x - (dx / d) * (r + 8), by = b.y - (dy / d) * (r + 8);
                return (
                  <g key={e.id} className="transition-opacity duration-300" opacity={highlighted ? 1 : 0.12}>
                    <line
                      x1={ax} y1={ay} x2={bx} y2={by}
                      stroke={COLOR[e.relation as RelationType]}
                      strokeWidth={highlighted ? 2 : 1.2}
                      markerEnd={`url(#arrow-${e.relation})`}
                    />
                    {highlighted && (
                      <text
                        x={(ax + bx) / 2} y={(ay + by) / 2 - 5}
                        textAnchor="middle"
                        fontSize={9.5}
                        fontWeight={600}
                        fill={COLOR[e.relation as RelationType]}
                        stroke="#fffdf8"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {e.relation}
                      </text>
                    )}
                  </g>
                );
              })}

              {cards.map((c) => {
                const n = nodesRef.current.get(c.id);
                if (!n) return null;
                const isFocus = c.id === focusId;
                const dimmed = neighbors ? !neighbors.has(c.id) : false;
                const r = 16 + Math.min(c.vote_score, 40) * 0.25;
                return (
                  <g
                    key={c.id}
                    transform={`translate(${n.x},${n.y})`}
                    className="cursor-pointer transition-opacity duration-300"
                    opacity={dimmed ? 0.18 : 1}
                    onPointerDown={(ev) => onNodePointerDown(ev, c.id)}
                    onPointerEnter={() => setHovered(c.id)}
                    onPointerLeave={() => setHovered(null)}
                    style={{ transition: dragging ? "none" : undefined }}
                  >
                    <circle r={r + 5} fill="#fff" opacity={isFocus ? 0.9 : 0} className="transition-opacity duration-200" />
                    <circle
                      r={r}
                      fill="#fffdf8"
                      stroke={STATUS_STROKE[c.status] ?? "#a8a29e"}
                      strokeWidth={isFocus ? 3 : 2}
                      className="transition-all duration-200"
                    />
                    <text y={4} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#44403c">
                      {c.service.split("-")[0].slice(0, 8)}
                    </text>
                    <text
                      y={r + 15}
                      textAnchor="middle"
                      fontSize={10}
                      fill={isFocus ? "#292524" : "#78716c"}
                      fontWeight={isFocus ? 600 : 400}
                      stroke="#faf7f2"
                      strokeWidth={3.5}
                      paintOrder="stroke"
                    >
                      {c.title.length > 30 ? c.title.slice(0, 28) + "…" : c.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* zoom controls */}
          <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
            <button onClick={() => zoomBy(1.25)} className="btn btn-ghost btn-xs h-8 w-8 !px-0 text-base" title="Zoom in">+</button>
            <button onClick={() => zoomBy(0.8)} className="btn btn-ghost btn-xs h-8 w-8 !px-0 text-base" title="Zoom out">−</button>
            <button
              onClick={() => { setTransform({ x: 0, y: 0, k: 1 }); wake(); }}
              className="btn btn-ghost btn-xs h-8 w-8 !px-0 text-xs"
              title="Reset view"
            >
              ⌂
            </button>
          </div>
          <span className="chip absolute left-3 top-3 bg-white/85 backdrop-blur">
            {cards.length} cards · {visibleEdges.length} edges · zoom {Math.round(transform.k * 100)}%
          </span>
        </div>

        <aside className="space-y-3">
          {selectedCard ? (
            <div className="panel animate-fade-up p-4">
              <div className="flex items-center gap-2">
                <span className={`chip ${selectedCard.status === "verified" ? "chip-accent" : selectedCard.status === "stale" ? "" : "chip-amber"}`}>
                  {selectedCard.status}
                </span>
                <span className="chip font-mono">{selectedCard.service}</span>
              </div>
              <h2 className="mt-2 font-medium text-stone-800">{selectedCard.title}</h2>
              <p className="mt-2 text-sm text-stone-500">{selectedCard.problem}</p>
              <p className="mt-2 text-sm text-teal-800">Fix: {selectedCard.fix}</p>
              <div className="mt-3 flex gap-2">
                <Link href={`/cards/${selectedCard.id}`} className="btn btn-primary btn-xs">Open card →</Link>
                <button onClick={() => setSelected(null)} className="btn btn-ghost btn-xs">Unselect</button>
              </div>
            </div>
          ) : (
            <p className="panel p-4 text-sm text-stone-400">
              Click a node to inspect its card. Hover to trace its typed relationships.
            </p>
          )}

          <div className="panel p-4 text-xs text-stone-500">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">Edge vocabulary</h2>
            <ul className="mt-2 space-y-1">
              {RELATIONS.map((rel) => (
                <li key={rel}>
                  <span className="font-mono" style={{ color: COLOR[rel] }}>{RELATION_ARROW[rel]}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2">Edges are first-class rows in <code className="font-mono">memory_edges</code> with notes and authors.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
