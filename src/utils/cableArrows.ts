import type { CableElement, DrawingElement, Point } from '../types/drawing';

// The cable start / end arrowhead (cable.arrowMode) and the «نقطة فصل مقترحة»
// (suggested split point) mark, which draws that same arrowhead in red.
//
// The geometry below is the one SketchCanvas and PreviewCanvas used inline for
// arrowMode, moved here unchanged so both marks share it: the arrow sits where
// the cable path meets the pole's circle and points into the pole.

export const getCircleSegmentIntersection = (p1: Point, p2: Point, center: Point, r: number): Point | null => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = (fx * fx + fy * fy) - r * r;
  let delta = b * b - 4 * a * c;
  if (delta < 0) return null;
  delta = Math.sqrt(delta);
  const t1 = (-b - delta) / (2 * a);
  const t2 = (-b + delta) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return { x: p1.x + t1 * dx, y: p1.y + t1 * dy };
  if (t2 >= 0 && t2 <= 1) return { x: p1.x + t2 * dx, y: p1.y + t2 * dy };
  return null;
};

export interface ArrowPlacement { pos: Point; angle: number }

/**
 * Walks `tracePoints` outward from the pole (the first point is at / inside the pole)
 * and returns the first place the path crosses the pole's circle, with the angle of
 * an arrow pointing back into the pole.
 */
export const arrowIntoPole = (tracePoints: Point[], center: Point, radius: number): ArrowPlacement | null => {
  for (let i = 0; i < tracePoints.length - 1; i++) {
    const p1 = tracePoints[i]; // Inner point
    const p2 = tracePoints[i + 1]; // Outer point
    const intersection = getCircleSegmentIntersection(p1, p2, center, radius);
    if (intersection) {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      // Vector p1->p2 is Outward. Arrow points Inward (Towards Pole).
      return { pos: intersection, angle: Math.atan2(dy, dx) * 180 / Math.PI + 180 };
    }
  }
  return null;
};

/** The arrowMode arrow (start or end of the cable): exactly the previous rule. */
export const cableEndArrow = (cable: CableElement, path: Point[], elements: DrawingElement[], radius: number): ArrowPlacement | null => {
  if (!cable.arrowMode || cable.arrowMode === 'none') return null;
  const isStart = cable.arrowMode === 'start';
  const poleId = isStart ? cable.poleIds[0] : cable.poleIds[cable.poleIds.length - 1];
  const pole = elements.find((e) => e.id === poleId);
  if (!pole) return null;
  return arrowIntoPole(isStart ? path : [...path].reverse(), { x: pole.x, y: pole.y }, radius);
};

// ---------- suggested split point ----------

/** Colour of the suggested split mark: the drawing's red for proposals (as «Proposed Pole»). */
export const SUGGESTED_SPLIT_COLOR = 'red';

/**
 * Arrowheads of the suggested split marks of one cable. A mark is bound to the cable
 * and to one of its poles (cable.suggestedSplits holds pole ids):
 * - at the first / last pole: one arrow, placed exactly like the start / end arrow;
 * - at a pole in the middle: one arrow on each side (the span before and the span after),
 *   both pointing into the pole — the cable would be split there.
 * A pole that is no longer on the cable shows nothing.
 */
export const suggestedSplitArrows = (cable: CableElement, path: Point[], elements: DrawingElement[], radius: number): (ArrowPlacement & { key: string })[] => {
  const ids = cable.suggestedSplits;
  if (!ids?.length || path.length < 2) return [];
  const out: (ArrowPlacement & { key: string })[] = [];
  const n = cable.poleIds.length;
  for (const poleId of new Set(ids)) {
    const pole = elements.find((e) => e.id === poleId);
    if (!pole) continue;
    const center = { x: pole.x, y: pole.y };
    cable.poleIds.forEach((id, i) => {
      if (id !== poleId) return;
      if (i === 0 || i === n - 1) {
        // an end of the cable: the same place as the start / end arrow
        const a = arrowIntoPole(i === 0 ? path : [...path].reverse(), center, radius);
        if (a) out.push({ ...a, key: `${poleId}:${i}:${i === 0 ? 'start' : 'end'}` });
        return;
      }
      // a pole the cable passes: split the path at its point closest to the pole and
      // walk outward on each side (towards the previous pole and towards the next one)
      let k = 0, best = Infinity;
      path.forEach((p, j) => { const d = (p.x - center.x) ** 2 + (p.y - center.y) ** 2; if (d < best) { best = d; k = j; } });
      const before = arrowIntoPole(path.slice(0, k + 1).reverse(), center, radius);
      const after = arrowIntoPole(path.slice(k), center, radius);
      if (before) out.push({ ...before, key: `${poleId}:${i}:before` });
      if (after) out.push({ ...after, key: `${poleId}:${i}:after` });
    });
  }
  return out;
};

/** The cable with the suggested split mark at `poleId` added or removed (only for a pole of that cable). */
export const toggleSuggestedSplit = (cable: CableElement, poleId: string): Partial<CableElement> | null => {
  if (!cable.poleIds.includes(poleId)) return null;
  const cur = cable.suggestedSplits ?? [];
  const next = cur.includes(poleId) ? cur.filter((id) => id !== poleId) : [...cur, poleId];
  return { suggestedSplits: next.length ? next : undefined };
};

/** Marks stay only on poles that are still on the cable (after a pole is deleted or the cable is rerouted). */
export const pruneSuggestedSplits = (cable: CableElement): CableElement => {
  const ids = cable.suggestedSplits;
  if (!ids) return cable;
  const kept = ids.filter((id, i) => cable.poleIds.includes(id) && ids.indexOf(id) === i);
  if (kept.length === ids.length) return cable;
  return { ...cable, suggestedSplits: kept.length ? kept : undefined };
};
