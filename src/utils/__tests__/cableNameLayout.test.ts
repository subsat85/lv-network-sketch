import { describe, expect, it } from 'vitest';
import { createCableType, editCableType, latestRevision } from '../cableTypeModel';
import { linkSpanCable, unlinkSpanCable } from '../spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';
import { cableOffsetLines } from '../cableLayout';
import { cableNameLayout, cableNameLayoutWithTags, cableNameOf, cableNameSpans, cableSizeOf } from '../cableNameLayout';
import { addPoleTagObstacles, drawingObstacles, distanceLabelPositions, segmentCost, ObstacleSet, addSegment, poleTagAnchor, poleTagRect, POLE_TAG_FONT_FACTOR, type LayoutContext } from '../overlayLayout';
import { poleTag } from '../poleNames';
import { vdOverlayLayout } from '../vdOverlayLayout';
import { voltageView } from '../e2Presentation';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import type { CableElement, DrawingElement } from '../../types/drawing';
import type { CableTypeData } from '../../types/cableType';

// The conductor size of linked library cables beside their spans: read at display time from the name in
// the span's snapshot only (cableSizeOf), placement (along the span, readable, away from the other marks),
// and nothing else changed. ALL VALUES SYNTHETIC.

const v = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'unverified' } }) as never;
const data = (name: string): CableTypeData => ({
  name, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 120 }, neutral: { material: 'al', sectionMm2: 70 },
  r: v(0.2145, 'unspecified'), x: v(0.0716, 'ac-50hz'), rn: v(0.4126, 'unspecified'), xn: v(0.0754, 'ac-50hz'), source: { name: 'synthetic' },
} as CableTypeData);
const T1 = createCableType('ct_a', data('ABC 3x120+70 (synthetic)'), { now: 1 });
const REV1 = latestRevision(T1);
const REV2 = latestRevision(editCableType(T1, { name: 'ABC 3×150+70 rev B (synthetic)' }, { now: 2 }).history);
const OTHER = latestRevision(createCableType('ct_b', data('ABC 3x70+54 (synthetic)'), { now: 3 }));

const pole = (id: string, x: number, y: number, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x, y, width: 40, height: 40, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 }) as DrawingElement;
/** a transformer T; a horizontal, a vertical and a diagonal span from A; subscribers; two cables */
const drawing = (): DrawingElement[] => normalizeElements([
  pole('T', -120, 0, 'transformer'), pole('A', 200, 0), pole('B', 200, 180), pole('C', 360, 300), pole('D', 200, -170),
  { id: 'k', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A', 'B', 'C'], cableIndex: 0, offset: 0, strokeColor: '#e11d48', fillColor: 'none', strokeWidth: 2 } as CableElement,
  { id: 'q', type: 'cable', x: 0, y: 0, poleIds: ['A', 'D'], cableIndex: 1, offset: 0, strokeColor: '#2563eb', fillColor: 'none', strokeWidth: 2 } as CableElement,
  { id: 's1', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#e11d48', count: 3, variant: 'circle', label: '', strokeColor: '#e11d48', fillColor: '#e11d48', strokeWidth: 2 } as DrawingElement,
  { id: 's2', type: 'consumer', x: 0, y: 0, poleId: 'C', color: '#e11d48', count: 1, variant: 'square', label: '40', strokeColor: '#e11d48', fillColor: '#e11d48', strokeWidth: 2 } as DrawingElement,
]);
const link = (els: DrawingElement[], cableId: string, index: number, rev = REV1) => els.map((e) => {
  if (e.id !== cableId) return e;
  const c = e as CableElement;
  const { id, props } = spanAt(c, index);
  return withSpanProps(c, id!, linkSpanCable(props, [c.poleIds[index], c.poleIds[index + 1]], rev, 1));
});
const DIST = { A_T: '120', A_B: '90', B_C: '75', A_D: '85' };
const POLE_RADIUS = 20; // as the canvas and the preview
const ctx: LayoutContext = { poleRadius: POLE_RADIUS, consumerScale: 1, connectionDistances: DIST, distanceTextScale: 1, showDistances: true, arrowSize: 8 };
const FS = 9;
const lay = (els: DrawingElement[]) => cableNameLayout(els, { ctx, fs: FS });
const allLinked = () => link(link(link(link(drawing(), 'k', 0), 'k', 1), 'k', 2, OTHER), 'q', 0);

describe('the size read from a cable name (display only)', () => {
  it.each([
    ['ABC 3×120+70 (synthetic)', '3×120'],
    ['ABC 3x70+35', '3x70'],
    ['ABC 3x95+70', '3x95'],
    ['ABC 3x50', '3x50'],
    ['ABC 3 x 70+35', '3x70'], // spaces around the sign
    ['ABC 3 × 120 + 70', '3×120'],
    ['ABC 3X95+70', '3X95'],
    ['4x16', '4x16'],
    ['NYY 4x2.5', '4x2.5'], // a decimal section
    ['NYY 3x2,5+1,5', '3x2,5'],
    ['ABC 3x120mm²+70', '3x120'], // a unit after the section
    ['NA2XY 1x240 (single core)', '1x240'], // «2XY» is not a size
    ['ABC 3x70+54.6 then 3x120', '3x70'], // the FIRST size
    ['كابل ABC 3×120+70', '3×120'],
  ])('%s → %s', (name, size) => expect(cableSizeOf(name)).toBe(size));
  it.each([
    ['ABC'], ['ABC cable (synthetic)'], [''], ['   '], ['3x'], ['x120'], ['ABC 0x120'], ['ABC 3x0'],
    ['ABC 13x120'], // 13 conductors: not read with confidence
    ['ABC 3x12345'], // section too long
    ['A3x120'], ['3x120A'], ['3x120.5.5'],
  ])('no size in «%s»: no label', (name) => expect(cableSizeOf(name)).toBeUndefined());
  it('not a text: nothing', () => {
    for (const v of [undefined, null, 120, {}, ['3x120']]) expect(cableSizeOf(v)).toBeUndefined();
  });
  it('the name, the snapshot and the library data are not changed', () => {
    const before = JSON.stringify(REV1);
    expect(cableSizeOf(REV1.name)).toBe('3x120');
    expect(JSON.stringify(REV1)).toBe(before);
    expect(REV1.name).toBe('ABC 3x120+70 (synthetic)');
  });
});

describe('the text: the size in the name of the span\'s snapshot, only for a valid link', () => {
  it('linked spans get their cable\'s name in the cable\'s colour; unlinked spans get none', () => {
    const L = lay(link(drawing(), 'k', 1));
    expect(L.map((l) => [l.key, l.text, l.color])).toEqual([['k#1', '3x120', '#e11d48']]);
    expect(lay(drawing())).toEqual([]);
  });
  it('a linked cable whose name has no size: no label for that span (the others keep theirs)', () => {
    const NOSIZE = latestRevision(createCableType('ct_n', data('ABC overhead (synthetic)'), { now: 4 }));
    const L = lay(link(link(drawing(), 'k', 0, NOSIZE), 'k', 1));
    expect(L.map((l) => [l.key, l.text])).toEqual([['k#1', '3x120']]);
  });
  it('a damaged link (no readable snapshot) gets no label; nothing is looked up or invented', () => {
    expect(cableNameOf(undefined)).toBeUndefined();
    expect(cableNameOf({ poles: ['A', 'B'], cableType: { typeId: 'ct_a', revision: 1 } as never })).toBeUndefined();
    expect(cableNameOf({ poles: ['A', 'B'], rOhmPerKm: 0.5 })).toBeUndefined();
  });
  it('changing the linked cable (another type, or another revision) changes the label; unlinking removes it', () => {
    const a = link(drawing(), 'k', 1);
    expect(lay(a)[0].text).toBe('3x120');
    expect(lay(link(a, 'k', 1, OTHER))[0].text).toBe('3x70');
    expect(lay(link(a, 'k', 1, REV2))[0].text).toBe('3×150');
    const c = a.find((e) => e.id === 'k') as CableElement;
    const { id, props } = spanAt(c, 1);
    const un = a.map((e) => (e.id === 'k' ? withSpanProps(c, id!, unlinkSpanCable(props!)) : e));
    expect(lay(un)).toEqual([]);
  });
  it('the snapshot is used as it is: a later library revision does not change a span linked to an earlier one', () => {
    // the span keeps REV1's snapshot; the library now has REV2 — the label stays REV1's name
    expect(lay(link(drawing(), 'k', 1, REV1))[0].text).toBe('3x120');
  });
});

describe('placement', () => {
  const L = lay(allLinked());
  const byKey = new Map(L.map((l) => [l.key, l]));
  it('the first and the last span of each run of one size (cableNameSpans): k 3x120 on T–A and A–B, k 3x70 on B–C, q 3x120 on A–D', () => {
    // k: T–A and A–B are 3x120 (a run of two: first and last), B–C is 3x70 (alone); q: A–D is 3x120 (alone)
    expect(L.map((l) => [l.key, l.text]).sort()).toEqual([['k#0', '3x120'], ['k#1', '3x120'], ['k#2', '3x70'], ['q#0', '3x120']]);
  });
  it('plain text: no leader line or frame in the layout', () => {
    for (const l of L) expect(Object.keys(l).sort()).toEqual(['a', 'angle', 'b', 'cableId', 'color', 'cost', 'fontSize', 'half', 'index', 'key', 'text', 'x', 'y']);
  });
  it('the text runs along its span and reads left to right (horizontal, vertical, diagonal)', () => {
    expect(byKey.get('k#0')!.angle).toBeCloseTo(0, 6); // horizontal
    expect(Math.abs(byKey.get('q#0')!.angle)).toBeCloseTo(90, 6); // vertical
    expect(Math.abs(byKey.get('k#2')!.angle)).toBeCloseTo((Math.atan2(120, 160) * 180) / Math.PI, 6); // diagonal
    for (const l of L) expect(l.angle).toBeGreaterThanOrEqual(-90), expect(l.angle).toBeLessThanOrEqual(90);
  });
  it('covers nothing: poles, cables, subscribers and their labels, distance numbers, pole numbers, the other names', () => {
    const set = drawingObstacles(allLinked(), ctx);
    addPoleTagObstacles(allLinked(), ctx, set);
    for (const l of L) expect(segmentCost(set, l.a, l.b, l.half), l.key).toBe(0);
    for (const l of L) {
      const others = new ObstacleSet();
      for (const o of L) if (o !== l) addSegment(others, o.a, o.b, o.half);
      expect(segmentCost(others, l.a, l.b, l.half), l.key).toBe(0);
    }
    for (const l of L) expect(l.cost).toBe(0);
  });
  it('next to its cable, on the side away from the span\'s distance number', () => {
    const dist = new Map(distanceLabelPositions(allLinked(), ctx).map((d) => [d.key, d]));
    const P: Record<string, [number, number]> = { T: [-120, 0], A: [200, 0], B: [200, 180], C: [360, 300], D: [200, -170] };
    const cases: [string, string, string, string][] = [['k#0', 'A_T', 'T', 'A'], ['k#2', 'B_C', 'B', 'C'], ['q#0', 'A_D', 'A', 'D']];
    for (const [k, dk, pa, pb] of cases) {
      const l = byKey.get(k)!, d = dist.get(dk)!;
      const [a, b] = [P[pa], P[pb]];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ux = b[0] - a[0], uy = b[1] - a[1], n = Math.hypot(ux, uy);
      const side = (x: number, y: number) => ((x - mx) * -uy + (y - my) * ux) / n;
      expect(Math.sign(side(l.x, l.y)), k).toBe(-Math.sign(side(d.x, d.y)));
      expect(Math.abs(side(l.x, l.y)), k).toBeLessThan(FS * 2.6); // just beside the cable
    }
  });
  it('deterministic, and the same at the same zoom step (stable when panning)', () => {
    expect(lay(allLinked())).toEqual(L);
  });
  it('a transformer is avoided as drawn (its circles and rectangle); on this tight span pole A\'s number moves a little to make room', () => {
    const els = link(normalizeElements([pole('T', 0, 0, 'transformer'), pole('A', 130, 0),
      { id: 'k', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 0, offset: 0, strokeColor: '#e11d48', fillColor: 'none', strokeWidth: 2 } as CableElement]), 'k', 0);
    const C = { ...ctx, connectionDistances: { A_T: '45' } };
    const { labels: [l], tagShifts } = cableNameLayoutWithTags(els, { ctx: C, fs: 12 });
    expect(l.cost).toBe(0);
    expect(l.arrow).toBeUndefined(); // beside its cable: no arrow needed
    expect(Math.abs(l.y)).toBeLessThan(12 * 2.6);
    // only pole A's number moved, by a little, to a place that covers nothing (nor the name)
    expect([...tagShifts.keys()]).toEqual(['A']);
    const m = tagShifts.get('A')!;
    expect(Math.hypot(m.dx, m.dy)).toBeLessThan(11 * POLE_TAG_FONT_FACTOR * 1.4 * 2.3);
    const a0 = poleTagAnchor({ x: 130, y: 0 }, POLE_RADIUS, 11);
    const r0 = poleTagRect(a0.x, a0.y, poleTag(els)('A'), 11 * POLE_TAG_FONT_FACTOR);
    const moved = { ...r0, x: r0.x + m.dx, y: r0.y + m.dy };
    const set = drawingObstacles(els, C); addSegment(set, l.a, l.b, l.half);
    expect(set.cost(moved)).toBe(0);
    const R = POLE_RADIUS, o = new ObstacleSet();
    o.add({ kind: 'circle', cx: 0, cy: -0.8 * R, r: R, weight: 1 }); o.add({ kind: 'circle', cx: 0, cy: 0.8 * R, r: R, weight: 1 });
    o.add({ kind: 'rect', x: 1.2 * R, y: -1.8 * R, w: R, h: 3.6 * R, weight: 1 });
    expect(segmentCost(o, l.a, l.b, l.half)).toBe(0);
  });
});

describe('short spans: the set size, the pole numbers moved, or a short arrow — only where needed', () => {
  const one = (Lspan: number, dir: 'h' | 'v' | 'd', n = 1) => {
    const at = (k: number): [number, number] => (dir === 'h' ? [k, 0] : dir === 'v' ? [0, k] : [k * 0.8, k * 0.6]);
    let els = normalizeElements([pole('P', 0, 0), pole('Q', ...at(Lspan)), pole('R', ...at(Lspan + 220)),
      ...Array.from({ length: n }, (_, j) => ({ id: `c${j}`, type: 'cable', x: 0, y: 0, poleIds: ['P', 'Q'], cableIndex: j, offset: 0, strokeColor: ['#e11d48', '#2563eb', '#10b981'][j], fillColor: 'none', strokeWidth: 2 }) as CableElement),
      { id: 'z', type: 'cable', x: 0, y: 0, poleIds: ['Q', 'R'], cableIndex: 9, offset: 0, strokeColor: '#000000', fillColor: 'none', strokeWidth: 2 } as CableElement]);
    for (let j = 0; j < n; j++) els = link(els, `c${j}`, 0, j === 1 ? OTHER : REV1);
    const C = { ...ctx, connectionDistances: { P_Q: '10', Q_R: '50' } };
    return { els, C, r: cableNameLayoutWithTags(els, { ctx: C, fs: FS, minFs: 7 }) };
  };
  for (const dir of ['h', 'v', 'd'] as const) {
    it(`a short ${dir === 'h' ? 'horizontal' : dir === 'v' ? 'vertical' : 'diagonal'} span: the name keeps its size and gets a short arrow to the visible part of its cable; nothing covered`, () => {
      const { els, C, r } = one(60, dir);
      const [l] = r.labels;
      expect(l.fontSize).toBe(FS); // not shrunk
      expect(l.arrow).toBeDefined();
      expect(l.cost).toBe(0);
      const { from, to } = l.arrow!;
      expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThan(FS * 3.5); // short
      // it points at the cable between the two poles, outside both pole circles
      const Q = els.find((e) => e.id === 'Q')!;
      for (const p of [{ x: 0, y: 0 }, Q]) expect(Math.hypot(to.x - p.x, to.y - p.y)).toBeGreaterThan(POLE_RADIUS);
      const ux = Q.x / 60, uy = Q.y / 60, along = to.x * ux + to.y * uy, across = -to.x * uy + to.y * ux;
      expect(along).toBeGreaterThan(POLE_RADIUS); expect(along).toBeLessThan(60 - POLE_RADIUS);
      expect(Math.abs(across)).toBeLessThan(6); // at the cable
      // the name and the arrow cover nothing
      const set = drawingObstacles(els, C); addPoleTagObstacles(els, C, set);
      expect(segmentCost(set, l.a, l.b, l.half)).toBe(0);
    });
  }
  it('a span with room (long, or several parallel cables that fit beside): no arrow', () => {
    for (const l of lay(allLinked())) expect(l.arrow, l.key).toBeUndefined();
    const { r } = one(60, 'v', 3);
    expect(r.labels.length).toBe(3);
    for (const l of r.labels) { expect(l.arrow).toBeUndefined(); expect(l.cost).toBe(0); expect(l.fontSize).toBe(FS); }
    expect(one(140, 'h').r.labels[0].arrow).toBeUndefined();
  });
  it('poles touching (no cable visible between them): no arrow into a pole', () => {
    const { r } = one(40, 'h');
    expect(r.labels[0].arrow).toBeUndefined();
  });
  it('nothing moves on spans with room: no pole number moved', () => {
    expect(cableNameLayoutWithTags(allLinked(), { ctx, fs: FS }).tagShifts.size).toBe(0);
  });
});

describe('parallel cables: one aligned stack, in the cables\' order', () => {
  // five parallel cables in different colours over two spans (as on the site drawing), each one size
  const COLORS = ['#10b981', '#000000', '#3b82f6', '#f59e0b', '#38bdf8'];
  const REVS = [REV1, OTHER, REV1, REV1, REV1];
  const build = (dir: 'v' | 'h' | 'd') => {
    const at = (k: number) => (dir === 'v' ? [0, k * 150] : dir === 'h' ? [k * 150, 0] : [k * 110, k * 100]) as [number, number];
    let els = normalizeElements([pole('P', ...at(0)), pole('Q', ...at(1)), pole('S', ...at(2)),
      ...COLORS.map((col, j) => ({ id: `c${j}`, type: 'cable', x: 0, y: 0, poleIds: ['P', 'Q', 'S'], cableIndex: j, offset: 0, strokeColor: col, fillColor: 'none', strokeWidth: 2 }) as CableElement),
      { id: 'u1', type: 'consumer', x: 0, y: 0, poleId: 'Q', color: COLORS[1], count: 1, variant: 'square', label: '50', strokeColor: COLORS[1], fillColor: COLORS[1], strokeWidth: 2 } as DrawingElement]);
    COLORS.forEach((_, j) => { els = link(link(els, `c${j}`, 0, REVS[j]), `c${j}`, 1, REVS[j]); });
    return els;
  };
  const C2: LayoutContext = { ...ctx, connectionDistances: { P_Q: '40', Q_S: '40' } };
  for (const dir of ['v', 'h', 'd'] as const) {
    it(`${dir === 'v' ? 'vertical' : dir === 'h' ? 'horizontal' : 'diagonal'} span: one label per cable on its first and its last span, one side, same place along the span, equal spacing, same order as the cables, nothing covered`, () => {
      const els = build(dir);
      const ALL = cableNameLayout(els, { ctx: C2, fs: FS });
      // every cable runs P–Q–S with one size: a label on its first span (P–Q) and its last (Q–S), nothing else
      expect(ALL.length).toBe(10);
      expect(ALL.map((l) => l.key).sort()).toEqual(COLORS.flatMap((_, j) => [`c${j}#0`, `c${j}#1`]).sort());
      for (const index of [0, 1]) expect(ALL.filter((l) => l.index === index).map((l) => [l.cableId, l.color, l.text]).sort()).toEqual(COLORS.map((col, j) => [`c${j}`, col, REVS[j] === OTHER ? '3x70' : '3x120']).sort());
      // the stack on the first span (the one on the last span is checked the same way below)
      const L = ALL.filter((l) => l.index === 0);
      // the span's axes
      const [P, Q] = ['P', 'Q'].map((id) => els.find((e) => e.id === id)!);
      const ux = (Q.x - P.x) / Math.hypot(Q.x - P.x, Q.y - P.y), uy = (Q.y - P.y) / Math.hypot(Q.x - P.x, Q.y - P.y), nx = -uy, ny = ux;
      const along = L.map((l) => l.x * ux + l.y * uy), across = L.map((l) => l.x * nx + l.y * ny);
      // the same place along the span, the same font
      for (const a of along) expect(a).toBeCloseTo(along[0], 6);
      expect(new Set(L.map((l) => l.fontSize)).size).toBe(1);
      // one side of the bundle, equal spacing
      const mid = (P.x + Q.x) / 2 * nx + (P.y + Q.y) / 2 * ny;
      const sides = new Set(across.map((v) => Math.sign(v - mid)));
      expect(sides.size).toBe(1);
      const sorted = [...across].sort((p, q) => p - q);
      const gaps = sorted.slice(1).map((v, k) => v - sorted[k]);
      for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
      expect(gaps[0]).toBeGreaterThan(L[0].half * 2); // never on top of each other
      // the labels' order across the span is the cables' order across the span (as drawn)
      const cableAcross = new Map(COLORS.map((_, j) => {
        const c = els.find((e) => e.id === `c${j}`) as CableElement;
        const line = cableOffsetLines(c, els)[L[0].index];
        return [`c${j}`, ((line.p1.x + line.p2.x) / 2) * nx + ((line.p1.y + line.p2.y) / 2) * ny] as [string, number];
      }));
      const labelOrder = L.map((l, k) => [l.cableId, across[k]] as const).sort((p, q) => p[1] - q[1]).map((x) => x[0]);
      const cableOrder = [...cableAcross].sort((p, q) => p[1] - q[1]).map((x) => x[0]);
      expect(labelOrder).toEqual(cableOrder);
      // nothing covered, no arrows (there is room)
      for (const l of ALL) { expect(l.cost).toBe(0); expect(l.arrow).toBeUndefined(); }
      const set = drawingObstacles(els, C2);
      addPoleTagObstacles(els, C2, set);
      for (const l of ALL) expect(segmentCost(set, l.a, l.b, l.half), l.key).toBe(0);
      // the stack on the last span: the same font, place along the span, one side, the cables' order
      const [, Q2, S2] = ['P', 'Q', 'S'].map((id) => els.find((e) => e.id === id)!);
      const vx = (S2.x - Q2.x) / Math.hypot(S2.x - Q2.x, S2.y - Q2.y), vy = (S2.y - Q2.y) / Math.hypot(S2.x - Q2.x, S2.y - Q2.y);
      const M = ALL.filter((l) => l.index === 1);
      const along2 = M.map((l) => l.x * vx + l.y * vy);
      for (const a of along2) expect(a).toBeCloseTo(along2[0], 6);
      expect(new Set(M.map((l) => l.fontSize))).toEqual(new Set(L.map((l) => l.fontSize)));
      const across2 = M.map((l) => l.x * -vy + l.y * vx);
      const mid2 = (Q2.x + S2.x) / 2 * -vy + (Q2.y + S2.y) / 2 * vx;
      expect(new Set(across2.map((x) => Math.sign(x - mid2))).size).toBe(1);
      expect(M.map((l, k) => [l.cableId, across2[k]] as const).sort((p, q) => p[1] - q[1]).map((x) => x[0])).toEqual(labelOrder);
    });
  }
  it('two cables with different sizes on different spans: each size once, on its own span', () => {
    let els = build('v');
    els = link(els, 'c0', 1, OTHER); // c0: 3x120 on P–Q, 3x70 on Q–S
    const L = cableNameLayout(els, { ctx: C2, fs: FS }).filter((l) => l.cableId === 'c0');
    expect(L.map((l) => [l.index, l.text]).sort()).toEqual([[0, '3x120'], [1, '3x70']]);
  });
});

describe('visual only: the voltage-drop badges avoid the names; results, data and geometry unchanged', () => {
  const els = allLinked();
  const d = { elements: els, connectionDistances: DIST, distanceFlags: {}, electrical: DEFAULT_ELECTRICAL };
  it('E2 results do not depend on the labels', () => {
    const before = JSON.stringify(voltageView(d).study.circuits);
    lay(els);
    expect(JSON.stringify(voltageView(d).study.circuits)).toBe(before);
  });
  it('the badges are placed around the names (no overlap with them)', () => {
    const L = lay(els);
    const r = voltageView(d);
    const V = vdOverlayLayout(els, r, { ctx, fs: 11, texts: L });
    expect(V.badges.length).toBeGreaterThan(0);
    const o = new ObstacleSet();
    for (const l of L) addSegment(o, l.a, l.b, l.half);
    for (const b of V.badges) expect(o.cost({ x: b.x, y: b.y, w: b.w, h: b.h })).toBe(0);
  });
  it('the layout does not change the drawing (elements are not modified)', () => {
    const snap = JSON.stringify(els);
    lay(els);
    expect(JSON.stringify(els)).toBe(snap);
  });
});

describe('cableNameSpans: the first and the last span of each run (by the network\'s topology)', () => {
  // ALL VALUES SYNTHETIC. A network is poles + cables {id, poles, color, sizes}; a size of '' leaves the span unlinked.
  const revs: Record<string, ReturnType<typeof latestRevision>> = {};
  const R = (s: string) => (revs[s] ??= latestRevision(createCableType(`ct${s}`, data(`ABC 3x${s}+70 (synthetic)`), { now: 1 })));
  type C = { id: string; poles: string[]; color?: string; sizes: string[] };
  const net = (poles: [string, number, number, string?][], cables: C[]) => {
    let els = normalizeElements([...poles.map(([id, x, y, sym]) => pole(id, x, y, sym)),
      ...cables.map((c, j) => ({ id: c.id, type: 'cable', x: 0, y: 0, poleIds: c.poles, cableIndex: j, offset: 0, strokeColor: c.color ?? '#e11d48', fillColor: 'none', strokeWidth: 2 }) as CableElement)]);
    for (const c of cables) c.sizes.forEach((s, i) => { if (s) els = link(els, c.id, i, R(s)); });
    return els;
  };
  const spans = (els: DrawingElement[]) => cableNameSpans(els).map((s) => `${s.cable.id}#${s.index}=${s.text}`).sort();
  const line = (n: number): [string, number, number][] => Array.from({ length: n + 1 }, (_, i) => [`P${i}`, 0, i * 150]);
  const ids = (n: number) => Array.from({ length: n + 1 }, (_, i) => `P${i}`);

  it('a straight run of six spans with one cable and one size: the first and the last span only', () => {
    expect(spans(net(line(6), [{ id: 'k', poles: ids(6), sizes: Array(6).fill('120') }]))).toEqual(['k#0=3x120', 'k#5=3x120']);
  });
  it('the same run drawn in reverse order: the same two end spans', () => {
    expect(spans(net(line(6), [{ id: 'k', poles: ids(6).reverse(), sizes: Array(6).fill('120') }]))).toEqual(['k#0=3x120', 'k#5=3x120']);
  });
  it('one size change: each size on the first and last span of its own run, never on the other run', () => {
    expect(spans(net(line(6), [{ id: 'k', poles: ids(6), sizes: ['120', '120', '120', '70', '70', '70'] }])))
      .toEqual(['k#0=3x120', 'k#2=3x120', 'k#3=3x70', 'k#5=3x70']);
  });
  it('several size changes (3x120 ×3, 3x70 ×2, 3x50 ×1): 3x120 twice, 3x70 twice, 3x50 once', () => {
    expect(spans(net(line(6), [{ id: 'k', poles: ids(6), sizes: ['120', '120', '120', '70', '70', '50'] }])))
      .toEqual(['k#0=3x120', 'k#2=3x120', 'k#3=3x70', 'k#4=3x70', 'k#5=3x50']);
  });
  it('a size returning after another size is a new run', () => {
    expect(spans(net(line(5), [{ id: 'k', poles: ids(5), sizes: ['120', '120', '70', '120', '120'] }])))
      .toEqual(['k#0=3x120', 'k#1=3x120', 'k#2=3x70', 'k#3=3x120', 'k#4=3x120']);
  });
  it('a single span: labelled once', () => {
    expect(spans(net(line(1), [{ id: 'k', poles: ids(1), sizes: ['95'] }]))).toEqual(['k#0=3x95']);
  });
  it('no middle span is ever labelled (runs of 2 to 8 spans)', () => {
    for (let n = 2; n <= 8; n++) {
      const out = cableNameSpans(net(line(n), [{ id: 'k', poles: ids(n), sizes: Array(n).fill('120') }])).map((s) => s.index).sort((a, b) => a - b);
      expect(out).toEqual([0, n - 1]);
    }
  });
  it('five parallel cables: each one on its own first and last span, in its own colour', () => {
    const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#000000', '#38bdf8'];
    const els = net(line(4), COLORS.map((color, j) => ({ id: `c${j}`, poles: ids(4), color, sizes: Array(4).fill(j === 3 ? '70' : '120') })));
    expect(spans(els)).toEqual(COLORS.flatMap((_, j) => [`c${j}#0=3x${j === 3 ? 70 : 120}`, `c${j}#3=3x${j === 3 ? 70 : 120}`]).sort());
  });
  it('parallel cables ending at different poles: the start and the end of each one on its own', () => {
    const els = net(line(4), [
      { id: 'c0', poles: ids(4), color: '#f59e0b', sizes: ['120', '120', '120', '120'] },
      { id: 'c1', poles: ids(3), color: '#3b82f6', sizes: ['120', '120', '120'] },
      { id: 'c2', poles: ids(2), color: '#10b981', sizes: ['95', '95'] },
      { id: 'c3', poles: ['P2', 'P3', 'P4'], color: '#000000', sizes: ['70', '70'] }, // starts in the middle
    ]);
    expect(spans(els)).toEqual(['c0#0=3x120', 'c0#3=3x120', 'c1#0=3x120', 'c1#2=3x120', 'c2#0=3x95', 'c2#1=3x95', 'c3#0=3x70', 'c3#1=3x70']);
  });
  it('one cable drawn in two pieces that meet at a pole (only those two there): one run, labelled at its two ends', () => {
    const els = net(line(5), [{ id: 'a', poles: ['P0', 'P1', 'P2'], sizes: ['120', '120'] }, { id: 'b', poles: ['P2', 'P3', 'P4', 'P5'], sizes: ['120', '120', '120'] }]);
    expect(spans(els)).toEqual(['a#0=3x120', 'b#2=3x120']);
  });
  it('a branched network: every branch is its own run (start and end), the trunk is not joined to any branch', () => {
    const els = net([['T', 0, 0, 'transformer'], ['A', 0, 150], ['B', 0, 300], ['J', 0, 450], ['L1', -150, 600], ['L2', -150, 750], ['R1', 150, 600], ['R2', 150, 750], ['M1', 0, 600], ['M2', 0, 750]], [
      { id: 'k1', poles: ['T', 'A', 'B'], sizes: ['120', '120'] },
      { id: 'k2', poles: ['B', 'J'], sizes: ['120'] },
      { id: 'bl', poles: ['J', 'L1', 'L2'], sizes: ['120', '120'] },
      { id: 'br', poles: ['J', 'R1', 'R2'], sizes: ['70', '70'] },
      { id: 'bm', poles: ['J', 'M1', 'M2'], sizes: ['120', '120'] },
    ]);
    expect(spans(els)).toEqual(['bl#0=3x120', 'bl#1=3x120', 'bm#0=3x120', 'bm#1=3x120', 'br#0=3x70', 'br#1=3x70', 'k1#0=3x120', 'k2#0=3x120']);
  });
  it('a cable drawn through the junction as one piece stays one run there; the branch is its own run', () => {
    // k runs T–A–J–L–L2 as one drawn cable, a second cable leaves J for R in the same colour and size
    const els = net([['T', 0, 0, 'transformer'], ['A', 0, 150], ['J', 0, 300], ['L', 0, 450], ['L2', 0, 600], ['R', 150, 450]], [
      { id: 'k', poles: ['T', 'A', 'J', 'L', 'L2'], sizes: ['120', '120', '120', '120'] },
      { id: 'r', poles: ['J', 'R'], sizes: ['120'] },
    ]);
    expect(spans(els)).toEqual(['k#0=3x120', 'k#3=3x120', 'r#0=3x120']);
  });
  it('a branch in another colour does not split a run (it is a different cable)', () => {
    const els = net([['P0', 0, 0], ['P1', 0, 150], ['P2', 0, 300], ['P3', 0, 450], ['X', 150, 150]], [
      { id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], sizes: ['120', '120', '120'] },
      { id: 'x', poles: ['P1', 'X'], color: '#2563eb', sizes: ['70'] },
    ]);
    expect(spans(els)).toEqual(['k#0=3x120', 'k#2=3x120', 'x#0=3x70']);
  });
  it('an unlinked span (no size) is not labelled and breaks the run', () => {
    expect(spans(net(line(5), [{ id: 'k', poles: ids(5), sizes: ['120', '120', '', '120', '120'] }])))
      .toEqual(['k#0=3x120', 'k#1=3x120', 'k#3=3x120', 'k#4=3x120']);
  });
  it('a ring drawn as one cable from A back to A: its first and its last span', () => {
    const els = net([['A', 0, 0], ['B', 150, 0], ['C', 150, 150], ['D', 0, 150]], [{ id: 'k', poles: ['A', 'B', 'C', 'D', 'A'], sizes: ['120', '120', '120', '120'] }]);
    expect(spans(els)).toEqual(['k#0=3x120', 'k#3=3x120']);
  });
  it('a closed ring made of two cables of one size (no end anywhere): one label, not none', () => {
    const els = net([['A', 0, 0], ['B', 150, 0], ['C', 150, 150], ['D', 0, 150]], [
      { id: 'k', poles: ['A', 'B', 'C'], sizes: ['120', '120'] }, { id: 'm', poles: ['C', 'D', 'A'], sizes: ['120', '120'] }]);
    expect(spans(els)).toEqual(['k#0=3x120']);
  });
  it('does not change the elements (display only)', () => {
    const els = net(line(6), [{ id: 'k', poles: ids(6), sizes: ['120', '120', '120', '70', '70', '50'] }]);
    const before = JSON.stringify(els);
    cableNameSpans(els);
    cableNameLayout(els, { ctx: { ...ctx, connectionDistances: {} }, fs: FS });
    expect(JSON.stringify(els)).toBe(before);
  });
  it('the layout draws exactly the spans cableNameSpans gives (horizontal, vertical, diagonal zigzag)', () => {
    const els = net([['T', 40, 60, 'transformer'], ['A', 250, 60], ['B', 250, 240], ['C', 60, 420], ['D', 60, 620], ['E', 250, 620]],
      [{ id: 'k', poles: ['T', 'A', 'B', 'C', 'D', 'E'], sizes: ['120', '120', '120', '70', '70'] }]);
    const L = cableNameLayout(els, { ctx: { ...ctx, connectionDistances: {} }, fs: FS });
    expect(L.map((l) => `${l.key}=${l.text}`).sort()).toEqual(spans(els));
    expect(spans(els)).toEqual(['k#0=3x120', 'k#2=3x120', 'k#3=3x70', 'k#4=3x70']);
    for (const l of L) expect(l.fontSize).toBe(FS);
  });
});

describe('cableNameSpans: branches, cables of one colour and size that are not one run, rings (12 cases)', () => {
  // ALL VALUES SYNTHETIC. Expected: a drawn cable is one run through a branch point; two drawn cables join
  // only as a continuation (end -> start), same colour and size, alone at the pole, not at a transformer.
  const revs: Record<string, ReturnType<typeof latestRevision>> = {};
  const R = (s: string) => (revs[s] ??= latestRevision(createCableType(`ct${s}`, data(`ABC 3x${s}+70 (synthetic)`), { now: 1 })));
  type C = { id: string; poles: string[]; color?: string; size: string };
  const net = (poles: [string, number, number, string?][], cables: C[]) => {
    let els = normalizeElements([...poles.map(([id, x, y, sym]) => pole(id, x, y, sym)),
      ...cables.map((c, j) => ({ id: c.id, type: 'cable', x: 0, y: 0, poleIds: c.poles, cableIndex: j, offset: 0, strokeColor: c.color ?? '#e11d48', fillColor: 'none', strokeWidth: 2 }) as CableElement)]);
    for (const c of cables) for (let i = 0; i < c.poles.length - 1; i++) els = link(els, c.id, i, R(c.size));
    return els;
  };
  const C0: LayoutContext = { ...ctx, connectionDistances: {} };
  const main: [string, number, number, string?][] = [['P0', 0, 0, 'transformer'], ...Array.from({ length: 8 }, (_, i) => [`P${i + 1}`, 0, (i + 1) * 150] as [string, number, number])];
  const MAIN = main.map((p) => p[0]);
  const side: [string, number, number][] = [['B1', 160, 600], ['B2', 320, 600], ['B3', 480, 600]];
  const ring: [string, number, number, string?][] = [['T', -200, 0, 'transformer'], ['A', 0, 0], ['B', 300, 0], ['C', 300, 300], ['D', 0, 300], ['E', 500, 400], ['F', 700, 500]];
  const pair = (u: string[], w: string[]): C[] => [{ id: 'u', poles: u, size: '120' }, { id: 'w', poles: w, size: '120' }];
  const line5: [string, number, number][] = [['X', 300, 300], ['A1', 300, 150], ['A2', 300, 0], ['C1', 300, 450], ['C2', 300, 600]];
  const CASES: [string, [string, number, number, string?][], C[], string[] | 'one'][] = [
    ['1a long main line (one cable) with a side branch at P4, same colour and size: no label on the two sides of the branch point', [...main, ...side],
      [{ id: 'k', poles: MAIN, size: '120' }, { id: 'b', poles: ['P4', 'B1', 'B2', 'B3'], size: '120' }], ['k#0', 'k#7', 'b#0', 'b#2']],
    ['1b the same with a 3x70 branch', [...main, ...side],
      [{ id: 'k', poles: MAIN, size: '120' }, { id: 'b', poles: ['P4', 'B1', 'B2', 'B3'], size: '70' }], ['k#0', 'k#7', 'b#0', 'b#2']],
    ['1c the main line drawn as two cables meeting at the branch pole: three runs', [...main, ...side],
      [{ id: 'k1', poles: MAIN.slice(0, 5), size: '120' }, { id: 'k2', poles: MAIN.slice(4), size: '120' }, { id: 'b', poles: ['P4', 'B1', 'B2', 'B3'], size: '120' }],
      ['k1#0', 'k1#3', 'k2#0', 'k2#3', 'b#0', 'b#2']],
    ['1d a branch in another colour', [...main, ...side],
      [{ id: 'k', poles: MAIN, size: '120' }, { id: 'b', poles: ['P4', 'B1', 'B2', 'B3'], color: '#2563eb', size: '120' }], ['k#0', 'k#7', 'b#0', 'b#2']],
    ['2a two feeders of one colour and size out of one transformer: not joined', [['T', 300, 0, 'transformer'], ['A1', 150, 150], ['A2', 0, 300], ['C1', 450, 150], ['C2', 600, 300]],
      [{ id: 'f1', poles: ['T', 'A1', 'A2'], size: '120' }, { id: 'f2', poles: ['T', 'C1', 'C2'], size: '120' }], ['f1#0', 'f1#1', 'f2#0', 'f2#1']],
    ['2b two cables starting at one pole (opposite ways): not joined', line5, pair(['X', 'A1', 'A2'], ['X', 'C1', 'C2']), ['u#0', 'u#1', 'w#0', 'w#1']],
    ['2c two cables ending at one pole: not joined', line5, pair(['A2', 'A1', 'X'], ['C2', 'C1', 'X']), ['u#0', 'u#1', 'w#0', 'w#1']],
    ['2d two cables on separate paths: not joined', [['A0', 0, 0], ['A1', 0, 150], ['A2', 0, 300], ['C0', 300, 0], ['C1', 300, 150], ['C2', 300, 300]],
      pair(['A0', 'A1', 'A2'], ['C0', 'C1', 'C2']), ['u#0', 'u#1', 'w#0', 'w#1']],
    ['2e a cable continued as a second drawn cable (end -> start): one run', [['P0', 0, 0], ['P1', 0, 150], ['P2', 0, 300], ['P3', 0, 450], ['P4', 0, 600]],
      pair(['P0', 'P1', 'P2'], ['P2', 'P3', 'P4']), ['u#0', 'w#1']],
    ['3a a ring drawn as one cable A..A, fed at A, a branch at C: the ring is one run', ring,
      [{ id: 'f', poles: ['T', 'A'], size: '120' }, { id: 'k', poles: ['A', 'B', 'C', 'D', 'A'], size: '120' }, { id: 'b', poles: ['C', 'E', 'F'], size: '120' }],
      ['f#0', 'k#0', 'k#3', 'b#0', 'b#1']],
    ['3b a ring of two cables (A-B-C, C-D-A), a branch at C', ring.slice(1),
      [{ id: 'k', poles: ['A', 'B', 'C'], size: '120' }, { id: 'm', poles: ['C', 'D', 'A'], size: '120' }, { id: 'b', poles: ['C', 'E', 'F'], size: '120' }], ['k#1', 'm#0', 'b#0', 'b#1']],
    ['3c a closed ring of two cables with no end: one label', ring.slice(1, 5),
      [{ id: 'k', poles: ['A', 'B', 'C'], size: '120' }, { id: 'm', poles: ['C', 'D', 'A'], size: '120' }], 'one'],
  ];
  for (const [name, poles, cables, expected] of CASES) {
    it(name, () => {
      const els = net(poles, cables);
      const got = cableNameSpans(els).map((s) => `${s.cable.id}#${s.index}`);
      if (expected === 'one') expect(got.length).toBe(1);
      else expect([...got].sort()).toEqual([...expected].sort());
      // drawn as given: every label on its span, the same font, covering nothing and no other label
      const L = cableNameLayout(els, { ctx: C0, fs: FS });
      expect(L.map((l) => l.key).sort()).toEqual([...got].sort());
      for (const l of L) expect(l.fontSize).toBe(FS);
      const set = drawingObstacles(els, C0);
      addPoleTagObstacles(els, C0, set);
      for (const l of L) expect(segmentCost(set, l.a, l.b, l.half), l.key).toBe(0);
      for (const l of L) {
        const others = new ObstacleSet();
        for (const o of L) if (o !== l) addSegment(others, o.a, o.b, o.half);
        expect(segmentCost(others, l.a, l.b, l.half), l.key).toBe(0);
      }
    });
  }
});
