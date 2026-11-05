import { describe, expect, it } from 'vitest';
import type { CableTypeData, CableTypeRevision } from '../../../types/cableType';
import type { CableElement, SpanProps } from '../../../types/drawing';
import { createCableType, editCableType, latestRevision } from '../../../utils/cableTypeModel';
import { linkSpanCable, unlinkSpanCable } from '../../../utils/spanCableLink';
import { withSpanProps } from '../../../utils/spanModel';
import { effectiveSettings } from '../../../utils/electricalSettings';
import { runStudyE2 } from '../index';
import type { CircuitResult } from '../model';
import { drawing } from './references';

// Stage C4: what a span linked to a library cable means for E2: it calculates from the snapshot kept
// in the span (never from the library). ALL VALUES ARE SYNTHETIC.

const v = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz') =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km' as const, basis, verification: { status: 'checked' } }) as never;
const data = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'ABC 3x95 (synthetic)', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 95 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: v(0.32, 'ac'), x: v(0.075, 'ac-50hz'), rn: v(0.63, 'ac'), xn: v(0.08, 'ac-50hz'), source: { name: 'synthetic sheet' }, ...o,
});
const H = createCableType('ct_c4', data(), { now: 1 });
const REV1 = latestRevision(H);
const REV2 = latestRevision(editCableType(H, { r: { value: 0.9, unit: 'ohm/km', basis: 'ac' } }, { now: 2 }).history);

/** the span's own (legacy) values — different from the cable's */
const OWN: Omit<SpanProps, 'poles'> = { system: '3ph4w', material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.443, xOhmPerKm: 0.08, rNeutralOhmPerKm: 0.6, dataSource: 'own (synthetic)' };
// one drawing (its span ids are made once); each case puts a record on its one span
const BASE = drawing({ Lm: 120, props: {}, consumers: [{ variant: 'square', label: '40' }] }).doc;
const doc = (props: Omit<SpanProps, 'poles'>) => ({
  ...BASE,
  elements: BASE.elements.map((e) => (e.type === 'cable' ? withSpanProps(e as CableElement, (e as CableElement).spanIds![0], { poles: ['T', 'A'], ...props }) : e)),
});
const linkedProps = (rev: CableTypeRevision, own: Omit<SpanProps, 'poles'> = OWN) => {
  const { poles: _p, ...rest } = linkSpanCable({ poles: ['T', 'A'], ...own }, ['T', 'A'], rev, 5);
  return rest;
};
const e2 = (props: Omit<SpanProps, 'poles'>) => {
  const r = runStudyE2(doc(props), { inputOrigin: 'legacy-project' });
  return { r, c: r.circuits.find((x) => x.spans.length)! as CircuitResult };
};
const nodeA = (c: CircuitResult) => c.nodes.find((n) => n.poleId === 'A')!.dropV;
const spanCodes = (r: ReturnType<typeof e2>['r']) => r.issues.filter((i) => i.target.kind === 'span').map((i) => i.code).sort();


describe('C4: E2 calculates from the snapshot', () => {
  it('the snapshot\'s values, not the span\'s own fields; the difference is reported (legacy values ignored)', () => {
    const a = e2(linkedProps(REV1));
    const b = e2(linkedProps(REV1, { system: '3ph4w', rOhmPerKm: 5, xOhmPerKm: 1, rNeutralOhmPerKm: 7 }));
    expect(nodeA(a.c)).toEqual(nodeA(b.c));
    expect(nodeA(a.c).a.status).not.toBe('unavailable');
    expect(spanCodes(a.r)).toContain('cable-type:legacy-values-ignored');
    // another revision: another result (the revision linked is the one used)
    expect(nodeA(e2(linkedProps(REV2)).c)).not.toEqual(nodeA(a.c));
    // no link: the span's own values again, no such report
    expect(spanCodes(e2(OWN).r)).not.toContain('cable-type:legacy-values-ignored');
  });
  it('a later change of the library\'s record (or of the object it came from) does not reach the span', () => {
    const rev = structuredClone(REV1);
    const props = linkedProps(rev);
    const before = nodeA(e2(props).c);
    (rev.r as { value?: number }).value = 3; // the library's record changed after the link
    expect(nodeA(e2(props).c)).toEqual(before);
    expect(props.cableType!.snapshot.r.value).toBe(0.32);
  });
  it('8. an imported span whose record is not in any library is still calculated from its snapshot', () => {
    const props = JSON.parse(JSON.stringify(linkedProps(REV1))) as Omit<SpanProps, 'poles'>;
    expect(nodeA(e2(props).c).a.status).not.toBe('unavailable');
  });
  it('DC as entered: used without conversion, the result provisional; a missing value is not made up', () => {
    const dc = e2(linkedProps(latestRevision(createCableType('ct_dc', data({ r: v(0.32, 'dc') }), { now: 1 }))));
    expect(JSON.stringify(dc.c)).toMatch(/dc-resistance-as-entered/);
    const missing = e2(linkedProps(latestRevision(createCableType('ct_m', data({ r: v(undefined, 'unspecified') }), { now: 1 }))));
    expect(spanCodes(missing.r)).toContain('phase:resistance-missing');
    expect(nodeA(missing.c).a.status).toBe('unavailable');
    // X = 0 is an entered value (calculated)
    expect(nodeA(e2(linkedProps(latestRevision(createCableType('ct_x0', data({ x: v(0, 'ac-50hz') }), { now: 1 })))).c).a.status).not.toBe('unavailable');
  });
  it('the link changes only the span record: the cable\'s poles, span ids and the distances are the same', () => {
    const d0 = doc(OWN), d1 = doc(linkedProps(REV1));
    const strip = (els: typeof d0.elements) => els.map((e) => { const { spanProps: _s, ...r } = e as CableElement; return r; });
    expect(strip(d1.elements)).toEqual(strip(d0.elements));
    expect(d1.connectionDistances).toEqual(d0.connectionDistances);
  });
});
