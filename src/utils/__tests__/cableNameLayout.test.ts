import { describe, expect, it } from 'vitest';
import { createCableType, editCableType, latestRevision } from '../cableTypeModel';
import { linkSpanCable, unlinkSpanCable } from '../spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';
import { cableNameLayout, cableNameOf, cableSizeOf } from '../cableNameLayout';
import { addPoleTagObstacles, drawingObstacles, distanceLabelPositions, segmentCost, ObstacleSet, addSegment, type LayoutContext } from '../overlayLayout';
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
  it('every linked span is labelled: horizontal, vertical, diagonal (both cables)', () => {
    expect([...byKey.keys()].sort()).toEqual(['k#0', 'k#1', 'k#2', 'q#0']);
  });
  it('the text runs along its span and reads left to right (angle −90…90)', () => {
    expect(byKey.get('k#0')!.angle).toBeCloseTo(0, 6); // horizontal
    expect(Math.abs(byKey.get('k#1')!.angle)).toBeCloseTo(90, 6); // vertical
    expect(byKey.get('k#2')!.angle).toBeCloseTo((Math.atan2(120, 160) * 180) / Math.PI, 6); // diagonal
    expect(Math.abs(byKey.get('q#0')!.angle)).toBeCloseTo(90, 6);
    for (const l of L) expect(l.angle).toBeGreaterThanOrEqual(-90), expect(l.angle).toBeLessThanOrEqual(90);
  });
  it('covers nothing: poles, cables, subscribers and their labels, distance numbers, pole numbers, the other names', () => {
    const set = drawingObstacles(allLinked(), ctx);
    addPoleTagObstacles(allLinked(), ctx, set);
    for (const l of L) expect(segmentCost(set, l.a, l.b, l.half), l.key).toBe(0);
    // and not each other
    for (const l of L) {
      const others = new ObstacleSet();
      for (const o of L) if (o !== l) addSegment(others, o.a, o.b, o.half);
      expect(segmentCost(others, l.a, l.b, l.half), l.key).toBe(0);
    }
    for (const l of L) expect(l.cost).toBe(0);
  });
  it('on the side away from the span\'s distance number, close to its span, with a short leader to the cable', () => {
    const dist = new Map(distanceLabelPositions(allLinked(), ctx).map((d) => [d.key, d]));
    const keys: Record<string, string> = { 'k#0': 'A_T', 'k#1': 'A_B', 'k#2': 'B_C' };
    const P: Record<string, [number, number]> = { T: [-120, 0], A: [200, 0], B: [200, 180], C: [360, 300] };
    const ends: Record<string, [string, string]> = { 'k#0': ['T', 'A'], 'k#1': ['A', 'B'], 'k#2': ['B', 'C'] };
    for (const [k, dk] of Object.entries(keys)) {
      const l = byKey.get(k)!, d = dist.get(dk)!;
      const [a, b] = ends[k].map((id) => P[id]);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ux = b[0] - a[0], uy = b[1] - a[1], n = Math.hypot(ux, uy);
      const side = (x: number, y: number) => ((x - mx) * -uy + (y - my) * ux) / n;
      expect(Math.sign(side(l.x, l.y))).toBe(-Math.sign(side(d.x, d.y)));
      expect(Math.abs(side(l.x, l.y))).toBeLessThan(FS * 5);
      expect(Math.hypot(l.leader.to.x - l.leader.from.x, l.leader.to.y - l.leader.from.y)).toBeLessThan(FS * 4);
    }
  });
  it('deterministic, and the same at the same zoom step (stable when panning)', () => {
    expect(lay(allLinked())).toEqual(L);
  });
  it('a transformer is avoided as drawn (its circles and rectangle), and a name longer than its span still finds a free place', () => {
    const els = link(normalizeElements([pole('T', 0, 0, 'transformer'), pole('A', 130, 0),
      { id: 'k', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 0, offset: 0, strokeColor: '#e11d48', fillColor: 'none', strokeWidth: 2 } as CableElement]), 'k', 0);
    const [l] = cableNameLayout(els, { ctx: { ...ctx, connectionDistances: { A_T: '45' } }, fs: 12 });
    expect(l.cost).toBe(0);
    // the transformer's drawing: circles of radius R at (0, ±0.8R), rectangle x 1.2R…2.2R, y ±1.8R
    const R = POLE_RADIUS, o = new ObstacleSet();
    o.add({ kind: 'circle', cx: 0, cy: -0.8 * R, r: R, weight: 1 }); o.add({ kind: 'circle', cx: 0, cy: 0.8 * R, r: R, weight: 1 });
    o.add({ kind: 'rect', x: 1.2 * R, y: -1.8 * R, w: R, h: 3.6 * R, weight: 1 });
    expect(segmentCost(o, l.a, l.b, l.half)).toBe(0);
  });
  it('a crowded span: when no place is free, the label still goes beside its span (least covering place)', () => {
    // two parallel cables on the same span, both linked: two labels, on different sides or further out
    const els = normalizeElements([pole('T', 0, 0, 'transformer'), pole('A', 140, 0),
      { id: 'k1', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 0, offset: 0, strokeColor: '#e11d48', fillColor: 'none', strokeWidth: 2 } as CableElement,
      { id: 'k2', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 1, offset: 0, strokeColor: '#2563eb', fillColor: 'none', strokeWidth: 2 } as CableElement]);
    const L2 = lay(link(link(els, 'k1', 0), 'k2', 0, OTHER));
    expect(L2.map((l) => l.text)).toEqual(['3x120', '3x70']);
    const o = new ObstacleSet(); addSegment(o, L2[0].a, L2[0].b, L2[0].half);
    expect(segmentCost(o, L2[1].a, L2[1].b, L2[1].half)).toBe(0);
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
