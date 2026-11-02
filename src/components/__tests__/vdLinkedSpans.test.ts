import { describe, expect, it } from 'vitest';
import type { CableTypeData } from '../../types/cableType';
import type { CableElement, SpanProps } from '../../types/drawing';
import { createCableType, latestRevision } from '../../utils/cableTypeModel';
import { linkSpanCable } from '../../utils/spanCableLink';
import { planDefaultFill } from '../../utils/defaultCable';
import { normalizeElements, withSpanProps } from '../../utils/spanModel';
import { computeVoltageDrop } from '../../utils/voltageDrop';
import { DEFAULT_ELECTRICAL } from '../../utils/electricalSettings';
import { linkedSpanView, linkedSpansWithoutSystem } from '../VoltageDropPanel';

// The voltage-drop panel and spans linked to a library cable: E1's «R / X / Rn not entered» are not
// shown for them (E2 calculates them), and a missing supply system is pointed out. E1 is unchanged.
// ALL VALUES ARE SYNTHETIC.

const v = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'unverified' } }) as never;
const REV = latestRevision(createCableType('ct_3x120', {
  name: '3x120 (synthetic)', construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 120 }, neutral: { material: 'al', sectionMm2: 70 },
  r: v(0.2145, 'unspecified'), x: v(0.0716, 'ac-50hz'), rn: v(0.4126, 'unspecified'), xn: v(0.0754, 'ac-50hz'), source: { name: 'synthetic' },
} as CableTypeData, { now: 1 }));
const P = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const drawing = (recs: (SpanProps | undefined)[]) => {
  const els = normalizeElements([P('T', 'transformer'), P('A'), P('B'), { id: 'k', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A', 'B'], cableIndex: 0, offset: 0, strokeColor: '#f00', fillColor: 'none', strokeWidth: 2 },
    { id: 'u', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#f00', count: 1, variant: 'square', label: '40', strokeColor: '#000', fillColor: '#000', strokeWidth: 2 }] as never, (() => { let n = 0; return () => `s${n++}`; })());
  let k = els.find((e) => e.id === 'k') as CableElement;
  recs.forEach((r, i) => { if (r) k = withSpanProps(k, k.spanIds![i], r); });
  return els.map((e) => (e.id === 'k' ? k : e));
};
const e1 = (els: ReturnType<typeof drawing>) => [...computeVoltageDrop(els, { A_T: '40', A_B: '35' }, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9 }).bySpan.values()];

describe('spans linked to a library cable in the voltage-drop panel', () => {
  it('1. linked, system set: the E2 note, no misleading E1 «R / X / Rn not entered» (E1 itself unchanged)', () => {
    const els = drawing([linkSpanCable({ poles: ['T', 'A'], system: '3ph4w' }, ['T', 'A'], REV, 1), linkSpanCable({ poles: ['A', 'B'], system: '3ph4w' }, ['A', 'B'], REV, 1)]);
    const spans = e1(els);
    expect(spans[0].missing).toEqual(['resistance', 'reactance']); // E1 still reads only the span's own fields
    expect(spans[0].computable).toBe(false);
    const k = els.find((e) => e.id === 'k') as CableElement;
    const view = linkedSpanView(k.spanProps![k.spanIds![0]], spans[0].missing);
    expect(view).toEqual({ linked: true, missing: [], systemMissing: false });
    expect(linkedSpansWithoutSystem(els)).toBe(0);
  });
  it('2. linked, no system: pointed out (nothing assumed); no value is computed for it', () => {
    const els = drawing([linkSpanCable(undefined, ['T', 'A'], REV, 1), linkSpanCable({ poles: ['A', 'B'], system: '1ph2w' }, ['A', 'B'], REV, 1)]);
    const spans = e1(els);
    const k = els.find((e) => e.id === 'k') as CableElement;
    const view = linkedSpanView(k.spanProps![k.spanIds![0]], spans[0].missing);
    expect(view).toEqual({ linked: true, missing: ['system'], systemMissing: true });
    expect(linkedSpansWithoutSystem(els)).toBe(1);
    expect(spans[0].computable).toBe(false);
    expect(spans[0].dropV).toBeUndefined();
    // the system was not filled in, and parallel was not touched
    expect(k.spanProps![k.spanIds![0]].system).toBeUndefined();
    expect(k.spanProps![k.spanIds![0]].parallel).toBeUndefined();
  });
  it('3. a span not linked to the library: E1 exactly as before (its missing items all shown)', () => {
    const own: SpanProps = { poles: ['T', 'A'], system: '3ph4w', material: 'al', crossSectionMm2: 120 };
    const els = drawing([own, { poles: ['A', 'B'], system: '3ph4w', rOhmPerKm: 0.3, xOhmPerKm: 0.07, dataSource: 'test' }]);
    const spans = e1(els);
    expect(linkedSpanView(own, spans[0].missing)).toEqual({ linked: false, missing: ['resistance', 'reactance'], systemMissing: false });
    expect(spans[1].computable).toBe(true);
    expect(linkedSpanView(undefined, ['system'])).toEqual({ linked: false, missing: ['system'], systemMissing: false });
  });
  it('a span linked to the default cable without a system (none is filled in) is pointed out until the user sets one', () => {
    const d = { typeId: REV.id, revision: REV.revision, snapshot: REV, selectedAt: 1 };
    const els = drawing([undefined, undefined]);
    const filled = planDefaultFill(els, d, 1);
    const after = els.map((e) => (e.id === 'k' ? { ...e, ...filled.updates[0].changes } : e));
    expect(linkedSpansWithoutSystem(after)).toBe(2);
    // the user sets the system by hand (the span sheet's save keeps the cable type): no longer pointed out
    const k = after.find((e) => e.id === 'k') as CableElement;
    const set = withSpanProps(k, k.spanIds![0], { ...k.spanProps![k.spanIds![0]], system: '3ph4w' });
    expect(linkedSpansWithoutSystem(after.map((e) => (e.id === 'k' ? set : e)))).toBe(1);
  });
  it('a cable type record that cannot be read is not treated as linked (its E1 items stay)', () => {
    const bad = { poles: ['T', 'A'], cableType: { typeId: 'x', revision: 1, snapshot: {} } } as unknown as SpanProps;
    expect(linkedSpanView(bad, ['resistance'])).toEqual({ linked: false, missing: ['resistance'], systemMissing: false });
  });
});
