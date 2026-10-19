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
 * SVG path of a jumper (cable arc).
 *
 * The curve is built in polar coordinates around the pole centre: its angle
 * runs from one connection point to the other (the short way round), and its
 * distance from the centre is the pole radius plus a positive bump that is
 * zero only at the two ends. So every point between the ends lies strictly
 * outside the pole circle, for any angle between the ends and for either end
 * order. (The previous quadratic curve dipped inside the circle whenever the
 * ends were far apart, e.g. both sides of a cable passing through.)
 * Jumpers on the same pole get increasing heights so they stay apart; ends
 * that are almost opposite go round one side, alternating per jumper, chosen
 * independently of which end was picked first.
 */
export const ARC_SAMPLES = 24;
export const arcGeometry = (elements: DrawingElement[], arc: CableArcElement, radius: number): { d: string; a: Point; b: Point; apex: Point; points: Point[] } | null => {
  const pole = elements.find((e) => e.id === arc.poleId);
  if (!pole) return null;
  const a = endPosition(elements, arc.poleId, arc.from, radius);
  const b = endPosition(elements, arc.poleId, arc.to, radius);
  if (!a || !b) return null;
  const P = { x: pole.x, y: pole.y };
  const siblings = elements.filter((e): e is CableArcElement => isArc(e) && e.poleId === arc.poleId);
  const index = Math.max(0, siblings.findIndex((e) => e.id === arc.id));

  const thA = Math.atan2(a.y - P.y, a.x - P.x);
  const thB = Math.atan2(b.y - P.y, b.x - P.x);
  let delta = thB - thA;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  if (Math.abs(delta) > Math.PI - 0.15) {
    // (almost) opposite ends: pick a side that does not depend on the end order
    const key = (e: CableArcEnd) => `${e.cableId}|${e.side}|${e.occurrence}`;
    const swapped = key(arc.from) > key(arc.to);
    const side = (index % 2 === 0 ? 1 : -1) * (swapped ? -1 : 1);
    delta = side * Math.abs(delta);
  }
  const rA = Math.hypot(a.x - P.x, a.y - P.y);
  const rB = Math.hypot(b.x - P.x, b.y - P.y);
  const height = radius * (0.6 + 0.45 * index);
  const points: Point[] = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES;
    if (i === 0) { points.push(a); continue; }
    if (i === ARC_SAMPLES) { points.push(b); continue; }
    const base = Math.max(radius, rA + (rB - rA) * t); // never below the circle
    const r = base + height * Math.sin(Math.PI * t);
    const th = thA + delta * t;
    points.push({ x: P.x + r * Math.cos(th), y: P.y + r * Math.sin(th) });
  }
  const f = (v: number) => Math.round(v * 100) / 100;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${f(p.x)} ${f(p.y)}`).join(' ');
  return { d, a, b, apex: points[ARC_SAMPLES / 2], points };
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
