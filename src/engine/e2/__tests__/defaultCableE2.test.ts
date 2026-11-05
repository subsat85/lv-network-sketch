import { describe, expect, it } from 'vitest';
import type { CableTypeData } from '../../../types/cableType';
import type { CableElement, SpanProps } from '../../../types/drawing';
import { createCableType, latestRevision } from '../../../utils/cableTypeModel';
import { prepareImportedCables, type DefaultCable } from '../../../utils/defaultCable';
import { withSpanProps } from '../../../utils/spanModel';
import { effectiveSettings } from '../../../utils/electricalSettings';
import { runStudyE2 } from '../index';
import type { CircuitResult } from '../model';
import { drawing } from './references';

// An old drawing imported with the default cable: E2 calculates it from the default's snapshot.
// ALL VALUES ARE SYNTHETIC.

const v = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz') =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km' as const, basis, verification: { status: 'checked' } }) as never;
const data = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'ABC 3x95 (synthetic)', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 95 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: v(0.32, 'ac'), x: v(0.075, 'ac-50hz'), rn: v(0.63, 'ac'), xn: v(0.08, 'ac-50hz'), source: { name: 'synthetic sheet' }, ...o,
});
const def = (o: Partial<CableTypeData> = {}): DefaultCable => { const r = latestRevision(createCableType('ct_def', data(o), { now: 1 })); return { typeId: r.id, revision: r.revision, snapshot: r, selectedAt: 1 }; };
// an old drawing: company-table values on the span
const OLD: Omit<SpanProps, 'poles'> = { system: '3ph4w', cableKind: 'abc', material: 'al', crossSectionMm2: 120, rOhmPerKm: 0.2415, xOhmPerKm: 0.0716, rNeutralOhmPerKm: 0.4126, dataSource: 'كتالوج', review: ['defaults'] };
const imported = (d: DefaultCable | undefined) => {
  const { doc } = drawing({ Lm: 120, props: OLD, consumers: [{ variant: 'square', label: '40' }] });
  const { elements, report } = prepareImportedCables([...doc.elements], d, 1);
  return { doc: { ...doc, elements }, report };
};
const nodeA = (c: CircuitResult) => c.nodes.find((n) => n.poleId === 'A')!.dropV;
const e2 = (doc: ReturnType<typeof imported>['doc']) => { const r = runStudyE2(doc, { inputOrigin: 'legacy-project' }); return { r, c: r.circuits.find((x) => x.spans.length)! as CircuitResult }; };

describe('an imported old drawing and E2', () => {
  it('E2 calculates it from the default cable\'s snapshot (the old values are gone, none of them reported as ignored)', () => {
    const { doc, report } = imported(def());
    expect(report).toMatchObject({ kind: 'old', cleared: 1, linked: 1 });
    const { r, c } = e2(doc);
    expect(nodeA(c).a.status).not.toBe('unavailable');
    expect(r.issues.map((i) => i.code)).not.toContain('cable-type:legacy-values-ignored');
    // the same as a span linked by hand to that cable: the result comes from the snapshot only
    const k = doc.elements.find((e) => e.type === 'cable') as CableElement;
    const other = { ...doc, elements: doc.elements.map((e) => (e.type === 'cable' ? withSpanProps(k, k.spanIds![0], { ...k.spanProps![k.spanIds![0]], rOhmPerKm: 9 }) : e)) };
    expect(nodeA(e2(other).c)).toEqual(nodeA(c));
  });
  it('a missing value of the default cable stays missing in E2 (blocks), a DC value is used as entered (provisional)', () => {
    const missing = e2(imported(def({ r: v(undefined, 'unspecified') })).doc);
    expect(missing.r.issues.map((i) => i.code)).toContain('phase:resistance-missing');
    expect(nodeA(missing.c).a.status).toBe('unavailable');
    expect(JSON.stringify(e2(imported(def({ r: v(0.32, 'dc') })).doc).c)).toMatch(/dc-resistance-as-entered/);
  });
  it('without a default cable: nothing to calculate with in either engine (no value invented)', () => {
    const { doc, report } = imported(undefined);
    expect(report).toMatchObject({ kind: 'old', needDefault: true, linked: 0 });
    const { r, c } = e2(doc);
    expect(r.issues.map((i) => i.code)).toContain('phase:resistance-missing');
    expect(nodeA(c).a.status).toBe('unavailable');
  });
});
