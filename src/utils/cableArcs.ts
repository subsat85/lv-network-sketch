import { CableArcElement, CableArcEnd, CableElement, DrawingElement, Point } from '../types/drawing';
import { calculateCablePath } from './cableLayout';
import { pairKey, pathSegmentSpans } from './cableSegments';

// Cable arcs: a link drawn at a pole between two cable connection points.
//
// A connection point is (cable, side, occurrence) at a pole — see CableArcEnd.
// Nothing here changes cable geometry: the on-screen position of a connection
// point is read from the cable's drawn path (where its span towards the
// neighbouring pole meets the pole's circle), so it follows pole moves and
// cable re-layout, and is recomputed on every render.

export interface ConnectionPoint {
  end: CableArcEnd;
  cableId: string;
  towardId: string;     // the neighbouring pole on that side (for display only)
  color: string;        // the cable's colour
  position: Point;      // where the cable meets the pole circle
  angle: number;        // clockwise from north, radians [0, 2π)
  number: number;       // 1-based, for this pole, in angle order
}

export const sameEnd = (a: CableArcEnd, b: CableArcEnd) =>
  a.cableId === b.cableId && a.side === b.side && a.occurrence === b.occurrence;

const isCable = (e: DrawingElement | undefined): e is CableElement => !!e && e.type === 'cable';
const isArc = (e: DrawingElement): e is CableArcElement => e.type === 'cable_arc';

/** Index in poleIds of the given visit of the pole, or -1. */
const occurrenceIndex = (cable: CableElement, poleId: string, occurrence: number) => {
  let seen = 0;
  for (let i = 0; i < cable.poleIds.length; i++) {
    if (cable.poleIds[i] !== poleId) continue;
    if (seen === occurrence) return i;
    seen++;
  }
  return -1;
};

/** The neighbouring pole id of an end, or null if the end does not exist (any more). */
export const resolveEnd = (elements: DrawingElement[], poleId: string, end: CableArcEnd | undefined): { cable: CableElement; towardId: string } | null => {
  if (!end || typeof end.cableId !== 'string' || (end.side !== 'prev' && end.side !== 'next') || !Number.isInteger(end.occurrence) || end.occurrence < 0) return null;
  const cable = elements.find((e) => e.id === end.cableId);
  if (!isCable(cable)) return null;
  const i = occurrenceIndex(cable, poleId, end.occurrence);
  if (i < 0) return null;
  const j = end.side === 'prev' ? i - 1 : i + 1;
  if (j < 0 || j >= cable.poleIds.length) return null;
  const towardId = cable.poleIds[j];
  if (towardId === poleId) return null;
  const toward = elements.find((e) => e.id === towardId);
  const pole = elements.find((e) => e.id === poleId);
  if (!toward || toward.type !== 'symbol' || !pole || pole.type !== 'symbol') return null;
  return { cable, towardId };
};

const norm = (v: Point) => { const l = Math.hypot(v.x, v.y); return l < 1e-9 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }; };

/**
 * Where the cable meets the pole circle on that side: the drawn run of the span
 * (pole → neighbour) intersected with the circle of radius r around the pole.
 */
export const endPosition = (elements: DrawingElement[], poleId: string, end: CableArcEnd, radius: number): Point | null => {
  const r = resolveEnd(elements, poleId, end);
  if (!r) return null;
  const pole = elements.find((e) => e.id === poleId)!;
  const toward = elements.find((e) => e.id === r.towardId)!;
  const P = { x: pole.x, y: pole.y };
  const dirToT = norm({ x: toward.x - P.x, y: toward.y - P.y });
  // the longest drawn piece of this span is its main run (offset parallel to the span)
  const path = calculateCablePath(r.cable, elements);
  const spans = pathSegmentSpans(r.cable, elements, path);
  const key = pairKey(poleId, r.towardId);
  let a: Point | null = null, b: Point | null = null, best = -1;
  spans.forEach((s, i) => {
    if (!s || s.key !== key) return;
    const len = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    if (len > best) { best = len; a = path[i]; b = path[i + 1]; }
  });
  let u = dirToT, F = P;
  if (a && b) {
    const A = a as Point, B = b as Point;
    u = norm({ x: B.x - A.x, y: B.y - A.y });
    if (u.x * dirToT.x + u.y * dirToT.y < 0) u = { x: -u.x, y: -u.y };
    const t = (P.x - A.x) * u.x + (P.y - A.y) * u.y;
    F = { x: A.x + u.x * t, y: A.y + u.y * t }; // foot of the pole centre on the run
  }
  const h = Math.hypot(F.x - P.x, F.y - P.y);
  const along = h < radius ? Math.sqrt(radius * radius - h * h) : 0;
  return { x: F.x + u.x * along, y: F.y + u.y * along };
};

/** Every cable connection point at a pole, numbered 1..n clockwise from north. */
export const listConnectionPoints = (elements: DrawingElement[], poleId: string, radius: number): ConnectionPoint[] => {
  const pole = elements.find((e) => e.id === poleId);
  if (!pole || pole.type !== 'symbol') return [];
  const out: Omit<ConnectionPoint, 'number'>[] = [];
  const cables = elements.filter(isCable);
  cables.forEach((cable) => {
    let occurrence = 0;
    cable.poleIds.forEach((id) => {
      if (id !== poleId) return;
      for (const side of ['prev', 'next'] as const) {
        const end = { cableId: cable.id, side, occurrence };
        const r = resolveEnd(elements, poleId, end);
        const position = r && endPosition(elements, poleId, end, radius);
        if (!r || !position) continue;
        const ang = Math.atan2(position.x - pole.x, -(position.y - pole.y));
        out.push({ end, cableId: cable.id, towardId: r.towardId, color: cable.strokeColor, position, angle: (ang + 2 * Math.PI) % (2 * Math.PI) });
      }
      occurrence++;
    });
  });
  const order = new Map(cables.map((c, i) => [c.id, i]));
  out.sort((p, q) => (p.angle - q.angle) || (order.get(p.cableId)! - order.get(q.cableId)!) || p.end.side.localeCompare(q.end.side) || p.end.occurrence - q.end.occurrence);
  return out.map((p, i) => ({ ...p, number: i + 1 }));
};

export const isArcValid = (elements: DrawingElement[], arc: CableArcElement) =>
  !!arc && typeof arc.poleId === 'string'
  && !!resolveEnd(elements, arc.poleId, arc.from)
  && !!resolveEnd(elements, arc.poleId, arc.to)
  && !sameEnd(arc.from, arc.to);

/** Drop arcs whose pole, cable or connection side no longer exists (never re-links them). */
export const pruneInvalidArcs = (elements: DrawingElement[]): DrawingElement[] => {
  if (!elements.some(isArc)) return elements;
  const kept = elements.filter((e) => !isArc(e) || isArcValid(elements, e));
  return kept.length === elements.length ? elements : kept;
};

export type CreateArcResult = { ok: true; arc: CableArcElement } | { ok: false; reason: 'same-point' | 'invalid' | 'duplicate' };

/** A new arc between two connection points of a pole; colour = the first point's cable. */
export const createArc = (elements: DrawingElement[], poleId: string, from: CableArcEnd, to: CableArcEnd, id: string): CreateArcResult => {
  if (sameEnd(from, to)) return { ok: false, reason: 'same-point' };
  const a = resolveEnd(elements, poleId, from);
  if (!a || !resolveEnd(elements, poleId, to)) return { ok: false, reason: 'invalid' };
  const dup = elements.some((e) => isArc(e) && e.poleId === poleId
    && ((sameEnd(e.from, from) && sameEnd(e.to, to)) || (sameEnd(e.from, to) && sameEnd(e.to, from))));
  if (dup) return { ok: false, reason: 'duplicate' };
  return {
    ok: true,
    arc: { id, type: 'cable_arc', poleId, from: { ...from }, to: { ...to }, x: 0, y: 0, strokeColor: a.cable.strokeColor, fillColor: 'none', strokeWidth: a.cable.strokeWidth || 2 },
  };
};

/**
 * Jumper (cable_arc) geometry.
 *
 * Each end of a jumper sits ON its cable's drawn run, outside the pole: where
 * the run crosses a circle concentric with the pole whose radius is the pole
 * radius plus a clearance (JUMPER_CLEARANCE × pole radius). Both ends are on
 * that circle, and the jumper is the arc of that circle between them, so it
 * runs parallel to the pole outline and keeps a visible gap from it everywhere,
 * including at the ends. A dot marks each end. The cable connection points on
 * the pole circle are not moved.
 *
 * The arc goes the short way round. Ends that are almost opposite go round the
 * side that needs the lower ring (ties: a side fixed by the end identities, not
 * by which end was picked first). Jumpers on the same pole whose arcs would
 * overlap go on successive rings, JUMPER_RING_STEP × pole radius apart; jumpers
 * that do not overlap share the innermost ring, so outer arcs do not keep growing.
 */
export const JUMPER_CLEARANCE = 0.5;    // gap between pole outline and jumper ring, × pole radius
export const JUMPER_RING_STEP = 0.3;    // spacing between rings of overlapping jumpers, × pole radius
export const JUMPER_DOT = 0.16;         // end-dot radius, × pole radius
export const ARC_SAMPLES = 48;

interface JumperLayout { delta: number; ring: number; swapped: boolean }

const TAU = 2 * Math.PI;
const mod = (v: number) => ((v % TAU) + TAU) % TAU;
const wrap = (v: number) => { let d = v; while (d <= -Math.PI) d += TAU; while (d > Math.PI) d -= TAU; return d; };
const endKey = (e: CableArcEnd) => `${e.cableId}|${e.side}|${e.occurrence}`;
/** Angular ranges on a circle as (start, length ≥ 0); true if they overlap or nearly touch. */
const rangesOverlap = (s1: number, l1: number, s2: number, l2: number, margin = 0.08) =>
  mod(s2 - s1) < l1 + margin || mod(s1 - s2) < l2 + margin;

export const jumperRadius = (radius: number, ring: number) => radius * (1 + JUMPER_CLEARANCE + JUMPER_RING_STEP * ring);

/** Canonical (pick-order independent) ends of a jumper at a given ring radius. */
const canonicalEnds = (elements: DrawingElement[], arc: CableArcElement, rr: number) => {
  const swapped = endKey(arc.from) > endKey(arc.to);
  const pa = endPosition(elements, arc.poleId, arc.from, rr);
  const pb = endPosition(elements, arc.poleId, arc.to, rr);
  if (!pa || !pb) return null;
  return { swapped, p: swapped ? pb : pa, q: swapped ? pa : pb };
};

/** Ring and turning direction for every jumper of a pole (in element order). */
const layoutJumpers = (elements: DrawingElement[], poleId: string, radius: number): Map<string, JumperLayout> => {
  const out = new Map<string, JumperLayout>();
  const pole = elements.find((e) => e.id === poleId);
  if (!pole) return out;
  const rings: [number, number][][] = [];
  const ringFor = (st: number, len: number) => {
    let k = 0;
    while (rings[k] && rings[k].some(([s2, l2]) => rangesOverlap(st, len, s2, l2))) k++;
    return k;
  };
  const r0 = jumperRadius(radius, 0);
  for (const arc of elements) {
    if (!isArc(arc) || arc.poleId !== poleId) continue;
    const ends = canonicalEnds(elements, arc, r0);
    if (!ends) continue;
    const thP = Math.atan2(ends.p.y - pole.y, ends.p.x - pole.x);
    const delta = wrap(Math.atan2(ends.q.y - pole.y, ends.q.x - pole.x) - thP);
    const candidates = Math.abs(delta) > Math.PI - 0.15 ? [Math.abs(delta), -Math.abs(delta)] : [delta];
    let best: { d: number; ring: number } | null = null;
    for (const d of candidates) {
      const ring = ringFor(d >= 0 ? thP : thP + d, Math.abs(d));
      if (!best || ring < best.ring) best = { d, ring };
    }
    const { d, ring } = best!;
    (rings[ring] ??= []).push([d >= 0 ? thP : thP + d, Math.abs(d)]);
    out.set(arc.id, { delta: d, ring, swapped: ends.swapped });
  }
  return out;
};

export interface JumperGeometry {
  d: string;          // SVG path (one circular arc)
  a: Point; b: Point; // cable connection points of `from` / `to` (on the pole circle)
  start: Point;       // drawn end at `from` (on that cable, outside the pole)
  end: Point;         // drawn end at `to`
  apex: Point;        // middle of the arc
  points: Point[];    // samples along the arc, from `start` to `end`
  ringRadius: number;
  center: Point;      // pole centre (centre of the arc)
  dotRadius: number;  // end dots
}

/** Drawn geometry of a jumper — used by the canvas, the share preview and the PDF. */
export const arcGeometry = (elements: DrawingElement[], arc: CableArcElement, radius: number): JumperGeometry | null => {
  const pole = elements.find((e) => e.id === arc.poleId);
  if (!pole) return null;
  const a = endPosition(elements, arc.poleId, arc.from, radius);
  const b = endPosition(elements, arc.poleId, arc.to, radius);
  if (!a || !b) return null;
  // a jumper that is not (yet) in the drawing is laid out as if it were the last one
  const all = elements.some((e) => e.id === arc.id) ? elements : [...elements, arc];
  const lay = layoutJumpers(all, arc.poleId, radius).get(arc.id);
  if (!lay) return null;
  const C = { x: pole.x, y: pole.y };
  const rr = jumperRadius(radius, lay.ring);
  const ends = canonicalEnds(all, arc, rr)!;
  const thP = Math.atan2(ends.p.y - C.y, ends.p.x - C.x);
  let delta = wrap(Math.atan2(ends.q.y - C.y, ends.q.x - C.x) - thP);
  // keep the side chosen by the layout (matters only for almost-opposite ends)
  if (Math.sign(delta) !== Math.sign(lay.delta) && Math.abs(delta) > Math.PI / 2) delta += delta > 0 ? -TAU : TAU;
  let points: Point[] = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const th = thP + (delta * i) / ARC_SAMPLES;
    points.push(i === 0 ? ends.p : i === ARC_SAMPLES ? ends.q : { x: C.x + rr * Math.cos(th), y: C.y + rr * Math.sin(th) });
  }
  if (lay.swapped) points = points.reverse(); // draw from `from` to `to`
  const start = points[0], end = points[ARC_SAMPLES];
  // two arc commands meeting at the middle: each half is under a half circle, so the
  // SVG arc is well defined even when the ends are exactly opposite
  const apex = points[ARC_SAMPLES / 2];
  const sweep = (delta >= 0) !== lay.swapped ? 1 : 0;
  const f = (v: number) => Math.round(v * 100) / 100;
  const arcTo = (p: Point) => `A ${f(rr)} ${f(rr)} 0 0 ${sweep} ${f(p.x)} ${f(p.y)}`;
  const d = `M ${f(start.x)} ${f(start.y)} ${arcTo(apex)} ${arcTo(end)}`;
  return { d, a, b, start, end, apex, points, ringRadius: rr, center: C, dotRadius: radius * JUMPER_DOT };
};

// ---- picking two points (pure state machine used by the canvas) ----
export type ArcPickState = { poleId: string; first: CableArcEnd | null } | null;
export type ArcPickAction =
  | { type: 'start'; poleId: string }
  | { type: 'pick'; end: CableArcEnd }
  | { type: 'cancel' };
export type ArcPickResult = { state: ArcPickState; create?: { from: CableArcEnd; to: CableArcEnd } };

export const arcPick = (state: ArcPickState, action: ArcPickAction): ArcPickResult => {
  switch (action.type) {
    case 'start': return { state: { poleId: action.poleId, first: null } };
    case 'cancel': return { state: null };
    case 'pick': {
      if (!state) return { state };
      if (!state.first) return { state: { ...state, first: action.end } };
      if (sameEnd(state.first, action.end)) return { state: { ...state, first: null } }; // tap first again = deselect
      return { state: { ...state, first: null }, create: { from: state.first, to: action.end } };
    }
  }
};
