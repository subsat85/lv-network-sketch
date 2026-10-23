import type { DrawingElement, Point } from '../types/drawing';
import type { VoltageDropResult } from './voltageDrop';
import { POLE_STATUS_MARK, PROVISIONAL_MARK } from './vdLabels';
import { poleTag } from './poleNames';
import { addCircle, addRect, drawingObstacles, layoutBadges, poleTagAnchor, poleTagRect, POLE_TAG_FONT_FACTOR, type LayoutContext, type Rect } from './overlayLayout';

// Where the voltage-drop overlay draws its marks (world units). The texts, colours and
// statuses are exactly those of the overlay; only the badge positions are chosen here:
// the badges of a pole are placed as one stack, at the original position (above, right
// of the pole) when nothing is there, else at the first free position around the pole
// (overlayLayout.ts). The pole numbers, junction marks and «؟» of spans keep their places
// and are obstacles. A stack moved away from the pole gets a leader line to it.

export interface VdBadge { key: string; poleId: string; bus: string; x: number; y: number; w: number; h: number; text: string; status: string; color: string; provisional: boolean }
export interface VdOverlayLayout {
  fs: number;
  lineH: number;
  badges: VdBadge[];
  tags: { poleId: string; x: number; y: number; text: string; fontSize: number }[];
  junctions: { poleId: string; x: number; y: number; fontSize: number }[];
  missing: { key: string; x: number; y: number; color: string; fontSize: number }[];
  leaders: { poleId: string; from: Point; to: Point; color: string }[];
  /** total weighted overlap left (0 = none) */
  cost: number;
}

export interface VdLayoutOptions {
  ctx: LayoutContext;
  /** badge font size in world units (11 × textScale, or more at a small zoom) */
  fs: number;
  /** proposal boxes as drawn (rectangles, world units) */
  boxes?: Rect[];
  /** smallest font size of any mark, world units (from the on-screen minimum at the current zoom); none on paper */
  minFont?: number;
}

export const badgeText = (r: VoltageDropResult['circuits'][number]['poles'][number]) => {
  const prov = r.status !== 'na' && r.provisional.length > 0;
  return r.status === 'na' ? `${POLE_STATUS_MARK.na}` : prov ? `${PROVISIONAL_MARK}${r.percent!.toFixed(1)}% ⚑` : `${r.percent!.toFixed(1)}% ${POLE_STATUS_MARK[r.status]}`;
};

export const vdOverlayLayout = (elements: DrawingElement[], result: VoltageDropResult, opts: VdLayoutOptions): VdOverlayLayout => {
  const { ctx } = opts;
  const min = opts.minFont ?? 0;
  const fs = Math.max(opts.fs, min);
  const sz = (base: number) => Math.max(base, min);
  const R = ctx.poleRadius;
  const lineH = fs * 1.55;
  const poles = new Map<string, { x: number; y: number }>();
  for (const e of elements) if (e.type === 'symbol') poles.set(e.id, { x: e.x, y: e.y });
  const tag = poleTag(elements);
  const out: VdOverlayLayout = { fs, lineH, badges: [], tags: [], junctions: [], missing: [], leaders: [], cost: 0 };

  const set = drawingObstacles(elements, ctx);
  for (const b of opts.boxes ?? []) addRect(set, b);
  // fixed marks (same places as before). A pole number takes the on-screen minimum only
  // where that larger text covers nothing more than at its set size (never a new overlap).
  const tagRect = poleTagRect;
  for (const [poleId] of result.byPole) {
    const p = poles.get(poleId);
    if (!p) continue;
    const text = tag(poleId), base = opts.fs * POLE_TAG_FONT_FACTOR, big = sz(base);
    const { x, y: y0 } = poleTagAnchor(p, R, opts.fs), y1 = poleTagAnchor(p, R, fs).y;
    const ok = big <= base || set.cost(tagRect(x, y1, text, big)) <= set.cost(tagRect(x, y0, text, base)) + 1e-6;
    const t = ok ? { poleId, x, y: y1, text, fontSize: big } : { poleId, x, y: y0, text, fontSize: base };
    out.tags.push(t);
    addRect(set, tagRect(t.x, t.y, t.text, t.fontSize));
  }
  for (const pid of new Set(result.network.inferredJunctions.map((j) => j.poleId))) {
    const p = poles.get(pid);
    if (p) out.junctions.push({ poleId: pid, x: p.x + R * 0.9, y: p.y + R + fs, fontSize: sz(opts.fs * 0.9) });
  }
  for (const s of result.bySpan.values()) {
    if (s.computable || !s.missing.length) continue;
    const a = poles.get(s.fromPole), b = poles.get(s.toPole);
    if (a && b) out.missing.push({ key: s.key, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - fs * 0.6, color: s.color, fontSize: sz(opts.fs * 1.1) });
  }

  for (const j of out.junctions) addRect(set, { x: j.x, y: j.y - j.fontSize, w: j.fontSize, h: j.fontSize * 1.2 });
  for (const m of out.missing) addCircle(set, m.x, m.y - m.fontSize * 0.3, m.fontSize * 0.7);

  // badge stacks, one per pole, in the result's order
  const groups: { poleId: string; x: number; y: number; widths: number[]; items: { key: string; bus: string; text: string; status: string; color: string; provisional: boolean; w: number }[] }[] = [];
  for (const [poleId, list] of result.byPole) {
    const p = poles.get(poleId);
    if (!p) continue;
    const items = list.map((r) => {
      const text = badgeText(r);
      return { key: `${poleId}:${r.bus}`, bus: r.bus, text, status: r.status, color: r.color, provisional: r.status !== 'na' && r.provisional.length > 0, w: Math.max(fs * 1.6, text.length * fs * 0.62 + fs * 0.6) };
    });
    groups.push({ poleId, x: p.x, y: p.y, widths: items.map((i) => i.w), items });
  }
  const placed = layoutBadges(groups, set, R, lineH);
  for (const g of groups) {
    const pl = placed.get(g.poleId)!;
    out.cost += pl.cost;
    // badge i (0 = the first result) sits at the bottom of the stack, as before
    g.items.forEach((it, i) => out.badges.push({ ...it, poleId: g.poleId, x: pl.x, y: pl.y + pl.h - lineH * (i + 1), h: lineH * 0.9 }));
    if (pl.leader) {
      const p = poles.get(g.poleId)!;
      const cx = Math.max(pl.x, Math.min(p.x, pl.x + pl.w)), cy = Math.max(pl.y, Math.min(p.y, pl.y + pl.h - lineH * 0.1));
      const dx = cx - p.x, dy = cy - p.y, L = Math.hypot(dx, dy) || 1;
      out.leaders.push({ poleId: g.poleId, from: { x: cx, y: cy }, to: { x: p.x + (dx / L) * R, y: p.y + (dy / L) * R }, color: g.items[0].color });
    }
  }
  return out;
};
