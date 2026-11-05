import { describe, expect, it } from 'vitest';
import type { CableTypeData } from '../../types/cableType';
import type { CableElement, SpanProps } from '../../types/drawing';
import { createCableType, latestRevision } from '../../utils/cableTypeModel';
import { linkSpanCable } from '../../utils/spanCableLink';
import { planDefaultFill } from '../../utils/defaultCable';
import { normalizeElements, withSpanProps } from '../../utils/spanModel';
import { computeVoltageView } from '../../utils/__tests__/vdTestView';
import { DEFAULT_ELECTRICAL } from '../../utils/electricalSettings';
import { linkedSpanView } from '../VoltageDropPanel';

// The voltage-drop panel and spans linked to a library cable: E2 calculates them from their snapshot.
// A span saved without a supply system is calculated with the default 3ph+N (it is not written on the
// span, and no cable value is assumed).
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
const vd = (els: ReturnType<typeof drawing>) => computeVoltageView(els, { A_T: '40', A_B: '35' }, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9 });
const spansOf = (els: ReturnType<typeof drawing>) => [...vd(els).bySpan.values()];

describe('spans linked to a library cable in the voltage-drop panel (E2)', () => {
  it('1. linked, system set: calculated by E2 from the snapshot; not pointed out', () => {
    const els = drawing([linkSpanCable({ poles: ['T', 'A'], system: '3ph4w' }, ['T', 'A'], REV, 1), linkSpanCable({ poles: ['A', 'B'], system: '3ph4w' }, ['A', 'B'], REV, 1)]);
    const spans = spansOf(els);
    expect(spans[0].computable).toBe(true);
    expect(spans[0].reasons).toEqual([]);
    const k = els.find((e) => e.id === 'k') as CableElement;
    expect(linkedSpanView(k.spanProps![k.spanIds![0]])).toEqual({ linked: true });
  });
  it('2. linked, no system stored: calculated with the default 3ph+N (the same as 3ph+N stored)', () => {
    const els = drawing([linkSpanCable(undefined, ['T', 'A'], REV, 1), linkSpanCable({ poles: ['A', 'B'], system: '1ph2w' }, ['A', 'B'], REV, 1)]);
    const spans = spansOf(els);
    const k = els.find((e) => e.id === 'k') as CableElement;
    expect(linkedSpanView(k.spanProps![k.spanIds![0]])).toEqual({ linked: true });
    // exactly what 3ph+N stored on it gives (here a three-phase subscriber behind the stored 1ph+N span:
    // the circuit is refused either way, and the stored 1ph+N is kept and used)
    const explicit = spansOf(drawing([linkSpanCable({ poles: ['T', 'A'], system: '3ph4w' }, ['T', 'A'], REV, 1), linkSpanCable({ poles: ['A', 'B'], system: '1ph2w' }, ['A', 'B'], REV, 1)]));
    expect(spans).toEqual(explicit);
    // a valid circuit: calculated
    const ok = spansOf(drawing([linkSpanCable(undefined, ['T', 'A'], REV, 1), linkSpanCable(undefined, ['A', 'B'], REV, 1)]));
    expect(ok.map((x) => [x.computable, x.reasons.length])).toEqual([[true, 0], [true, 0]]);
    // the system was not written on the span, and parallel was not touched
    expect(k.spanProps![k.spanIds![0]].system).toBeUndefined();
    expect(k.spanProps![k.spanIds![0]].parallel).toBeUndefined();
  });
  it('3. a span not linked to the library: its own values only; missing ones give the E2 reason', () => {
    const own: SpanProps = { poles: ['T', 'A'], system: '3ph4w', material: 'al', crossSectionMm2: 120 };
    const els = drawing([own, { poles: ['A', 'B'], system: '3ph4w', rOhmPerKm: 0.3, xOhmPerKm: 0.07, dataSource: 'test' }]);
    const spans = spansOf(els);
    expect(linkedSpanView(own)).toEqual({ linked: false });
    expect(spans[0].reasons).toEqual(['impedance-missing']);
    expect(linkedSpanView(undefined)).toEqual({ linked: false });
  });
  it('spans linked to the default cable (no system written): calculated at once with the default 3ph+N', () => {
    const d = { typeId: REV.id, revision: REV.revision, snapshot: REV, selectedAt: 1 };
    const els = drawing([undefined, undefined]);
    const filled = planDefaultFill(els, d, 1);
    const after = els.map((e) => (e.id === 'k' ? { ...e, ...filled.updates[0].changes } : e)) as typeof els;
    const k = after.find((e) => e.id === 'k') as CableElement;
    expect(k.spanIds!.map((id) => k.spanProps![id].system)).toEqual([undefined, undefined]);
    expect(spansOf(after).map((s) => s.computable)).toEqual([true, true]);
  });
  it('a cable type record that cannot be read is not treated as linked', () => {
    const bad = { poles: ['T', 'A'], cableType: { typeId: 'x', revision: 1, snapshot: {} } } as unknown as SpanProps;
    expect(linkedSpanView(bad)).toEqual({ linked: false });
  });
});
