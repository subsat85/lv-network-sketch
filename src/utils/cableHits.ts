import type { CableElement, DrawingElement, Point } from '../types/drawing';
import { calculateCablePath } from './cableLayout';
import { pathSegmentSpans, type SpanRef } from './cableSegments';
import { poleNamer } from './poleNames';

// Which cables a touch could mean (a view-only helper: it reads the drawn geometry and
// changes nothing). Uses the same drawn path and span assignment as the canvas
// (calculateCablePath + pathSegmentSpans), so the span reported for a cable is the one
// its own hit area would give at that point.

export interface CableHit {
  cableId: string;
  /** distance from the point to the cable's drawn path (world units) */
  distance: number;
  /** the pole span of the nearest drawn piece (null when it maps to none) */
  span: SpanRef | null;
}

const distToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * Cables whose drawn path passes within `radius` of `p` (world units), nearest first
 * (ties: the one drawn on top first). `include`: a cable to list whatever its distance
 * (the one whose hit area received the touch).
 */
export const cablesNear = (elements: DrawingElement[], p: Point, radius: number, include?: string): CableHit[] => {
  const poles = new Map<string, DrawingElement>();
  for (const e of elements) if (e.type === 'symbol') poles.set(e.id, e);
  const out: (CableHit & { order: number })[] = [];
  elements.forEach((e, order) => {
    if (e.type !== 'cable') return;
    const c = e as CableElement;
    // cheap reject: far from every pole's box (offsets and transformer edges stay within this margin)
    const pts = c.poleIds.map((id) => poles.get(id)).filter(Boolean) as DrawingElement[];
    if (!pts.length) return;
    const margin = radius + 80 + Math.abs(c.offset || 0);
    const minX = Math.min(...pts.map((q) => q.x)) - margin, maxX = Math.max(...pts.map((q) => q.x)) + margin;
    const minY = Math.min(...pts.map((q) => q.y)) - margin, maxY = Math.max(...pts.map((q) => q.y)) + margin;
    if (c.id !== include && (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY)) return;
    const path = calculateCablePath(c, elements);
    if (path.length < 2) return;
    const spans = pathSegmentSpans(c, elements, path);
    let best = Infinity, bestI = -1;
    for (let i = 0; i < path.length - 1; i++) {
      const d = distToSegment(p, path[i], path[i + 1]);
      if (d < best - 1e-9) { best = d; bestI = i; }
    }
    if (best <= radius || c.id === include) out.push({ cableId: c.id, distance: best, span: spans[bestI] ?? null, order });
  });
  return out.sort((a, b) => a.distance - b.distance || b.order - a.order).map(({ order: _o, ...h }) => h);
};

/** A touch is ambiguous when more than one cable lies within reach of it. */
export const isAmbiguous = (hits: CableHit[]) => hits.length > 1;

export interface CableChoice {
  cableId: string;
  color: string;
  /** first and last pole of the cable */
  ends: string;
  /** number of spans, as text */
  spans: string;
  /** the span under the touch, as text (or null) */
  spanHere: string | null;
  span: SpanRef | null;
  /** extra text when two rows would otherwise read the same (cable number in drawing order) */
  extra: string | null;
}

const spansText = (n: number) => (n === 1 ? 'مقطع واحد' : n === 2 ? 'مقطعان' : `${n} مقاطع`);

/** Rows of the picker: what is really known about each cable, made distinct when needed. */
export const cableChoices = (elements: DrawingElement[], hits: CableHit[]): CableChoice[] => {
  const name = poleNamer(elements);
  const cables = elements.filter((e): e is CableElement => e.type === 'cable');
  const number = new Map(cables.map((c, i) => [c.id, i + 1]));
  const rows = hits.map((h) => {
    const c = cables.find((x) => x.id === h.cableId)!;
    const n = Math.max(0, c.poleIds.length - 1);
    return {
      cableId: c.id,
      color: c.strokeColor || '#000000',
      ends: c.poleIds.length ? `${name(c.poleIds[0])} ← ${name(c.poleIds[c.poleIds.length - 1])}` : 'بدون أعمدة',
      spans: spansText(n),
      spanHere: h.span ? `${name(h.span.fromId)} ← ${name(h.span.toId)}` : null,
      span: h.span,
      extra: null as string | null,
    };
  });
  const sig = (r: CableChoice) => `${r.color.trim().toLowerCase()}|${r.ends}|${r.spans}|${r.spanHere}`;
  const count = new Map<string, number>();
  for (const r of rows) count.set(sig(r), (count.get(sig(r)) ?? 0) + 1);
  for (const r of rows) if ((count.get(sig(r)) ?? 0) > 1) r.extra = `كيبل رقم ${number.get(r.cableId)}`;
  return rows;
};
