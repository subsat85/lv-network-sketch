import { describe, expect, it } from 'vitest';
import { createCableType, editCableType, latestRevision } from '../cableTypeModel';
import { linkSpanCable, unlinkSpanCable } from '../spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';
import { cableOffsetLines } from '../cableLayout';
import { cableNameLayout, cableNameLayoutWithTags, cableNameOf, cableSizeOf } from '../cableNameLayout';
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
  it('one label per cable and size (not repeated along the cable), on its longest span with that size', () => {
    // k: T–A (320) and A–B (180) are 3x120, B–C is 3x70; q: A–D is 3x120
    expect(L.map((l) => [l.key, l.text]).sort()).toEqual([['k#0', '3x120'], ['k#2', '3x70'], ['q#0', '3x120']]);
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
    it(`${dir === 'v' ? 'vertical' : dir === 'h' ? 'horizontal' : 'diagonal'} span: one label per cable, one side, same place along the span, equal spacing, same order as the cables, nothing covered`, () => {
      const els = build(dir);
      const L = cableNameLayout(els, { ctx: C2, fs: FS });
      // one label per cable (each cable has the same size on both spans), all on the same span
      expect(L.length).toBe(5);
      expect(new Set(L.map((l) => l.cableId)).size).toBe(5);
      expect(new Set(L.map((l) => l.index)).size).toBe(1);
      expect(L.map((l) => [l.cableId, l.color, l.text]).sort()).toEqual(COLORS.map((col, j) => [`c${j}`, col, REVS[j] === OTHER ? '3x70' : '3x120']).sort());
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
      for (const l of L) { expect(l.cost).toBe(0); expect(l.arrow).toBeUndefined(); }
      const set = drawingObstacles(els, C2);
      addPoleTagObstacles(els, C2, set);
      for (const l of L) expect(segmentCost(set, l.a, l.b, l.half), l.cableId).toBe(0);
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
