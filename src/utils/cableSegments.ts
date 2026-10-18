import { CableElement, DrawingElement, Point } from '../types/drawing';
import { calculateCablePath } from './cableLayout';

// Which pole-to-pole span a drawn piece of a cable belongs to.
//
// The drawn path (calculateCablePath) is not one point per pole: it contains the
// pole centres, the offset start/end of every span, the short joins between
// spans, and transformer edge points — and transformer cables skip some of
// those. So a path-segment index cannot be used as a pole index. Instead each
// drawn segment is assigned to the pole span (pole i → pole i+1, in the cable's
// own order) that its midpoint lies closest to. This only reads the geometry;
// cable layout itself is unchanged.

const distToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

export const pairKey = (a: string, b: string) => [a, b].sort().join('_');

export interface SpanRef { index: number; fromId: string; toId: string; key: string }

// The poles the drawn path is built from (missing ids are skipped, as in calculateCablePath).
const cablePoles = (cable: CableElement, elements: DrawingElement[]) =>
  cable.poleIds.map((id) => elements.find((e) => e.id === id)).filter((e): e is DrawingElement => !!e);

/** Span nearest to a point, or null for a cable with fewer than two poles. */
export const nearestSpan = (cable: CableElement, elements: DrawingElement[], p: Point): SpanRef | null => {
  const poles = cablePoles(cable, elements);
  let best: SpanRef | null = null;
  let bestD = Infinity;
  for (let i = 0; i < poles.length - 1; i++) {
    const d = distToSegment(p, poles[i], poles[i + 1]);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = { index: i, fromId: poles[i].id, toId: poles[i + 1].id, key: pairKey(poles[i].id, poles[i + 1].id) };
    }
  }
  return best;
};

/** For every drawn segment of the cable path: the span it belongs to (null for zero-length pieces). */
export const pathSegmentSpans = (cable: CableElement, elements: DrawingElement[], path: Point[] = calculateCablePath(cable, elements)): (SpanRef | null)[] => {
  const out: (SpanRef | null)[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) { out.push(null); continue; }
    out.push(nearestSpan(cable, elements, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  }
  return out;
};
