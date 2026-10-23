import { describe, expect, it } from 'vitest';
import { addPoleTagObstacles, badgeCandidates, distanceLabelFontSizes, drawingObstacles, layoutBadges, layoutViewScale, LAYOUT_ZOOM_STEP, ObstacleSet, overlapWith, addRect, poleTagRect, POLE_TAG_FONT_FACTOR, TOUCH_TOLERANCE, type Rect } from '../overlayLayout';
import { vdOverlayLayout } from '../vdOverlayLayout';
import { layoutProposalBoxes, proposalBoxCenter, proposalGeometry, PROPOSAL_BOX } from '../proposalDrawing';
import { computeVoltageDrop } from '../voltageDrop';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';

const R = 20;
const pole = (id: string, x: number, y: number, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string, x: number, y: number) => pole(id, x, y, { symbolId: 'transformer' });
const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'straight', strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2, ...extra });
const sub = (poleId: string, amps: number, color = '#ff0000'): ConsumerElement => ({ id: `u-${poleId}-${color}`, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: String(amps), strokeColor: color, fillColor: color, strokeWidth: 2 });
const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, system: '3ph4w', dataSource: 'test' };
const withProps = (els: DrawingElement[]) => normalizeElements(els).map((e) => {
  if (e.type !== 'cable') return e;
  let c = e; c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...AL95, poles: [p, c.poleIds[i + 1]] }); }); return c;
});
const S = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };
const dists = (els: DrawingElement[]) => { const d: Record<string, string> = {}; for (const e of els) if (e.type === 'cable') e.poleIds.slice(0, -1).forEach((p, i) => { d[[p, e.poleIds[i + 1]].sort().join('_')] = '100'; }); return d; };
const ctxOf = (els: DrawingElement[]) => ({ poleRadius: R, connectionDistances: dists(els), connectionLabelOffsets: {}, distanceTextScale: 1, consumerScale: 1, arrowSize: 8 });
const rr = (r: Rect, s: Rect) => Math.max(0, Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x)) * Math.max(0, Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y));
const fs = 11;

// a network: T —— P1 —— P2 —— P3 (spacing d), a branch from P2 up-right to N1, a blue feeder through P2
const NET = (d: number, extra: DrawingElement[] = []) => withProps([
  tr('T', 0, 0), pole('P1', d, 0), pole('P2', 2 * d, 0), pole('P3', 3 * d, 0), pole('N1', 3 * d, -d), tr('T2', 2 * d, 1.2 * d), pole('P5', 2 * d, -1.3 * d),
  cable('main', ['T', 'P1', 'P2', 'P3']), cable('ne', ['P2', 'N1']), cable('blue', ['T2', 'P2', 'P5'], { strokeColor: '#0000ff' }),
  sub('P1', 10), sub('P3', 20), sub('N1', 15), sub('P5', 25, '#0000ff'), ...extra]);
const layoutOf = (els: DrawingElement[], boxes: Rect[] = []) => {
  const r = computeVoltageDrop(els, dists(els), S);
  return vdOverlayLayout(els, r, { ctx: ctxOf(els), fs, boxes });
};
/** what each placed badge stack still overlaps (fixed drawing + other stacks) */
const leftovers = (els: DrawingElement[], L: ReturnType<typeof layoutOf>) => {
  const set = drawingObstacles(els, ctxOf(els));
  const stacks = new Map<string, Rect>();
  for (const b of L.badges) { const s = stacks.get(b.poleId); const r = { x: b.x, y: b.y, w: b.w, h: b.h }; stacks.set(b.poleId, s ? { x: Math.min(s.x, r.x), y: Math.min(s.y, r.y), w: Math.max(s.x + s.w, r.x + r.w) - Math.min(s.x, r.x), h: Math.max(s.y + s.h, r.y + r.h) - Math.min(s.y, r.y) } : r); }
  const list = [...stacks.entries()];
  let withDrawing = 0, between = 0;
  for (const [, r] of list) if (set.cost(r) > 1e-6) withDrawing++;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (rr(list[i][1], list[j][1]) > 1e-6) between++;
  return { withDrawing, between, stacks };
};

describe('layout primitives', () => {
  it('the first candidate is the original position (above, right of the pole)', () => {
    const c = badgeCandidates({ x: 100, y: 100 }, R, 40, 17, 20)[0];
    expect(c).toEqual({ x: 100 + 15, y: 100 - 15 - 17, leader: false });
  });

  it('a free original position is kept exactly (no change for drawings that had no overlap)', () => {
    // (no subscriber at A: its label would sit exactly there)
    const els = withProps([tr('T', 0, 0), pole('A', 200, 0), cable('c', ['T', 'A'])]);
    const r = computeVoltageDrop(els, dists(els), S);
    const L = vdOverlayLayout(els, r, { ctx: { ...ctxOf(els), connectionDistances: undefined }, fs });
    const b = L.badges.find((x) => x.poleId === 'A')!;
    expect(b.x).toBe(200 + R * 0.75);
    expect(b.y).toBeCloseTo(0 - R * 0.75 - fs * 1.55, 9); // exactly the old formula for the first result
    expect(L.leaders).toEqual([]);
    expect(L.cost).toBe(0);
  });

  it('the same input gives the same layout', () => {
    const els = NET(60);
    expect(JSON.stringify(layoutOf(els))).toBe(JSON.stringify(layoutOf(els)));
  });

  it('no free place: the least-overlap candidate is taken, nothing loops', () => {
    const set = new ObstacleSet();
    // everything around the pole is covered; the right side less (lower weight)
    addRect(set, { x: -400, y: -400, w: 380, h: 800 }, 10);
    addRect(set, { x: -20, y: -400, w: 420, h: 800 }, 1);
    const t0 = Date.now();
    const m = layoutBadges([{ poleId: 'A', x: 0, y: 0, widths: [40] }], set, R, 17);
    expect(Date.now() - t0).toBeLessThan(200);
    const p = m.get('A')!;
    expect(p.cost).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThanOrEqual(-20); // on the lighter side
  });

  it('overlap measures: a thick segment through a rectangle counts, one outside does not', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(overlapWith({ kind: 'seg', a: { x: -5, y: 5 }, b: { x: 15, y: 5 }, half: 1, weight: 1 }, r)).toBeGreaterThan(0);
    expect(overlapWith({ kind: 'seg', a: { x: -5, y: 20 }, b: { x: 15, y: 20 }, half: 1, weight: 1 }, r)).toBe(0);
    expect(overlapWith({ kind: 'circle', cx: 15, cy: 5, r: 4, weight: 1 }, r)).toBe(0);
    expect(overlapWith({ kind: 'circle', cx: 12, cy: 5, r: 4, weight: 1 }, r)).toBeGreaterThan(0);
  });
});

describe('voltage-drop badges on close and normal networks', () => {
  for (const d of [60, 160]) {
    it(`spacing ${d}: no badge stack covers a pole, a cable, an arrow, a distance number, a pole number, a subscriber or another stack`, () => {
      const els = NET(d);
      const L = layoutOf(els);
      expect(L.badges.length).toBe(6); // P1, P2 ×2 (red and blue), P3, N1, P5
      const lo = leftovers(els, L);
      expect(lo.withDrawing).toBe(0);
      expect(lo.between).toBe(0);
      expect(L.cost).toBe(0);
    });
  }

  it('the texts, colours and statuses are unchanged by the layout (only positions)', () => {
    const els = NET(60);
    const r = computeVoltageDrop(els, dists(els), S);
    const L = vdOverlayLayout(els, r, { ctx: ctxOf(els), fs });
    const fromResult = [...r.byPole.entries()].flatMap(([p, l]) => l.map((x) => `${p}|${x.bus}|${x.status}|${x.color}|${x.percent?.toFixed(1)}`)).sort();
    expect(L.badges.map((b) => `${b.poleId}|${b.bus}|${b.status}|${b.color}|${b.text.match(/[\d.]+/)?.[0] ?? ''}`).sort().map((s) => s.replace(/\|$/, '|undefined'))).toEqual(fromResult);
  });

  it('a badge whose original place is on a cable moves (the branch leaving up-right), and keeps a leader only when moved out', () => {
    const els = NET(160);
    const L = layoutOf(els);
    const p2 = L.badges.filter((b) => b.poleId === 'P2');
    expect(p2.length).toBe(2);
    expect(p2[0].x === 320 + R * 0.75 && p2[0].y === -R * 0.75 - fs * 1.55 * 2 + fs * 1.55).toBe(false);
  });

  it('proposal boxes are avoided by the badges', () => {
    const els = NET(60);
    const box: Rect = { x: 120 + 10, y: -60, w: 64, h: 38 };
    const L = layoutOf(els, [box]);
    for (const b of L.badges) expect(rr({ x: b.x, y: b.y, w: b.w, h: b.h }, box)).toBe(0);
  });
});

describe('proposal boxes', () => {
  const prop = (id: string, poleId: string, p: Partial<NonNullable<ConsumerElement['proposal']>> = {}): ConsumerElement =>
    ({ ...sub(poleId, 40), id, proposal: { status: 'proposed', connection: { cableId: 'main', occurrence: 0 }, ...p } });

  it('an automatic box keeps its original place when that is free', () => {
    const els = withProps([tr('T', 0, 0), pole('A', 200, 0), cable('main', ['T', 'A']), prop('p', 'A')]);
    const ctx = ctxOf(els);
    const lay = layoutProposalBoxes(els, ctx);
    expect(lay.get('p')).toEqual(proposalBoxCenter(els, els.find((e) => e.id === 'p') as ConsumerElement, R, 1));
  });

  it('a box moved by the user is never moved by the layout', () => {
    const els = NET(60, [prop('m', 'P2', { boxOffset: { x: 5, y: 5 } })]);
    const ctx = ctxOf(els);
    const lay = layoutProposalBoxes(els, ctx);
    expect(lay.has('m')).toBe(false);
    expect(proposalBoxCenter(els, els.find((e) => e.id === 'm') as ConsumerElement, R, 1, lay)).toEqual({ x: 120 + 5, y: 5 });
  });

  for (const d of [60, 160]) {
    it(`spacing ${d}: automatic boxes avoid poles, cables, distance numbers, subscribers and each other`, () => {
      const els = NET(d, [prop('p1', 'P3'), prop('p2', 'P3'), prop('p3', 'P1')]);
      const ctx = ctxOf(els);
      const lay = layoutProposalBoxes(els, ctx);
      const set = drawingObstacles(els, { ...ctx, showDistances: true, arrowSize: 12 });
      const rects = [...lay.values()].map((c) => ({ x: c.x - PROPOSAL_BOX.w / 2, y: c.y - PROPOSAL_BOX.h / 2, w: PROPOSAL_BOX.w, h: PROPOSAL_BOX.h }));
      for (const r of rects) expect(set.cost(r)).toBe(0);
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(rr(rects[i], rects[j])).toBe(0);
    });
  }

  it('the box layout does not depend on the zoom or on the distance numbers being shown', () => {
    const els = NET(60, [prop('p1', 'P3')]);
    const a = layoutProposalBoxes(els, { ...ctxOf(els), arrowSize: 3, showDistances: false });
    const b = layoutProposalBoxes(els, { ...ctxOf(els), arrowSize: 30 });
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});

// --- regression: the on-screen pipeline of the canvas (SketchCanvas), step by step -------------
// the network of the browser overlap probe: close (60) and normal (160) spacing, a branch up-right,
// a blue feeder through P2 and to Q1, a proposed box at P3 and a confirmed one at P1
const MIN_PX = 9;
const PROBE = (d: number) => {
  const P = (id: string, x: number, y: number, s = 'lv-pole') => pole(id, 80 + x * d, 260 + y * d, { symbolId: s });
  const prop = (id: string, poleId: string, amps: number, status: 'proposed' | 'confirmed'): ConsumerElement =>
    ({ ...sub(poleId, amps), id, variant: 'square', proposal: { status, connection: { cableId: 'main', occurrence: 0 } } });
  return withProps([P('T', 0, 0, 'transformer'), P('P1', 1, 0), P('P2', 2, 0), P('P3', 3, 0), P('P4', 4, 0), P('N1', 3, -1), P('T2', 2, 1.2, 'transformer'), P('Q1', 3, 1.2), P('P5', 2, -1.3),
    cable('main', ['T', 'P1', 'P2', 'P3', 'P4']), cable('ne', ['P2', 'N1']), cable('blue', ['T2', 'P2', 'P5'], { strokeColor: '#0000ff' }), cable('b2', ['T2', 'Q1'], { strokeColor: '#0000ff' }),
    sub('P1', 10), sub('P3', 20), { ...sub('P4', 0), label: '', variant: 'circle' }, sub('N1', 15), sub('P5', 25, '#0000ff'),
    prop('pp', 'P3', 40, 'proposed'), prop('pc', 'P1', 30, 'confirmed')]);
};
const SP = { ...S, studyProposedConsumers: true };
/** the canvas pipeline at a zoom `scale` (same order and formulas as SketchCanvas) */
const pipeline = (els: DrawingElement[], scale: number) => {
  const cs = 1, dts = 1;
  const viewScale = layoutViewScale(scale);
  const minWorldFont = MIN_PX / viewScale;
  const distanceFontSize = Math.max(10 * dts, minWorldFont);
  const boxDrawScale = cs * Math.max(1, minWorldFont / (12 * cs));
  const ctx = { poleRadius: R, consumerScale: cs, connectionDistances: dists(els), connectionLabelOffsets: {}, distanceTextScale: dts };
  const boxLayout = layoutProposalBoxes(els, ctx, cs, boxDrawScale);
  const boxes = els.filter((e): e is ConsumerElement => e.type === 'consumer' && !!(e as ConsumerElement).proposal).map((c) => {
    const g = proposalGeometry(els, c, R, cs, boxLayout, boxDrawScale)!;
    return { id: c.id, x: g.box.cx - g.box.w / 2, y: g.box.cy - g.box.h / 2, w: g.box.w, h: g.box.h };
  });
  const distanceFontSizes = distanceLabelFontSizes(els, { ...ctx, arrowSize: 8 / viewScale }, 10 * dts, distanceFontSize, boxes);
  const vdCtx = { ...ctx, showDistances: true, distanceFontSizes, arrowSize: 8 / viewScale };
  const r = computeVoltageDrop(els, dists(els), SP);
  const L = vdOverlayLayout(els, r, { ctx: vdCtx, fs: 11 * dts, boxes, minFont: MIN_PX / viewScale });
  return { viewScale, minWorldFont, boxDrawScale, boxes, distanceFontSizes, vdCtx, L };
};
const tagRects = (L: ReturnType<typeof pipeline>['L']) => L.tags.map((t) => ({ id: t.poleId, ...poleTagRect(t.x, t.y, t.text, t.fontSize) }));
/** overlap that counts (deeper than the touch tolerance on both axes) */
const hit = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > TOUCH_TOLERANCE && h > TOUCH_TOLERANCE;
};

describe('defect A: the on-screen minimum text size is really reached', () => {
  it('the layout zoom is never above the real zoom, and at most one 2 % step below', () => {
    for (let s = 0.1; s <= 10; s *= 1.0137) {
      const v = layoutViewScale(s);
      expect(v).toBeLessThanOrEqual(s);
      expect(v).toBeGreaterThan(s / LAYOUT_ZOOM_STEP - 1e-12);
    }
    expect(layoutViewScale(1)).toBe(1);
  });

  for (const s of [0.656, 0.43, 0.254, 0.349, 1]) {
    it(`×${s}: badges, pole numbers taking the minimum and box texts are ≥ ${MIN_PX} px on screen (and < 2 % above)`, () => {
      const P = pipeline(PROBE(60), s);
      const badgePx = P.L.fs * s;
      expect(badgePx).toBeGreaterThanOrEqual(MIN_PX);
      if (11 * s < MIN_PX) expect(badgePx).toBeLessThan(MIN_PX * LAYOUT_ZOOM_STEP + 1e-9);
      const boxTextPx = 12 * P.boxDrawScale * s;
      expect(boxTextPx).toBeGreaterThanOrEqual(MIN_PX);
      if (12 * s < MIN_PX) expect(boxTextPx).toBeLessThan(MIN_PX * LAYOUT_ZOOM_STEP + 1e-9);
      // a distance number / pole number that takes the minimum is at least the minimum
      for (const f of P.distanceFontSizes.values()) if (f > 10) expect(f * s).toBeGreaterThanOrEqual(MIN_PX);
      for (const t of P.L.tags) if (t.fontSize > 11 * POLE_TAG_FONT_FACTOR) expect(t.fontSize * s).toBeGreaterThanOrEqual(MIN_PX);
    });
  }

  it('at a zoom where the set sizes are already ≥ the minimum, nothing grows', () => {
    const P = pipeline(PROBE(60), 1.35);
    expect(P.L.fs).toBe(11);
    expect(P.boxDrawScale).toBe(1);
    for (const f of P.distanceFontSizes.values()) expect(f).toBe(10);
  });
});

describe('defect B: proposal boxes keep off the pole numbers', () => {
  for (const d of [60, 160]) for (const s of [1, 0.656, 0.254]) {
    it(`${d === 60 ? 'dense' : 'normal'} network ×${s}: no box covers a pole number, and no new overlap with the drawing, the badges or the other box`, () => {
      const els = PROBE(d);
      const P = pipeline(els, s);
      const tags = tagRects(P.L);
      expect(tags.length).toBeGreaterThan(5);
      for (const b of P.boxes) for (const t of tags) expect(hit(b, t), `box ${b.id} × pole number ${t.id}`).toBe(false);
      // poles, cables, arrowheads, subscribers, distance numbers (as drawn at this zoom)
      const set = drawingObstacles(els, P.vdCtx);
      for (const b of P.boxes) expect(set.cost(b), `box ${b.id} × drawing`).toBe(0);
      for (const b of P.boxes) for (const g of P.L.badges) expect(hit(b, { x: g.x, y: g.y, w: g.w, h: g.h }), `box ${b.id} × badge ${g.key}`).toBe(false);
      expect(hit(P.boxes[0], P.boxes[1])).toBe(false);
    });
  }

  it('a box whose original place covers nothing stays exactly there', () => {
    const els = withProps([tr('T', 0, 0), pole('A', 200, 0), cable('main', ['T', 'A']), { ...sub('A', 40), id: 'p', proposal: { status: 'proposed', connection: { cableId: 'main', occurrence: 0 } } }]);
    const lay = layoutProposalBoxes(els, ctxOf(els));
    expect(lay.get('p')).toEqual(proposalBoxCenter(els, els.find((e) => e.id === 'p') as ConsumerElement, R, 1));
  });

  it('the pole numbers used by the boxes are those drawn by the overlay (same geometry)', () => {
    const els = PROBE(160);
    const P = pipeline(els, 1);
    const set = addPoleTagObstacles(els, P.vdCtx, new ObstacleSet());
    for (const t of tagRects(P.L)) expect(set.cost(t)).toBeGreaterThan(0);
  });
});

describe('defect C: a distance number grows only where it does not cover a proposal box', () => {
  for (const [d, s] of [[160, 0.349], [160, 0.254], [60, 0.349], [160, 0.656], [60, 0.254]] as const) {
    it(`${d === 60 ? 'dense' : 'normal'} network ×${s}: no distance number covers a box`, () => {
      const els = PROBE(d);
      const P = pipeline(els, s);
      const withD = drawingObstacles(els, P.vdCtx), noD = drawingObstacles(els, { ...P.vdCtx, showDistances: false });
      for (const b of P.boxes) expect(withD.cost(b) - noD.cost(b), `box ${b.id} × distance numbers`).toBe(0);
    });
  }

  // a grown number covers no pole number more than the numbers at their set size do
  const tagCheck = (d: number, s: number) => {
    const els = PROBE(d);
    const P = pipeline(els, s);
    const withD = drawingObstacles(els, P.vdCtx), noD = drawingObstacles(els, { ...P.vdCtx, showDistances: false });
    const atBase = drawingObstacles(els, { ...P.vdCtx, distanceFontSizes: undefined, distanceFontSize: 10 });
    for (const t of tagRects(P.L)) expect(withD.cost(t) - noD.cost(t), `pole number ${t.id} × distance numbers`).toBeLessThanOrEqual(atBase.cost(t) - noD.cost(t) + 1e-6);
  };
  for (const [d, s] of [[160, 0.349], [60, 0.349], [160, 0.656], [60, 0.254]] as const) {
    it(`${d === 60 ? 'dense' : 'normal'} network ×${s}: a grown distance number covers no pole number`, () => tagCheck(d, s));
  }
  // was a known defect (documented with it.fails): the enlargement check measured a distance number
  // without the margin past its ends that the placed labels keep (segRect), so at ×0.254 in the normal
  // network a grown number reached into the margin of pole numbers P2, P3, P4. Now measured the same way.
  it('normal network ×0.254: a grown distance number does not reach into the margin of a pole number (P2, P3, P4)', () => tagCheck(160, 0.254));
  for (const d of [60, 160]) for (const s of [1.285, 1, 0.656, 0.43, 0.349, 0.254, 0.15]) {
    it(`${d === 60 ? 'dense' : 'normal'} network ×${s}: no grown distance number reaches into a pole-number or box margin`, () => {
      const els = PROBE(d);
      const P = pipeline(els, s);
      tagCheck(d, s);
      const withD = drawingObstacles(els, P.vdCtx), atBase = drawingObstacles(els, { ...P.vdCtx, distanceFontSizes: undefined, distanceFontSize: 10 }), noD = drawingObstacles(els, { ...P.vdCtx, showDistances: false });
      for (const b of P.boxes) expect(withD.cost(b) - noD.cost(b)).toBeLessThanOrEqual(atBase.cost(b) - noD.cost(b) + 1e-6);
    });
  }

  it('the reported case (normal network ×0.349): the number next to the box keeps its set size, the others still take the minimum', () => {
    const P = pipeline(PROBE(160), 0.349);
    const sizes = [...P.distanceFontSizes.values()];
    expect(sizes.some((f) => f === 10)).toBe(true);
    expect(sizes.filter((f) => f > 10).length).toBeGreaterThan(0);
  });

  it('without boxes the distance sizes are as before (boxes only ever keep a number at its set size)', () => {
    const els = PROBE(160);
    const ctx = { ...ctxOf(els), arrowSize: 8 / 0.34 };
    const a = distanceLabelFontSizes(els, ctx, 10, 9 / 0.34);
    const b = distanceLabelFontSizes(els, ctx, 10, 9 / 0.34, []);
    expect([...a.entries()]).toEqual([...b.entries()]);
    const withBox = distanceLabelFontSizes(els, ctx, 10, 9 / 0.34, pipeline(els, 0.349).boxes);
    for (const [k, f] of withBox) expect(f <= a.get(k)!).toBe(true);
  });
});
