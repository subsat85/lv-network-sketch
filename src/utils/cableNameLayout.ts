import type { CableElement, DrawingElement, Point, SpanProps } from '../types/drawing';
import { cableOffsetLines } from './cableLayout';
import { spanCableTypeProblem } from './cableTypeModel';
import { spanAt } from './spanModel';
import {
  addCircle, addPoleTagObstacles, addRect, addSegment, distanceLabelPositions, drawingObstacles, segmentCost, textWidth,
  type LayoutContext, type Rect,
} from './overlayLayout';

// The conductor size of the library cable linked to a span («3×120»), written beside the span
// (visual only).
//
// The text is the size read from the name in the span's own snapshot (the exact revision it was
// linked to), at display time (cableSizeOf): the name, the snapshot and the library are not changed,
// nothing is looked up in the library, nothing is invented. A span without a valid link, or whose cable
// name has no size that can be read with confidence, has no label.
// The label is drawn along the span (turned so it reads left to right), on the side away from the
// distance number, joined to the cable by a short leader. Where it goes is chosen like the other
// labels of the drawing (overlayLayout.ts): fixed candidate positions in order, the first that covers
// nothing (poles, cables, arrowheads, subscribers and their labels, distance numbers, pole numbers,
// proposal boxes, labels placed before), else the one that covers least. Deterministic; the same
// drawing gives the same places (they change with the zoom only in the layout's 2 % steps).

export interface CableNameLabel {
  /** the span (cableId#index) */
  key: string;
  cableId: string;
  index: number;
  text: string;
  color: string;
  /** centre of the text, its angle (degrees, −90…90) and font size (world units) */
  x: number; y: number; angle: number; fontSize: number;
  /** the leader: from the label's edge to the cable */
  leader: { from: Point; to: Point };
  /** the label as an obstacle (centre line and half height) for the marks placed after it */
  a: Point; b: Point; half: number;
  /** weighted overlap left (0 = none) */
  cost: number;
}

/**
 * The conductor size written in a cable name: the FIRST «count × section» in it — 1 to 9 conductors,
 * a section of 1 to 4 digits (with an optional decimal, «2.5» / «2,5»), «x», «X» or «×» between them,
 * spaces allowed around the sign — shown as written without the spaces («3×120», «3x70»). Only the
 * part before «+» is shown (the neutral / extra conductors are not). The pattern must stand on its own:
 * not inside a longer number or word (a section may be followed by «mm», «mm²», «mm2»). Nothing found
 * with confidence: undefined (the span gets no label). The name itself is never changed.
 */
// (no lookbehind in the pattern: older Safari / iOS do not support it — the characters around a match
// are checked by hand)
const SIZE = /([1-9])\s*([x×X])\s*(\d{1,4}(?:[.,]\d{1,2})?)/gu;
const WORD = /[\p{L}\p{N}]/u;
export const cableSizeOf = (name: unknown): string | undefined => {
  if (typeof name !== 'string') return undefined;
  const text = name.normalize('NFC');
  for (const m of text.matchAll(SIZE)) {
    const start = m.index ?? 0, end = start + m[0].length;
    const before = text[start - 1] ?? '', after = text.slice(end);
    if (before && (WORD.test(before) || before === '.' || before === ',')) continue; // inside a longer number or word
    if (/^\p{N}/u.test(after) || /^[.,]\p{N}/u.test(after)) continue; // the section goes on
    if (/^\p{L}/u.test(after) && !/^mm/i.test(after)) continue; // a word follows (only «mm…» may)
    if (!(parseFloat(m[3].replace(',', '.')) > 0)) continue;
    return `${m[1]}${m[2]}${m[3]}`;
  }
  return undefined;
};

/** the label of a span: the conductor size in the name of its library snapshot, only for a valid link */
export const cableNameOf = (props: SpanProps | undefined): string | undefined => {
  const ct = props?.cableType;
  if (!ct || spanCableTypeProblem(ct) !== null) return undefined;
  return cableSizeOf(ct.snapshot.name);
};

/** a name drawn smaller to fit its span is never below this on screen (px) */
export const CABLE_NAME_MIN_SCREEN_PX = 7;

export interface CableNameOptions {
  ctx: LayoutContext;
  /** font size (world units): set size, or the on-screen minimum when larger */
  fs: number;
  /** smallest font size a name may take to fit along its span (world units; default fs): a name
   *  longer than its span is drawn smaller, down to this, before it is moved away from the cable */
  minFs?: number;
  /** proposal boxes as drawn */
  boxes?: Rect[];
  /** the voltage-drop overlay's font size (its «؟» of a span that cannot be calculated sits at the
   *  span's middle): that place is kept free on every span, results shown or not, so the names do
   *  not move when the results are switched on. Default 11 × distance text scale. */
  markFont?: number;
}

/** where the cable names are drawn (in element order, then span order) */
export const cableNameLayout = (elements: DrawingElement[], opts: CableNameOptions): CableNameLabel[] => {
  const { ctx, fs } = opts;
  const out: CableNameLabel[] = [];
  const spans: { c: CableElement; i: number; text: string; p1: Point; p2: Point }[] = [];
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    const lines = cableOffsetLines(c, elements);
    if (lines.length !== c.poleIds.length - 1) continue; // a pole is missing: the spans cannot be matched
    for (let i = 0; i < lines.length; i++) {
      const text = cableNameOf(spanAt(c, i).props);
      if (text) spans.push({ c, i, text, p1: lines[i].p1, p2: lines[i].p2 });
    }
  }
  if (!spans.length) return out;

  const set = drawingObstacles(elements, ctx);
  addPoleTagObstacles(elements, ctx, set);
  for (const b of opts.boxes ?? []) addRect(set, b);
  const distance = new Map(distanceLabelPositions(elements, ctx, ctx.distanceFontSizes).map((d) => [d.key, d]));
  // the «؟» of the results at the middle of every span (vdOverlayLayout: at mid − 0.6 f, 1.1 f high):
  // the glyph itself (about 0.45 em around its centre)
  const mf = opts.markFont ?? 11 * (ctx.distanceTextScale ?? 1);
  for (const e of elements) if (e.type === 'cable') for (const l of cableOffsetLines(e as CableElement, elements)) {
    const mx = (l.p1.x + l.p2.x) / 2, my = (l.p1.y + l.p2.y) / 2;
    addCircle(set, mx, my - mf * 0.6 - mf * 1.1 * 0.3, mf * 1.1 * 0.45);
  }
  // a transformer as drawn (two circles and the rectangle to their right, turned with the symbol):
  // larger than the pole circle the other labels use for it
  const R = ctx.poleRadius;
  for (const e of elements) {
    if (e.type !== 'symbol' || e.symbolId !== 'transformer') continue;
    const r = ((e.rotation || 0) * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    const at = (lx: number, ly: number) => ({ x: e.x + lx * cs - ly * sn, y: e.y + lx * sn + ly * cs });
    for (const cy of [-0.8, 0.8]) { const c = at(0, cy * R); addCircle(set, c.x, c.y, R + 1, 10); }
    addSegment(set, at(1.7 * R, -1.8 * R - 1), at(1.7 * R, 1.8 * R + 1), 0.5 * R + 1, 10);
  }

  const minFs = Math.min(opts.minFs ?? fs, fs);
  for (const { c, i, text, p1, p2 } of spans) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y, L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    // the font: the set size, or smaller (not below minFs) so the name fits between the two poles
    const per = textWidth(text, 1) + 0.4, room = L - 2.4 * ctx.poleRadius;
    const f = Math.max(minFs, Math.min(fs, room / per));
    const half = f * 0.62;
    const ux = dx / L, uy = dy / L;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const tr = (angle * Math.PI) / 180, tx = Math.cos(tr), ty = Math.sin(tr); // reading direction
    const w = textWidth(text, f) + f * 0.4;
    // the side away from the distance number of this span (when it is drawn)
    const key = [c.poleIds[i], c.poleIds[i + 1]].sort().join('_');
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    let nx = -uy, ny = ux;
    const d = ctx.showDistances === false ? undefined : distance.get(key);
    if (d && (d.x - mid.x) * nx + (d.y - mid.y) * ny > 0) { nx = -nx; ny = -ny; }
    const cableHalf = (c.strokeWidth || 2) / 2 + (c.lineStyle === 'straight' ? 1 : 3);
    const g0 = cableHalf + half + f * 0.35;
    let best: { x: number; y: number; cost: number; side: number } | undefined;
    // beside the span first, then further out in steps (with the leader); the first free place is taken
    search: for (const step of [0, 1, 2, 3, 4]) for (const side of [1, -1]) for (const t of [0.5, 0.38, 0.62, 0.26, 0.74]) {
      const gap = g0 + step * f * 1.5;
      const x = p1.x + dx * t + nx * side * gap, y = p1.y + dy * t + ny * side * gap;
      const a = { x: x - (tx * w) / 2, y: y - (ty * w) / 2 }, b = { x: x + (tx * w) / 2, y: y + (ty * w) / 2 };
      // the label and its leader (square to the cable, between the label's edge and the cable's edge;
      // where it touches either is not counted)
      const m = 1.6, lf = { x: x - nx * side * (half + m), y: y - ny * side * (half + m) }, lt = { x: x - nx * side * (gap - cableHalf - m), y: y - ny * side * (gap - cableHalf - m) };
      const cost = segmentCost(set, a, b, half) + (gap - cableHalf - half > 2 * m + 1 ? segmentCost(set, lf, lt, 0.8) : 0);
      if (!best || cost < best.cost - 1e-9) best = { x, y, cost, side };
      if (cost <= 1e-6) break search;
    }
    if (!best) continue;
    const { x, y, side } = best;
    const a = { x: x - (tx * w) / 2, y: y - (ty * w) / 2 }, b = { x: x + (tx * w) / 2, y: y + (ty * w) / 2 };
    // leader: from the middle of the label's edge facing the cable, square to the cable
    const s = side;
    const from = { x: x - nx * s * half, y: y - ny * s * half };
    const along = (x - p1.x) * ux + (y - p1.y) * uy;
    const to = { x: p1.x + ux * along + nx * s * cableHalf, y: p1.y + uy * along + ny * s * cableHalf };
    out.push({ key: `${c.id}#${i}`, cableId: c.id, index: i, text, color: c.strokeColor, x, y, angle, fontSize: f, leader: { from, to }, a, b, half, cost: best.cost });
    addSegment(set, a, b, half);
    addSegment(set, from, to, 0.6);
  }
  return out;
};
