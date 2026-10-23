import type { CableElement, ConsumerElement, DrawingElement, Point } from '../types/drawing';
import { calculateCablePath } from './cableLayout';
import { cableEndArrow, suggestedSplitArrows } from './cableArrows';
import { poleTag } from './poleNames';

// ---------------------------------------------------------------------------
// Placement of the drawing's labels so they do not cover each other (world units).
//
// Nothing here moves a pole, a cable or an arrow, or changes a label's text: it only
// chooses WHERE a movable label is drawn.
//  - Fixed things are obstacles: pole circles, cable runs, arrowheads, distance
//    numbers, pole numbers and the other fixed marks of the voltage-drop overlay,
//    existing subscribers, and proposed-subscriber boxes the user placed.
//  - Movable labels — voltage-drop badges (layoutBadges) and the automatic position
//    of a proposed-subscriber box (layoutProposalBoxes) — try candidate positions in a
//    fixed order, starting with the position used before this layout existed: a
//    label that was not overlapping anything stays exactly where it was. The first
//    candidate with no overlap is taken; when none is free, the one with the least
//    weighted overlap (ties: the earlier candidate). Placed labels become obstacles
//    for the next ones. Deterministic: the same input gives the same result.
// ---------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }
type Obstacle =
  | { kind: 'circle'; cx: number; cy: number; r: number; weight: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; weight: number }
  /** a thick segment (cable run, arrowhead, rotated text) */
  | { kind: 'seg'; a: Point; b: Point; half: number; weight: number };

const W_POLE = 10, W_CABLE = 6, W_ARROW = 6, W_TEXT = 4, W_BOX = 4, W_BADGE = 4, W_CONSUMER = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** things that only touch (less than this deep, world units — under a pixel at zoom 1) do not count as overlapping */
export const TOUCH_TOLERANCE = 0.75;

/** overlap area of two rectangles */
const rectRect = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > TOUCH_TOLERANCE && h > TOUCH_TOLERANCE ? w * h : 0;
};

/** how much a circle covers a rectangle (0 when they do not overlap; an area-like measure otherwise) */
const circleRect = (cx: number, cy: number, r: number, b: Rect) => {
  const nx = clamp(cx, b.x, b.x + b.w), ny = clamp(cy, b.y, b.y + b.h);
  const d = Math.hypot(nx - cx, ny - cy);
  if (d >= r - TOUCH_TOLERANCE) return 0;
  return (r - d) * Math.min(b.w, b.h, 2 * r);
};

/** the part of a thick segment inside a rectangle (length × thickness), by sampling — robust and cheap enough */
const segRect = (a: Point, c: Point, half: number, b: Rect) => {
  const k = half - TOUCH_TOLERANCE;
  if (k <= 0) return 0;
  const ex = { x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k };
  const minX = Math.min(a.x, c.x), maxX = Math.max(a.x, c.x), minY = Math.min(a.y, c.y), maxY = Math.max(a.y, c.y);
  if (maxX < ex.x || minX > ex.x + ex.w || maxY < ex.y || minY > ex.y + ex.h) return 0;
  const L = Math.hypot(c.x - a.x, c.y - a.y);
  const n = Math.max(2, Math.ceil(L / 2));
  let inside = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = a.x + (c.x - a.x) * t, y = a.y + (c.y - a.y) * t;
    if (x > ex.x && x < ex.x + ex.w && y > ex.y && y < ex.y + ex.h) inside++;
  }
  return (inside / (n + 1)) * L * 2 * half;
};

export const overlapWith = (o: Obstacle, r: Rect) => {
  if (o.kind === 'rect') return rectRect(o, r);
  if (o.kind === 'circle') return circleRect(o.cx, o.cy, o.r, r);
  return segRect(o.a, o.b, o.half, r);
};

const boundsOf = (o: Obstacle): Rect => {
  if (o.kind === 'rect') return o;
  if (o.kind === 'circle') return { x: o.cx - o.r, y: o.cy - o.r, w: 2 * o.r, h: 2 * o.r };
  return { x: Math.min(o.a.x, o.b.x) - o.half, y: Math.min(o.a.y, o.b.y) - o.half, w: Math.abs(o.a.x - o.b.x) + 2 * o.half, h: Math.abs(o.a.y - o.b.y) + 2 * o.half };
};

/** Obstacles in grid cells, so a candidate is only tested against what is near it. */
export class ObstacleSet {
  private cells = new Map<string, Obstacle[]>();
  private readonly size = 80;
  readonly all: Obstacle[] = [];
  add(o: Obstacle) {
    this.all.push(o);
    const b = boundsOf(o);
    for (const k of this.keys(b)) { const l = this.cells.get(k); if (l) l.push(o); else this.cells.set(k, [o]); }
  }
  private keys(b: Rect) {
    const out: string[] = [];
    const x0 = Math.floor(b.x / this.size), x1 = Math.floor((b.x + b.w) / this.size), y0 = Math.floor(b.y / this.size), y1 = Math.floor((b.y + b.h) / this.size);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) out.push(`${i},${j}`);
    return out;
  }
  /** weighted overlap of a rectangle with everything (each obstacle counted once) */
  cost(r: Rect) {
    const seen = new Set<Obstacle>();
    let s = 0;
    for (const k of this.keys(r)) for (const o of this.cells.get(k) ?? []) {
      if (seen.has(o)) continue;
      seen.add(o);
      const v = overlapWith(o, r);
      if (v > 1e-6) s += v * o.weight;
    }
    return s;
  }
}

// --- the fixed things of the drawing --------------------------------------------------

export interface LayoutContext {
  /** pole radius in world units (POLE_RADIUS × poleSizeScale) */
  poleRadius: number;
  consumerScale?: number;
  connectionDistances?: Record<string, string>;
  connectionLabelOffsets?: Record<string, { x: number; y: number }>;
  distanceTextScale?: number;
  /** font size of the distance numbers as drawn (world units); default 10 × distanceTextScale */
  distanceFontSize?: number;
  /** per distance number (key → font size), when they differ (distanceLabelFontSizes) */
  distanceFontSizes?: Map<string, number>;
  /** whether the distance numbers are drawn */
  showDistances?: boolean;
  /** arrowhead size as drawn (world units) */
  arrowSize?: number;
}

/**
 * How far a distance number moves away from its cable when drawn larger than its set size
 * (the on-screen minimum): the same gap to the cable as at its set size.
 */
export const distanceLabelExtraOffset = (fontSize: number, baseFontSize: number) => Math.max(0, fontSize - baseFontSize) * 0.6;

/** Where a distance number is drawn: the same rule as the canvas / share preview (centre, angle); `sizes`: per-label font sizes */
export const distanceLabelPositions = (elements: DrawingElement[], ctx: LayoutContext, sizes?: Map<string, number>) => {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const conns = new Map<string, { p1: Point; p2: Point; maxOffset: number }>();
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    for (let i = 0; i < c.poleIds.length - 1; i++) {
      const id1 = c.poleIds[i], id2 = c.poleIds[i + 1];
      const key = [id1, id2].sort().join('_');
      if (!conns.has(key)) {
        const a = byId.get(id1), b = byId.get(id2);
        if (a && b) { const [s, t] = id1 < id2 ? [a, b] : [b, a]; conns.set(key, { p1: { x: s.x, y: s.y }, p2: { x: t.x, y: t.y }, maxOffset: -Infinity }); }
      }
      const conn = conns.get(key);
      if (conn) conn.maxOffset = Math.max(conn.maxOffset, id1 < id2 ? (c.offset || 0) : -(c.offset || 0));
    }
  }
  const dts = ctx.distanceTextScale ?? 1;
  const out: { key: string; x: number; y: number; angle: number; text: string }[] = [];
  for (const [key, { p1, p2, maxOffset }] of conns) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const off = Math.max(0, maxOffset) + 15 * dts + distanceLabelExtraOffset(sizes?.get(key) ?? 10 * dts, 10 * dts);
    const st = ctx.connectionLabelOffsets?.[key] ?? { x: 0, y: 0 };
    out.push({ key, x: (p1.x + p2.x) / 2 + (-dy / len) * off + st.x, y: (p1.y + p2.y) / 2 + (dx / len) * off + st.y, angle, text: ctx.connectionDistances?.[key] ?? '1' });
  }
  return out;
};

/** approximate width of a text in world units */
export const textWidth = (text: string, fontSize: number) => Math.max(fontSize * 0.6, text.length * fontSize * 0.62);

/**
 * The zoom used by the label layout: the real zoom stepped down to the nearest step of a
 * 2 % geometric scale (the layout is not redone on every pinch frame). Never above the
 * real zoom, so a text sized for the on-screen minimum at this zoom is at least that
 * minimum on screen; at most 2 % larger than needed.
 */
export const LAYOUT_ZOOM_STEP = 1.02;
export const layoutViewScale = (scale: number) => {
  if (!(scale > 0)) return 1;
  const q = Math.pow(LAYOUT_ZOOM_STEP, Math.floor(Math.log(scale) / Math.log(LAYOUT_ZOOM_STEP) + 1e-9));
  return Math.min(scale, q);
};

// --- pole numbers of the voltage-drop overlay (fixed marks) ---------------------------

/** font size of a pole number for the overlay's badge font size */
export const POLE_TAG_FONT_FACTOR = 0.85;
/** where a pole number is drawn (text end, baseline): left under the pole; `badgeFont`: the overlay's badge font size */
export const poleTagAnchor = (p: Point, R: number, badgeFont: number) => ({ x: p.x - R * 0.9, y: p.y + R + badgeFont });
/** the rectangle of a pole number drawn right-aligned at (x, y) */
export const poleTagRect = (x: number, y: number, text: string, f: number): Rect => { const w = textWidth(text, f) + f * 0.2; return { x: x - w, y: y - f, w, h: f * 1.4 }; };

/**
 * The pole numbers at their set size (overlay badge font 11 × text scale) for every pole
 * that can carry one (a pole on a cable, or a transformer), whether the results are shown
 * or not — so the boxes do not move when the results are switched on.
 */
export const addPoleTagObstacles = (elements: DrawingElement[], ctx: LayoutContext, set: ObstacleSet) => {
  const onCable = new Set<string>();
  for (const e of elements) if (e.type === 'cable') for (const id of (e as CableElement).poleIds) onCable.add(id);
  const tag = poleTag(elements);
  const fs = 11 * (ctx.distanceTextScale ?? 1), f = fs * POLE_TAG_FONT_FACTOR;
  for (const e of elements) {
    if (e.type !== 'symbol' || !(onCable.has(e.id) || e.symbolId === 'transformer')) continue;
    const a = poleTagAnchor({ x: e.x, y: e.y }, ctx.poleRadius, fs);
    set.add({ kind: 'rect', ...poleTagRect(a.x, a.y, tag(e.id), f), weight: W_TEXT });
  }
  return set;
};

/** The 4 directions an existing subscriber / a proposal box can take, best first (the canvas's smart placement rule). */
export const smartDirections = (elements: DrawingElement[], poleId: string) => {
  const pole = elements.find((e) => e.id === poleId);
  const DIRS = [{ dx: 1, dy: 0, a: 0 }, { dx: 0, dy: 1, a: 90 }, { dx: -1, dy: 0, a: 180 }, { dx: 0, dy: -1, a: 270 }];
  if (!pole) return DIRS.map((d, i) => ({ ...d, i }));
  const angles: number[] = [];
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    const idx = c.poleIds.indexOf(poleId);
    if (idx === -1) continue;
    for (const j of [idx - 1, idx + 1]) {
      if (j < 0 || j >= c.poleIds.length) continue;
      const n = elements.find((x) => x.id === c.poleIds[j]);
      if (n) { let a = (Math.atan2(n.y - pole.y, n.x - pole.x) * 180) / Math.PI; if (a < 0) a += 360; angles.push(a); }
    }
  }
  const score = (a: number) => (angles.length ? Math.min(...angles.map((x) => { const d = Math.abs(a - x); return d > 180 ? 360 - d : d; })) : 360);
  return DIRS.map((d, i) => ({ ...d, s: score(d.a), i })).sort((p, q) => q.s - p.s || p.i - q.i);
};

/** Where an existing subscriber is drawn (centre) and its label — the canvas's rule. */
export const consumerShapes = (elements: DrawingElement[], ctx: LayoutContext) => {
  const cs = ctx.consumerScale ?? 1;
  const r = 16 * cs, margin = 5 * cs, spacing = r * 2 + margin;
  const out: { id: string; cx: number; cy: number; r: number; square: boolean; label?: Rect }[] = [];
  const byPole = new Map<string, ConsumerElement[]>();
  for (const e of elements) if (e.type === 'consumer' && !(e as ConsumerElement).proposal) {
    const c = e as ConsumerElement; byPole.set(c.poleId, [...(byPole.get(c.poleId) ?? []), c]);
  }
  for (const [poleId, list] of byPole) {
    const pole = elements.find((e) => e.id === poleId);
    if (!pole) continue;
    const d = smartDirections(elements, poleId)[0];
    list.forEach((c, index) => {
      let cx: number, cy: number;
      if (c.hasManualPosition) { cx = c.x; cy = c.y; }
      else { const t = ctx.poleRadius + r + margin + index * spacing; cx = pole.x + d.dx * t; cy = pole.y + d.dy * t; }
      let label: Rect | undefined;
      if (c.label) {
        const fs = 14 * cs, w = textWidth(c.label, fs);
        label = c.variant === 'square' ? { x: cx - w / 2, y: cy - (r + 10) - fs / 2, w, h: fs } : { x: cx + r, y: cy - fs / 2, w, h: fs };
      }
      out.push({ id: c.id, cx, cy, r, square: c.variant !== 'circle', label });
    });
  }
  return out;
};

/** The fixed obstacles of a drawing (without voltage-drop marks and without proposal boxes). */
export const drawingObstacles = (elements: DrawingElement[], ctx: LayoutContext, set = new ObstacleSet()) => {
  const R = ctx.poleRadius;
  for (const e of elements) if (e.type === 'symbol') set.add({ kind: 'circle', cx: e.x, cy: e.y, r: R, weight: W_POLE });
  const arrow = ctx.arrowSize ?? 8;
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    const path = calculateCablePath(c, elements);
    const half = (c.strokeWidth || 2) / 2 + (c.lineStyle === 'straight' ? 1 : 3); // a zigzag swings ±2
    for (let i = 0; i < path.length - 1; i++) set.add({ kind: 'seg', a: path[i], b: path[i + 1], half, weight: W_CABLE });
    // arrowheads: tip on the pole circle, body `size` long outward, `size` wide
    const heads = [cableEndArrow(c, path, elements, R), ...suggestedSplitArrows(c, path, elements, R)].filter(Boolean) as { pos: Point; angle: number }[];
    for (const h of heads) {
      const t = (h.angle * Math.PI) / 180, ux = -Math.cos(t), uy = -Math.sin(t);
      set.add({ kind: 'seg', a: h.pos, b: { x: h.pos.x + ux * arrow, y: h.pos.y + uy * arrow }, half: arrow / 2, weight: W_ARROW });
    }
  }
  for (const s of consumerShapes(elements, ctx)) {
    // the shape as drawn (circle or square, its 2-unit stroke)
    const e = s.r + 1;
    if (s.square) set.add({ kind: 'rect', x: s.cx - e, y: s.cy - e, w: 2 * e, h: 2 * e, weight: W_CONSUMER });
    else set.add({ kind: 'circle', cx: s.cx, cy: s.cy, r: e, weight: W_CONSUMER });
    if (s.label) set.add({ kind: 'rect', ...s.label, weight: W_CONSUMER });
  }
  if (ctx.showDistances !== false && ctx.connectionDistances) {
    const base = ctx.distanceFontSize ?? 10 * (ctx.distanceTextScale ?? 1);
    for (const d of distanceLabelPositions(elements, ctx, ctx.distanceFontSizes)) set.add(distanceObstacle(d, ctx.distanceFontSizes?.get(d.key) ?? base));
  }
  return set;
};

const distanceObstacle = (d: { x: number; y: number; angle: number; text: string }, fs: number): Obstacle => {
  const w = textWidth(d.text, fs) + fs * 0.4, t = (d.angle * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t);
  return { kind: 'seg', a: { x: d.x - (ux * w) / 2, y: d.y - (uy * w) / 2 }, b: { x: d.x + (ux * w) / 2, y: d.y + (uy * w) / 2 }, half: fs * 0.6, weight: W_TEXT };
};

/**
 * cost of a thick segment against the set, by covering it with small squares. `ends`: the
 * segment reaches `half` past both ends too — the extent the set itself gives a thick segment
 * (segRect), so this then measures exactly the margin a placed label keeps from it.
 */
const costOfObstacle = (set: ObstacleSet, o: Obstacle, ends = false) => {
  if (o.kind !== 'seg') return set.cost(boundsOf(o));
  let a = o.a, b = o.b;
  const L0 = Math.hypot(b.x - a.x, b.y - a.y);
  if (ends && L0 > 1e-9) {
    const ux = (b.x - a.x) / L0, uy = (b.y - a.y) / L0;
    a = { x: a.x - ux * o.half, y: a.y - uy * o.half }; b = { x: b.x + ux * o.half, y: b.y + uy * o.half };
  }
  const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / (o.half * 2)));
  let c = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    c += set.cost({ x: x - o.half, y: y - o.half, w: 2 * o.half, h: 2 * o.half });
  }
  return c;
};

/**
 * Font size of each distance number (fixed in place): the on-screen minimum `min` where
 * the larger text covers nothing more than the text at its set size `base` would; else
 * `base` (so a minimum never adds an overlap). min ≤ base: base everywhere.
 * `boxes`: the proposal boxes as drawn (final positions, layoutProposalBoxes), also obstacles;
 * so are the pole numbers of the results at their set size (addPoleTagObstacles). The larger
 * text must also cover no more of those texts (and their margin, measured as the badges and
 * boxes measure it) than at its set size: a number moving off its cable does not trade that
 * for covering a box or a pole number.
 */
export const distanceLabelFontSizes = (elements: DrawingElement[], ctx: LayoutContext, base: number, min: number, boxes: Rect[] = []): Map<string, number> => {
  const out = new Map<string, number>();
  const labels = distanceLabelPositions(elements, ctx);
  if (min <= base) { for (const d of labels) out.set(d.key, base); return out; }
  const set = drawingObstacles(elements, { ...ctx, showDistances: false });
  // the boxes and the pole numbers (fixed, at their set size; the same rectangles the boxes avoid)
  const marks = addPoleTagObstacles(elements, ctx, new ObstacleSet());
  for (const b of boxes) { addRect(set, b); addRect(marks, b); }
  addPoleTagObstacles(elements, ctx, set);
  const all = new Map(labels.map((d) => [d.key, min]));
  const moved = new Map(distanceLabelPositions(elements, ctx, all).map((d) => [d.key, d]));
  const le = (a: number, b: number) => a <= b + 1e-6;
  for (const d of labels) {
    const bigAt = moved.get(d.key)!; // larger, and moved off the cable by the extra height
    const big = distanceObstacle(bigAt, min), small = distanceObstacle(d, base);
    const fs = le(costOfObstacle(set, big), costOfObstacle(set, small)) && le(costOfObstacle(marks, big, true), costOfObstacle(marks, small, true)) ? min : base;
    out.set(d.key, fs);
    set.add(distanceObstacle(fs === min ? bigAt : d, fs));
  }
  return out;
};

// --- movable labels --------------------------------------------------------------------

export interface Candidate { x: number; y: number; leader: boolean }

/** first free candidate, else the least-overlap one (ties: the earlier); never loops */
export const pickCandidate = (set: ObstacleSet, w: number, h: number, candidates: Candidate[]) => {
  let best = -1, bestCost = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cost = set.cost({ x: c.x, y: c.y, w, h });
    if (cost <= 1e-6) return { index: i, cost: 0, ...c };
    if (cost < bestCost - 1e-9) { bestCost = cost; best = i; }
  }
  return { index: best, cost: bestCost, ...candidates[best] };
};

/**
 * Positions around a pole for a group of size w × h: the original one first (above,
 * right of the pole), then the other corners and sides, then the same directions
 * further out (those are drawn with a leader line to the pole).
 */
export const badgeCandidates = (p: Point, R: number, w: number, h: number, step: number): Candidate[] => {
  const o = R * 0.75, g = R * 0.25;
  const base: [number, number, number, number][] = [
    // x, y of the group's top-left, and the outward direction used for the further rings
    [p.x + o, p.y - o - h, 1, -1],          // NE (original)
    [p.x - o - w, p.y - o - h, -1, -1],     // NW
    [p.x + o, p.y + o, 1, 1],               // SE
    [p.x - o - w, p.y + o, -1, 1],          // SW
    [p.x + R + g, p.y - h / 2, 1, 0],       // E
    [p.x - R - g - w, p.y - h / 2, -1, 0],  // W
    [p.x - w / 2, p.y - R - g - h, 0, -1],  // N
    [p.x - w / 2, p.y + R + g, 0, 1],       // S
  ];
  const out: Candidate[] = base.map(([x, y]) => ({ x, y, leader: false }));
  for (let k = 1; k <= 4; k++) for (const [x, y, dx, dy] of base) {
    const n = Math.hypot(dx, dy) || 1;
    out.push({ x: x + (dx / n) * step * k, y: y + (dy / n) * step * k, leader: true });
  }
  return out;
};

export interface BadgeGroupInput {
  poleId: string;
  x: number; y: number;
  /** each badge's width; all share the line height */
  widths: number[];
}
export interface BadgeGroupPlacement { poleId: string; x: number; y: number; w: number; h: number; leader: boolean; cost: number }

/**
 * Voltage-drop badge groups (the results at one pole, stacked). `lineH` is the height
 * per result (badges are drawn lineH × 0.9 high, as before).
 */
export const layoutBadges = (groups: BadgeGroupInput[], set: ObstacleSet, R: number, lineH: number): Map<string, BadgeGroupPlacement> => {
  const out = new Map<string, BadgeGroupPlacement>();
  for (const g of groups) {
    const w = Math.max(...g.widths), h = lineH * g.widths.length;
    // the rectangle actually drawn ends 0.1 lineH above the stack bottom
    const hh = h - lineH * 0.1;
    const pick = pickCandidate(set, w, hh, badgeCandidates({ x: g.x, y: g.y }, R, w, h, lineH * 1.2));
    out.set(g.poleId, { poleId: g.poleId, x: pick.x, y: pick.y, w, h, leader: pick.leader, cost: pick.cost });
    set.add({ kind: 'rect', x: pick.x, y: pick.y, w, h: hh, weight: W_BADGE });
  }
  return out;
};

/** obstacle for something placed by another step (a proposal box, a badge, a fixed mark) */
export const addRect = (set: ObstacleSet, r: Rect, weight = W_BOX) => set.add({ kind: 'rect', ...r, weight });
export const addCircle = (set: ObstacleSet, cx: number, cy: number, r: number, weight = W_TEXT) => set.add({ kind: 'circle', cx, cy, r, weight });
