import { describe, expect, it } from 'vitest';
import type { CableTypeData, CableTypeRevision, ElectricalValue, SpanCableType } from '../../../types/cableType';
import type { SpanProps } from '../../../types/drawing';
import { assignCableType, createCableType, editCableType, latestRevision, setCableTypeVerification, thermalBasis } from '../../../utils/cableTypeModel';
import { cableTypeEntry } from '../catalogue/cableTypes';
import { issueTextKey } from '../../../utils/e2Presentation';
import { runStudyE2 } from '../index';
import { runStudy } from '../../index';
import type { CircuitResult } from '../model';
import type { PhaseAllocation } from '../phases';
import { drawing, REF, TOL } from './references';

// Stage B: a library cable type on a span, through E2. The Stage A rules apply to it unchanged:
// explicit values only, RN is never R, XN is never X, a missing neutral value blocks only what needs
// the neutral, an unverified value gives a provisional result.
// ALL VALUES ARE SYNTHETIC (R = 0.5, X = 0.08 Ω/km and variations), not manufacturer data.

const checked = { status: 'checked' as const, by: 'synthetic test fixture' };
const val = <B extends 'ac' | 'dc' | 'unspecified' | 'ac-50hz'>(value: number | undefined, basis: B, verification: ElectricalValue['verification'] = checked): ElectricalValue<B> =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km', basis, verification: { ...verification } });
/** a synthetic ABC type: 3 × 70 al + 54.6 alloy, R and X given, the neutral values as passed */
const abcData = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'synthetic ABC 3x70 + 54.6', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: { ...val(0.5, 'ac'), referenceTempC: 70 }, x: val(0.08, 'ac-50hz'), rn: val(undefined, 'ac'), xn: val(undefined, 'ac-50hz'),
  source: { name: 'synthetic', reference: 'synthetic test data', page: 'test' },
  ...o,
});
const rev = (o: Partial<CableTypeData> = {}): CableTypeRevision => latestRevision(createCableType('ct_syn', abcData(o), { now: 1 }));
const use = (r: CableTypeRevision, overrides?: SpanCableType['overrides']): SpanCableType => ({ typeId: r.id, revision: r.revision, snapshot: r, ...(overrides ? { overrides } : {}) });

const ON_A = (n: number): PhaseAllocation => ({ consumers: { u0: { a: n, source: 'design', verification: { status: 'checked' } } }, singlePhaseSpans: {} });
const A = (c: CircuitResult) => c.nodes.find((n) => n.poleId === 'A')!;
const study = (props: Omit<SpanProps, 'poles'>, o: { balanced?: boolean; count?: number; tempC?: number; ambientC?: number } = {}) => {
  const count = o.count ?? 5;
  const electrical = { ...(o.tempC !== undefined ? { conductorTempC: o.tempC } : {}), ...(o.ambientC !== undefined ? { ambientTempC: o.ambientC } : {}) };
  const { doc } = drawing({ Lm: 100, props, consumers: [o.balanced ? { variant: 'square', label: '30' } : { variant: 'circle', count }], electrical });
  const r = runStudyE2(doc, { inputOrigin: 'e2-input', ...(o.balanced ? {} : { allocation: ON_A(count) }) });
  return { r, c: r.circuits.find((x) => x.spans.length)! };
};
const SPAN = { system: '3ph4w' as const };
const inputOf = (c: CircuitResult, name: string) => c.spans[0].pLossW.inputs.find((i) => i.name === name);

describe('10 / 11. missing RN and XN stay missing — no RN = R, no XN = X', () => {
  it('the entry of a type without neutral values has no rnAc, rnDc20 or xn', () => {
    const t = cableTypeEntry(use(rev()));
    expect(t.problems).toBeUndefined();
    expect(t.entry).toMatchObject({ rAc: { value: 0.5 }, x: { value: 0.08 }, cableKind: 'abc', neutral: { material: 'alloy', sectionMm2: 54.6 } });
    expect(t.entry!.rnAc).toBeUndefined();
    expect(t.entry!.rnDc20).toBeUndefined();
    expect(t.entry!.xn).toBeUndefined();
  });
  it('an unbalanced circuit: both reported, the drop and the losses unavailable for the neutral (never computed with R, X)', () => {
    const { r, c } = study({ ...SPAN, cableType: use(rev()) });
    expect(r.issues.filter((i) => i.code.startsWith('neutral:')).map((i) => i.code).sort()).toEqual(['neutral:reactance-missing', 'neutral:resistance-missing']);
    for (const q of [A(c).dropV.a, c.spans[0].pLossW, c.spans[0].qAbsorbedVar]) expect(q).toMatchObject({ status: 'unavailable', reason: 'neutral-impedance-missing' });
    expect(JSON.stringify(c.spans[0])).not.toMatch(/"name":"(RN|XN)"/);
  });
  it('only RN given: XN still missing (not X); only XN given: RN still missing (not R)', () => {
    const onlyRn = study({ ...SPAN, cableType: use(rev({ rn: val(0.9, 'ac') })) }).r;
    expect(onlyRn.issues.filter((i) => i.code.startsWith('neutral:')).map((i) => i.code)).toEqual(['neutral:reactance-missing']);
    const onlyXn = study({ ...SPAN, cableType: use(rev({ xn: val(0.2, 'ac-50hz') })) }).r;
    expect(onlyXn.issues.filter((i) => i.code.startsWith('neutral:')).map((i) => i.code)).toEqual(['neutral:resistance-missing']);
  });
  it('a balanced circuit that needs no neutral: computed without RN and XN (they are only reported)', () => {
    const { r, c } = study({ ...SPAN, cableType: use(rev()) }, { balanced: true });
    expect(A(c).dropV.a.status).toBe('computed');
    expect(c.completeness.status).toBe('computed');
    expect(r.issues.filter((i) => i.code.startsWith('neutral:')).every((i) => i.severity === 'reported')).toBe(true);
  });
});

describe('explicit values: the reference results, verification per value', () => {
  const full = (o: Partial<CableTypeData> = {}) => rev({ rn: val(0.5, 'ac'), xn: val(0.08, 'ac-50hz'), ...o });
  it('RN and XN explicit (synthetic, = R and X by choice): the N1 reference; one ABC = one complete set', () => {
    const { c } = study({ ...SPAN, cableType: use(full()) });
    for (const p of ['a', 'b', 'c'] as const) expect(Math.abs(A(c).dropV[p].value! - REF.N1.dV[p])).toBeLessThan(TOL.V);
    expect(Math.abs(c.spans[0].pLossW.value! - REF.N1.P)).toBeLessThan(TOL.W);
    expect(A(c).dropV.a.warnings).not.toContain('catalogue-unverified');
    expect(c.spans[0].pLossW.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'RN', provenance: 'catalogue', value: 0.5 }),
      expect.objectContaining({ name: 'XN', provenance: 'catalogue', value: 0.08 }),
      expect.objectContaining({ name: 'nN', provenance: 'cable-construction', value: 1 }),
    ]));
  });
  it('parallel = 2 complete ABC assemblies (each with its neutral): the drop of one set at half the current', () => {
    const { c } = study({ ...SPAN, parallel: 2, cableType: use(full()) }, { count: 10 });
    for (const p of ['a', 'b', 'c'] as const) expect(Math.abs(A(c).dropV[p].value! - REF.N1.dV[p])).toBeLessThan(TOL.V);
    expect(c.spans[0].pLossW.inputs).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'nN', provenance: 'cable-construction', value: 2 })]));
  });
  it('one unverified value → provisional (catalogue-unverified); checked or approved → no such warning', () => {
    const unverified = full({ xn: val(0.08, 'ac-50hz', { status: 'unverified' }) });
    const u = A(study({ ...SPAN, cableType: use(unverified) }).c).dropV.a;
    expect(u.status).toBe('provisional');
    expect(u.warnings).toContain('catalogue-unverified');
    expect(cableTypeEntry(use(unverified)).entry!.propertyVerification).toEqual({ rAc: 'checked', x: 'checked', rnAc: 'checked', xn: 'unverified' });
    const approved = A(study({ ...SPAN, cableType: use(full({ xn: val(0.08, 'ac-50hz', { status: 'approved' }) })) }).c).dropV.a;
    expect(approved.warnings).not.toContain('catalogue-unverified');
  });
  it('with an explicit (balanced) load: all checked / approved → computed; an unverified R → provisional', () => {
    expect(A(study({ ...SPAN, cableType: use(full({ r: val(0.5, 'ac', { status: 'approved' }) })) }, { balanced: true }).c).dropV.a.status).toBe('computed');
    const q = A(study({ ...SPAN, cableType: use(full({ r: val(0.5, 'ac', { status: 'unverified' }) })) }, { balanced: true }).c).dropV.a;
    expect([q.status, q.warnings]).toEqual(['provisional', ['catalogue-unverified']]);
  });
  it('an unverified value not needed by a balanced circuit (XN) does not make the phase result provisional', () => {
    const c = study({ ...SPAN, cableType: use(rev({ xn: val(0.08, 'ac-50hz', { status: 'unverified' }) })) }, { balanced: true }).c;
    expect(A(c).dropV.a.status).toBe('computed');
  });
});

describe('engineering correction: R, X, RN, XN reach the AC equations exactly as entered', () => {
  const full = (o: Partial<CableTypeData> = {}) => rev({ rn: val(0.6, 'ac'), xn: val(0.09, 'ac-50hz'), ...o });
  const res = (value: number, basis: 'ac' | 'dc' | 'unspecified', more: Pick<ElectricalValue, 'referenceTempC' | 'conversion'> = {}): ElectricalValue<'ac' | 'dc' | 'unspecified'> => ({ ...val(value, basis), ...more });
  const neutralCodes = (r: ReturnType<typeof study>['r']) => r.issues.filter((i) => i.code.startsWith('neutral:')).map((i) => i.code).sort();
  const values = (c: CircuitResult) => ['R', 'X', 'RN', 'XN'].map((n) => inputOf(c, n)?.value);

  it('C1. R and X are used unchanged', () => {
    const { c } = study({ ...SPAN, cableType: use(full({ r: res(0.537, 'ac'), x: val(0.0843, 'ac-50hz') })) }, { balanced: true, tempC: 70 });
    expect([inputOf(c, 'R')!.value, inputOf(c, 'X')!.value]).toEqual([0.537, 0.0843]);
    expect(A(c).dropV.a.inputs.length + c.spans[0].pLossW.inputs.length).toBeGreaterThan(0);
  });
  it('C2. RN and XN are used unchanged', () => {
    const { c } = study({ ...SPAN, cableType: use(full({ rn: res(0.912, 'unspecified'), xn: val(0.0977, 'ac-50hz') })) }, { tempC: 90 });
    expect([inputOf(c, 'RN')!.value, inputOf(c, 'XN')!.value]).toEqual([0.912, 0.0977]);
  });
  it('C3. no DC → AC conversion: a value stated as DC stays DC, unconverted, and is noted (never treated as a documented AC value)', () => {
    const t = full({ r: res(0.443, 'dc', { referenceTempC: 20 }), rn: res(0.63, 'dc') });
    const e = cableTypeEntry(use(t)).entry!;
    expect([e.rAc, e.rnAc]).toEqual([undefined, undefined]);
    expect([e.rDc20!.value, e.rnDc20!.value]).toEqual([0.443, 0.63]);
    const { c } = study({ ...SPAN, cableType: use(t) }, { balanced: true, tempC: 90 });
    expect(inputOf(c, 'R')).toMatchObject({ value: 0.443, ref: expect.stringContaining('DC, reference temperature 20 degC; used as entered, no conversion') });
    expect(A(c).dropV.a.warnings).toEqual(['dc-resistance-as-entered']);
    expect(A(c).dropV.a.status).toBe('provisional');
    expect(typeof issueTextKey('cable-type:conversion-not-applied')).toBe('string');
  });
  it('C4. no F8, even when a conversion is requested on the value: the request is kept and reported, the value used as entered', () => {
    const t = full({ r: res(0.443, 'dc', { referenceTempC: 20, conversion: 'dc20-to-conductor-temp' }), rn: res(0.443, 'dc', { referenceTempC: 20, conversion: 'dc20-to-conductor-temp' }) });
    const { r, c } = study({ ...SPAN, cableType: use(t) }, { tempC: 70 });
    expect([inputOf(c, 'R')!.value, inputOf(c, 'RN')!.value]).toEqual([0.443, 0.443]);
    expect(r.issues.filter((i) => i.code === 'cable-type:conversion-not-applied')).toEqual([
      { code: 'cable-type:conversion-not-applied', severity: 'reported', target: { kind: 'span', id: 'k1#0' }, params: { property: 'R' } },
      { code: 'cable-type:conversion-not-applied', severity: 'reported', target: { kind: 'span', id: 'k1#0' }, params: { property: 'RN' } },
    ]);
    expect(t.r.conversion).toBe('dc20-to-conductor-temp');
    expect(JSON.stringify(c)).not.toContain('dc-resistance-used');
  });
  it('C5. no IEC 60228 conversion: a cable type without R gets no table value from the span\'s material / section', () => {
    const t = full({ r: val(undefined, 'unspecified'), rn: val(undefined, 'unspecified') });
    const { r, c } = study({ ...SPAN, cableKind: 'abc', material: 'al', crossSectionMm2: 70, neutralMaterial: 'al', neutralCrossSectionMm2: 70, cableType: use(t) }, { balanced: true, tempC: 70 });
    expect(A(c).dropV.a).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
    expect(JSON.stringify(c)).not.toContain('iec-table');
    expect(neutralCodes(r)).toContain('neutral:resistance-missing');
  });
  it('C6. the conductor temperature does not change R or RN', () => {
    const t = full({ r: res(0.443, 'dc', { referenceTempC: 20 }), rn: res(0.6, 'ac', { referenceTempC: 90 }) });
    const seen = [undefined, 20, 70, 90].map((tempC) => values(study({ ...SPAN, cableType: use(t) }, { tempC }).c));
    for (const v of seen) expect(v).toEqual([0.443, 0.08, 0.6, 0.09]);
  });
  it('C7. the ambient temperature does not change R or RN, and is kept apart in the settings', () => {
    const t = full({ r: res(0.5, 'ac', { referenceTempC: 20 }), rn: res(0.6, 'unspecified') });
    for (const [tempC, ambientC] of [[undefined, 45], [70, 45], [70, -5]] as const) {
      const { r, c } = study({ ...SPAN, cableType: use(t) }, { tempC, ambientC });
      expect([r.settings.ambientTempC, r.settings.conductorTempC]).toEqual([ambientC, tempC]);
      expect(values(c)).toEqual([0.5, 0.08, 0.6, 0.09]);
    }
  });
  it('C8. no reference temperature is assumed when none is given (and its absence alone does not make the result provisional)', () => {
    for (const basis of ['unspecified', 'ac'] as const) {
      const t = full({ r: res(0.5, basis) });
      expect('referenceTempC' in t.r).toBe(false);
      expect(thermalBasis(t.r)).toBe('unspecified');
      const { c } = study({ ...SPAN, cableType: use(t) }, { balanced: true, tempC: 70 });
      expect(inputOf(c, 'R')).toMatchObject({ value: 0.5, ref: expect.stringContaining('reference temperature unspecified') });
      expect(inputOf(c, 'R')!.ref).not.toMatch(/\b(20|70|90) degC/);
      expect([A(c).dropV.a.status, A(c).dropV.a.warnings]).toEqual(['computed', []]);
    }
  });
  it('C9. RN and XN are never inferred: missing stays missing (not R, not X, not 0)', () => {
    const { r, c } = study({ ...SPAN, cableType: use(rev()) });
    expect(neutralCodes(r)).toEqual(['neutral:reactance-missing', 'neutral:resistance-missing']);
    expect([inputOf(c, 'RN'), inputOf(c, 'XN')]).toEqual([undefined, undefined]);
    expect(c.spans[0].pLossW).toMatchObject({ status: 'unavailable', reason: 'neutral-impedance-missing' });
    const e = cableTypeEntry(use(rev())).entry!;
    expect([e.rnAc, e.rnDc20, e.xn]).toEqual([undefined, undefined, undefined]);
  });
  it('C10. the values, their basis, reference temperature and conversion request survive snapshot and revision unchanged', () => {
    const t = full({ r: res(0.443, 'dc', { referenceTempC: 20, conversion: 'dc20-to-conductor-temp' }), rn: res(0.6, 'unspecified') });
    const span = assignCableType({ poles: ['T', 'A'] }, t);
    expect(span.cableType!.snapshot.r).toEqual({ value: 0.443, unit: 'ohm/km', basis: 'dc', referenceTempC: 20, conversion: 'dc20-to-conductor-temp', verification: checked });
    expect(span.cableType!.snapshot.rn).toEqual({ value: 0.6, unit: 'ohm/km', basis: 'unspecified', verification: checked });
    const before = JSON.stringify(span);
    study({ ...SPAN, cableType: span.cableType }, { tempC: 70, ambientC: 40 });
    expect(JSON.stringify(span)).toBe(before);
    // a later revision changes neither the earlier snapshot nor its result
    const h1 = createCableType('ct_syn', abcData({ r: res(0.5, 'unspecified'), rn: val(0.6, 'ac'), xn: val(0.09, 'ac-50hz') }), { now: 1 });
    const used = assignCableType({ poles: ['T', 'A'], ...SPAN }, latestRevision(h1));
    const usedBefore = JSON.stringify(used);
    const h2 = editCableType(h1, { r: { value: 0.443, unit: 'ohm/km', basis: 'dc', referenceTempC: 20 } }, { now: 2 }).history;
    expect(latestRevision(h2)).toMatchObject({ revision: 2, r: { value: 0.443, basis: 'dc', referenceTempC: 20 } });
    expect(h2.revisions[0]).toEqual(latestRevision(h1));
    expect(JSON.stringify(used)).toBe(usedBefore);
    expect(inputOf(study({ ...SPAN, cableType: used.cableType }, { tempC: 70 }).c, 'R')!.value).toBe(0.5);
  });
  it('C11. E1 is not changed: the same results with or without a cable type on the span', () => {
    const t = full();
    const legacy = { ...SPAN, cableKind: 'abc' as const, material: 'al' as const, crossSectionMm2: 70, rOhmPerKm: 0.5, xOhmPerKm: 0.08, rNeutralOhmPerKm: 0.6, dataSource: 'synthetic' };
    const plain = drawing({ Lm: 100, props: legacy, consumers: [{ variant: 'circle', count: 5 }], electrical: { conductorTempC: 70 } }).doc;
    // the same document (same span id), only the cable type added to the span
    const typed = { ...plain, elements: plain.elements.map((e) => (e.type === 'cable' ? { ...e, spanProps: Object.fromEntries(Object.entries(e.spanProps!).map(([k, v]) => [k, { ...v, cableType: use(t) }])) } : e)) };
    expect(JSON.stringify(typed)).toContain('"cableType"');
    expect(JSON.stringify(runStudy(typed))).toBe(JSON.stringify(runStudy(plain)));
  });
  it('C12. the same inputs give the same phasors, drops and losses as the Stage A catalogue path', () => {
    const t = full({ rn: res(0.5, 'ac'), xn: val(0.08, 'ac-50hz') });
    const viaType = study({ ...SPAN, cableType: use(t) }).c;
    const { doc } = drawing({ Lm: 100, props: SPAN, consumers: [{ variant: 'circle', count: 5 }] });
    const entry = { ...cableTypeEntry(use(t)).entry!, id: 'same-values' };
    const viaCatalogue = runStudyE2(doc, { inputOrigin: 'e2-input', allocation: ON_A(5), catalogue: { documents: cableTypeEntry(use(t)).documents, entries: [entry] }, catalogueSelection: { k1: { entryId: 'same-values' } } }).circuits.find((x) => x.spans.length)!;
    // everything except where the inputs are listed from (the entry id in `ref`): values, phasors, statuses
    const numbers = (c: CircuitResult) => JSON.stringify({ n: c.nodes.map((n) => [n.dropV, n.voltage, n.neutralShiftV]), s: c.spans.map((sp) => [sp.current, sp.dropV, sp.pLossW, sp.qAbsorbedVar]) }, (k, v) => (k === 'ref' ? undefined : v));
    expect(numbers(viaType)).toBe(numbers(viaCatalogue));
    for (const p of ['a', 'b', 'c'] as const) expect(Math.abs(A(viaType).dropV[p].value! - REF.N1.dV[p])).toBeLessThan(TOL.V);
  });
  it('numeric: the entered R, X, RN, XN are the ones in the loss equation (20 A on a, 100 m)', () => {
    // |Ia| = |IN| = 20 A, L = 0.1 km: P = 20²·(R + RN)·0.1, Q = 20²·(X + XN)·0.1
    const t = full({ r: res(0.7, 'dc', { referenceTempC: 20 }), x: val(0.1, 'ac-50hz'), rn: res(0.9, 'unspecified'), xn: val(0.2, 'ac-50hz') });
    for (const [tempC, ambientC] of [[undefined, undefined], [90, 45]] as const) {
      const { c } = study({ ...SPAN, cableType: use(t) }, { tempC, ambientC });
      expect(values(c)).toEqual([0.7, 0.1, 0.9, 0.2]);
      expect(Math.abs(c.spans[0].current.a.value!.magnitude - 20)).toBeLessThan(TOL.A);
      expect(Math.abs(c.spans[0].current.n.value!.magnitude - 20)).toBeLessThan(TOL.A);
      expect(Math.abs(c.spans[0].pLossW.value! - 400 * (0.7 + 0.9) * 0.1)).toBeLessThan(TOL.W); // 64 W
      expect(Math.abs(c.spans[0].qAbsorbedVar.value! - 400 * (0.1 + 0.2) * 0.1)).toBeLessThan(TOL.W); // 12 var
      expect(A(c).dropV.a.inputs.length === 0 || A(c).dropV.a.value! > 0).toBe(true);
    }
  });
});

describe('project overrides, the span\'s own values, refused types', () => {
  it('an override replaces only that value, keeps its own source and verification; the snapshot is not changed', () => {
    const t = rev();
    const ct = use(t, { rn: { value: 0.9, unit: 'ohm/km', basis: 'ac', source: { name: 'site measurement', page: 'm-1' }, verification: { status: 'unverified' } } });
    const before = JSON.stringify(ct.snapshot);
    const e = cableTypeEntry(ct);
    expect(e.entryId).toBe('cable-type:ct_syn@1+project(rn)');
    expect(e.entry!.rnAc).toMatchObject({ value: 0.9, source: { page: 'm-1' }, conditions: expect.stringContaining('project override') });
    expect(e.documents.map((d) => d.manufacturer)).toContain('site measurement');
    expect(e.entry!.propertyVerification!.rnAc).toBe('unverified');
    expect(e.entry!.xn).toBeUndefined();
    expect(JSON.stringify(ct.snapshot)).toBe(before);
  });
  it('the span\'s own typed values are not used next to a cable type (no silent substitution)', () => {
    const own = { rOhmPerKm: 9, xOhmPerKm: 9, rNeutralOhmPerKm: 9, neutralMaterial: 'al' as const, neutralCrossSectionMm2: 70, cableKind: 'abc' as const, dataSource: 'x' };
    const { r, c } = study({ ...SPAN, ...own, cableType: use(rev()) }, { balanced: true });
    expect(inputOf(c, 'R')).toMatchObject({ value: 0.5, provenance: 'catalogue' });
    expect(inputOf(c, 'X')).toMatchObject({ value: 0.08, provenance: 'catalogue' });
    expect(r.issues.filter((i) => i.code.startsWith('neutral:')).map((i) => i.code).sort()).toEqual(['neutral:reactance-missing', 'neutral:resistance-missing']);
  });
  it('a type that does not describe its neutral conductor is refused whole and reported', () => {
    const { r, c } = study({ ...SPAN, cableType: use(rev({ neutral: { material: 'alloy' } })) });
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'catalogue:entry-refused', params: { entryId: 'cable-type:ct_syn@1', problems: 'neutral:construction' } }));
    expect(A(c).dropV.a.status).toBe('unavailable');
  });
  it('the snapshot is what is calculated: a newer library revision changes nothing until the span is updated', () => {
    const h1 = createCableType('ct_syn', abcData({ rn: val(0.5, 'ac'), xn: val(0.08, 'ac-50hz') }), { now: 1 });
    const used = use(latestRevision(h1));
    const h2 = editCableType(h1, { r: { value: 0.6, unit: 'ohm/km', basis: 'ac' } }, { now: 2 }).history;
    expect(latestRevision(h2).revision).toBe(2);
    const { c } = study({ ...SPAN, cableType: used });
    expect(inputOf(c, 'R')!.value).toBe(0.5);
    // a verification change is a revision too, and also not applied by itself
    expect(setCableTypeVerification(h2, 'r', { status: 'approved' }, { now: 3 }).history.revisions).toHaveLength(3);
  });
});
