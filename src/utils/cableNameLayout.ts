import type { CableElement, DrawingElement, Point, SpanProps } from '../types/drawing';
import { cableOffsetLines } from './cableLayout';
import { spanCableTypeProblem } from './cableTypeModel';
import { spanAt } from './spanModel';
import {
  addCircle, addRect, addSegment, distanceLabelPositions, drawingObstacles, ObstacleSet, poleTagAnchor, poleTagRect,
  POLE_TAG_FONT_FACTOR, segmentCost, textWidth, type LayoutContext, type Rect,
} from './overlayLayout';
import { poleTag } from './poleNames';

// The conductor size of the library cable linked to a span («3×120»), written beside the span
// (visual only).
//
// The text is the size read from the name in the span's own snapshot (the exact revision it was
// linked to), at display time (cableSizeOf): the name, the snapshot and the library are not changed,
// nothing is looked up in the library, nothing is invented. A span without a valid link, or whose cable
// name has no size that can be read with confidence, has no label.
// One label per cable and size, on the longest span of that cable with that size: a name is not
// repeated along its cable. The label is plain text along the span (turned so it reads left to
// right), next to its cable — no leader line, no frame. The labels of the cables that run along the
// same span (parallel cables) form one aligned stack on one side: the same place along the span,
// one font, equal spacing, in the cables' own order across the span. Where a stack goes is chosen like
// the other labels of the drawing (overlayLayout.ts): fixed candidate positions in order (the side
// away from the distance number first; along the span; one small step further out), the first that
// covers nothing (poles, transformers, cables, arrowheads, subscribers and their labels, distance
// numbers, pole numbers, the results' «؟», proposal boxes, labels placed before), else the one that
// covers least. Deterministic; the same drawing gives the same places (they change with the zoom
// only in the layout's 2 % steps).

export interface CableNameLabel {
  /** the span (cableId#index) */
  key: string;
  cableId: string;
  index: number;
  text: string;
  color: string;
  /** centre of the text, its angle (degrees, −90…90) and font size (world units) */
  x: number; y: number; angle: number; fontSize: number;
  /** the label as an obstacle (centre line and half height) for the marks placed after it */
  a: Point; b: Point; half: number;
  /** weighted overlap left (0 = none) */
  cost: number;
  /** only on a short span / where no place beside the cables was free: a short arrow from the name
   *  to its cable (the arrowhead at `to`) */
  arrow?: { from: Point; to: Point };
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
export const cableNameLayout = (elements: DrawingElement[], opts: CableNameOptions): CableNameLabel[] => cableNameLayoutWithTags(elements, opts).labels;

/** a pole number moved (world units) to make room for a cable name on a short span */
export type PoleTagShifts = Map<string, { dx: number; dy: number }>;

/**
 * The cable names, and the pole numbers moved to make room for them (cableNameLayout). On a span that
 * has room, the names are as described above. On a short span, or where no place beside the cables is
 * free (a name would be drawn smaller than its set size to fit, or would cover something):
 *  1. the names keep their set size; the pole numbers of the span's two poles may move a little away
 *     from their pole (down, or further left, by one or two of their own heights) to free the place
 *     beside the cables — only to a place that covers nothing; then no arrow is needed;
 *  2. else the stack goes to the nearest clear place a little further out, and each name gets a short,
 *     thin arrow in its cable's colour pointing at its cable (never a long line).
 */
export const cableNameLayoutWithTags = (elements: DrawingElement[], opts: CableNameOptions): { labels: CableNameLabel[]; tagShifts: PoleTagShifts } => {
  const { ctx, fs } = opts;
  const out: CableNameLabel[] = [];
  const tagShifts: PoleTagShifts = new Map();
  const byId = new Map(elements.map((e) => [e.id, e]));
  // one label per cable and size: on the longest span of that cable with that size (ties: the first)
  type Entry = { c: CableElement; i: number; text: string; p1: Point; p2: Point; L: number };
  const entries: Entry[] = [];
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    const lines = cableOffsetLines(c, elements);
    if (lines.length !== c.poleIds.length - 1) continue; // a pole is missing: the spans cannot be matched
    const home = new Map<string, Entry>();
    for (let i = 0; i < lines.length; i++) {
      const text = cableNameOf(spanAt(c, i).props);
      if (!text) continue;
      const L = Math.hypot(lines[i].p2.x - lines[i].p1.x, lines[i].p2.y - lines[i].p1.y);
      const h = home.get(text);
      if (!h || L > h.L + 1e-9) home.set(text, { c, i, text, p1: lines[i].p1, p2: lines[i].p2, L });
    }
    entries.push(...home.values());
  }
  if (!entries.length) return { labels: out, tagShifts };

  // everything fixed except the pole numbers (those may move: they are kept in their own set)
  const set = drawingObstacles(elements, ctx);
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
  // the pole numbers where they are drawn (addPoleTagObstacles' rule, but only those actually drawn:
  // a pole on a cable — a transformer has no number), each as its own rectangle
  const tagFs = 11 * (ctx.distanceTextScale ?? 1), tagF = tagFs * POLE_TAG_FONT_FACTOR;
  const onCable = new Set<string>();
  for (const e of elements) if (e.type === 'cable') for (const id of (e as CableElement).poleIds) onCable.add(id);
  const tagName = poleTag(elements);
  const tagRect = new Map<string, Rect>();
  for (const e of elements) {
    if (e.type !== 'symbol' || e.symbolId === 'transformer' || !onCable.has(e.id)) continue;
    const a = poleTagAnchor({ x: e.x, y: e.y }, R, tagFs);
    tagRect.set(e.id, poleTagRect(a.x, a.y, tagName(e.id), tagF));
  }
  const tagSet = (skip?: Set<string>) => { const t = new ObstacleSet(); for (const [id, r] of tagRect) if (!skip?.has(id)) addRect(t, r, 4); return t; };
  let tags = tagSet();

  // the labels of the cables of one span (parallel cables) are laid out together, as one aligned stack
  const bundles = new Map<string, Entry[]>();
  for (const en of entries) {
    const key = [en.c.poleIds[en.i], en.c.poleIds[en.i + 1]].sort().join('_');
    bundles.set(key, [...(bundles.get(key) ?? []), en]);
  }
  const minFs = Math.min(opts.minFs ?? fs, fs);
  for (const [key, list] of bundles) {
    // the span in its canonical direction (smaller pole id first), as the distance number uses it
    const [ida, idb] = key.split('_');
    const A = byId.get(ida), B = byId.get(idb);
    if (!A || !B) continue;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const ux = dx / L, uy = dy / L, nx0 = -uy, ny0 = ux;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const tr = (angle * Math.PI) / 180, tx = Math.cos(tr), ty = Math.sin(tr); // reading direction
    const room = L - 2.4 * R;
    const fit = Math.min(...list.map((en) => room / (textWidth(en.text, 1) + 0.4)));
    const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const d = ctx.showDistances === false ? undefined : distance.get(key);
    const away = d && (d.x - mid.x) * nx0 + (d.y - mid.y) * ny0 > 0 ? -1 : 1;

    // the part of the cable visible between the two pole circles (half its length, from the middle):
    // an arrow points only there, never into a pole
    // (a transformer reaches 2.2 R from its centre, a pole R; measured from the span's middle, the
    // visible part runs from −visA (towards A) to +visB (towards B))
    const reachOf = (e: DrawingElement) => (e.type === 'symbol' && e.symbolId === 'transformer' ? 2.2 * R : R);
    const margin = 1.5 + fs * 0.26; // the arrowhead's half width and a gap
    const visA = L / 2 - reachOf(A) - margin, visB = L / 2 - reachOf(B) - margin;
    type Placed = { en: Entry; x: number; y: number; a: Point; b: Point; arrow?: { from: Point; to: Point } };
    /** the stack at (step, side, t) for font f; `arrows`: each name gets its arrow to its cable */
    const stack = (f: number, step: number, side: number, t: number, arrows: boolean, aim = 0): { placed: Placed[]; half: number; segs: { a: Point; b: Point; half: number }[] } => {
      const half = f * 0.62, pitch = f * 1.3;
      const items = list.map((en) => {
        const off = ((en.p1.x + en.p2.x) / 2 - mid.x) * nx0 + ((en.p1.y + en.p2.y) / 2 - mid.y) * ny0;
        const reach = (en.c.strokeWidth || 2) / 2 + (en.c.lineStyle === 'straight' ? 1 : 3);
        return { en, off, reach, w: textWidth(en.text, f) + f * 0.4 };
      });
      // the stack starts just past the outermost cable on that side; the labels keep the cables'
      // order across the span (the n-order of the labels is the n-order of their cables)
      const outer = Math.max(...items.map((it) => side * it.off + it.reach));
      const base = outer + half + f * 0.35 + step * f * 0.9;
      const order = [...items].sort((p, q) => side * p.off - side * q.off || p.en.c.id.localeCompare(q.en.c.id));
      const maxW = Math.max(...items.map((it) => it.w));
      const segs: { a: Point; b: Point; half: number }[] = [];
      const placed = order.map((it, k) => {
        const g = base + k * pitch;
        const x = A.x + dx * t + nx0 * side * g, y = A.y + dy * t + ny0 * side * g;
        const a = { x: x - (tx * it.w) / 2, y: y - (ty * it.w) / 2 }, b = { x: x + (tx * it.w) / 2, y: y + (ty * it.w) / 2 };
        segs.push({ a, b, half });
        let arrow: Placed['arrow'];
        if (arrows) {
          // from the name, square to the span, to its own cable's edge, at a point of the cable that is
          // visible between the two poles. One name: from its middle. A stack: the arrows sit side by
          // side past the end of the longest name (so they cross no name), kept within the visible part
          const n = order.length;
          const centre = (t - 0.5) * L; // the stack's place along the span, from its middle
          const want = n === 1 ? (aim > 0 ? visB - centre : aim < 0 ? -visA - centre : 0) : (maxW / 2 + f * 0.3 + k * f * 0.7) * (t <= 0.5 ? 1 : -1);
          const along = Math.max(-visA, Math.min(visB, centre + want)) - centre;
          const ax = x + ux * along, ay = y + uy * along;
          const to = { x: ax - nx0 * side * (g - side * it.off - it.reach - 0.5), y: ay - ny0 * side * (g - side * it.off - it.reach - 0.5) };
          const from = { x: ax - nx0 * side * (half + f * 0.15), y: ay - ny0 * side * (half + f * 0.15) };
          arrow = { from, to };
          // the arrow must not cover anything between the name and the bundle (inside the bundle it
          // crosses the cables in front of its own: that part is not counted)
          const clear = g - outer - 3;
          if (clear > half + f * 0.15 + 0.5) segs.push({ a: from, b: { x: ax - nx0 * side * clear, y: ay - ny0 * side * clear }, half: Math.max(0.8, f * 0.12) });
        }
        return { en: it.en, x, y, a, b, arrow };
      });
      return { placed, half, segs };
    };
    const costOf = (segs: { a: Point; b: Point; half: number }[], t: ObstacleSet) => segs.reduce((c, s) => c + segmentCost(set, s.a, s.b, s.half) + segmentCost(t, s.a, s.b, s.half), 0);
    // the pole numbers of this span's two poles, moved (one or two of their heights, down or to the
    // left) only where that frees the place and covers nothing
    const SHIFTS = [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: 2 }, { dx: -2, dy: 0 }, { dx: -1, dy: 1 }];
    const withTagsMoved = (segs: { a: Point; b: Point; half: number }[]): { cost: number; moves: Map<string, { dx: number; dy: number }> } => {
      const ends = [ida, idb].filter((id) => tagRect.has(id) && !tagShifts.has(id));
      const others = tagSet(new Set(ends));
      const moves = new Map<string, { dx: number; dy: number }>();
      const cost = costOf(segs, others);
      if (cost > 1e-6) return { cost, moves };
      // the names cover nothing but the end poles' numbers: move those that are covered
      const probe = new ObstacleSet();
      for (const sg of segs) addSegment(probe, sg.a, sg.b, sg.half);
      for (const id of ends) {
        const r0 = tagRect.get(id)!;
        if (probe.cost(r0) <= 1e-6) continue;
        const h = r0.h;
        const ok = SHIFTS.map((m) => ({ dx: m.dx * h, dy: m.dy * h })).find((m) => {
          const r = { x: r0.x + m.dx, y: r0.y + m.dy, w: r0.w, h: r0.h };
          return set.cost(r) <= 1e-6 && probe.cost(r) <= 1e-6 && others.cost(r) <= 1e-6 && ![...moves].some(([oid, om]) => { const o = tagRect.get(oid)!; const q = new ObstacleSet(); addRect(q, { x: o.x + om.dx, y: o.y + om.dy, w: o.w, h: o.h }); return q.cost(r) > 1e-6; });
        });
        if (!ok) return { cost: probe.cost(r0) * 4, moves: new Map() };
        moves.set(id, ok);
      }
      return { cost: 0, moves };
    };

    const T = [0.5, 0.38, 0.62, 0.26, 0.74];
    // 1. as on any span: beside the cables, the font fitted to the span (not below minFs)
    const f1 = Math.max(minFs, Math.min(fs, fit));
    let best: { cost: number; placed: Placed[]; half: number; f: number; moves?: Map<string, { dx: number; dy: number }> } | undefined;
    search1: for (const step of [0, 1]) for (const side of [away, -away]) for (const t of T) {
      const s = stack(f1, step, side, t, false);
      const cost = costOf(s.segs, tags);
      if (!best || cost < best.cost - 1e-9) best = { cost, placed: s.placed, half: s.half, f: f1 };
      if (cost <= 1e-6) break search1;
    }
    const short = fit < fs - 1e-9;
    if (short || best!.cost > 1e-6) {
      // a short span, or no free place: the set size; 2. beside the cables with the pole numbers moved;
      // 3. a little further out, with arrows
      let found: typeof best;
      search2: for (const step of [0, 1]) for (const side of [away, -away]) for (const t of T) {
        const s = stack(fs, step, side, t, false);
        const r = withTagsMoved(s.segs);
        if (r.cost <= 1e-6) { found = { cost: 0, placed: s.placed, half: s.half, f: fs, moves: r.moves }; break search2; }
      }
      // (arrows only where the visible part of the cable has room for them, side by side for a stack)
      if (!found && visA + visB >= (list.length - 1) * fs * 0.7) {
        let least: typeof best;
        // (one name: its arrow may also point at either end of the visible part of the cable)
        search3: for (const step of [1, 2, 3, 4]) for (const side of [away, -away]) for (const t of [0.5, 0.38, 0.62]) for (const aim of list.length === 1 ? [0, 1, -1] : [0]) {
          const s = stack(fs, step, side, t, true, aim);
          const r = withTagsMoved(s.segs);
          if (!least || r.cost < least.cost - 1e-9) least = { cost: r.cost, placed: s.placed, half: s.half, f: fs, moves: r.moves };
          if (r.cost <= 1e-6) break search3;
        }
        // the far place is taken only when it is free, or covers less than the first one
        if (least && (least.cost <= 1e-6 || least.cost < best!.cost - 1e-9)) found = least;
      }
      if (found) best = found;
    }
    const b0 = best!;
    for (const [id, m] of b0.moves ?? []) {
      tagShifts.set(id, m);
      const r = tagRect.get(id)!;
      tagRect.set(id, { x: r.x + m.dx, y: r.y + m.dy, w: r.w, h: r.h });
    }
    if (b0.moves?.size) tags = tagSet();
    for (const p of b0.placed) {
      const { en } = p;
      out.push({ key: `${en.c.id}#${en.i}`, cableId: en.c.id, index: en.i, text: en.text, color: en.c.strokeColor, x: p.x, y: p.y, angle, fontSize: b0.f, a: p.a, b: p.b, half: b0.half, cost: b0.cost, ...(p.arrow ? { arrow: p.arrow } : {}) });
      addSegment(set, p.a, p.b, b0.half);
      if (p.arrow) addSegment(set, p.arrow.from, p.arrow.to, Math.max(0.8, b0.f * 0.12), 1);
    }
  }
  return { labels: out, tagShifts };
};
