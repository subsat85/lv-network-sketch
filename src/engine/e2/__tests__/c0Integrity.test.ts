import { describe, expect, it } from 'vitest';
import type { CableTypeData, CableTypeRevision, SpanCableType } from '../../../types/cableType';
import type { CableElement, DrawingElement, SpanProps, SymbolElement } from '../../../types/drawing';
import { assignCableType, cableTypeCompleteness, cableTypeMergeConflict, cableTypeRevisionProblem, createCableType, editCableType, latestRevision, setCableTypeOverride } from '../../../utils/cableTypeModel';
import { fromForm, toForm } from '../../../components/SpanPropertiesSheet';
import { hasElectrical, normalizeElements, reconcileCable, sameElectrical, spanAt, withSpanProps } from '../../../utils/spanModel';
import { defaultSpanValues, fillMissingSpanDefaults, planMissingDefaults } from '../../../utils/spanDefaults';
import { serializeProject, validateProjectFile } from '../../../utils/projectSerialization';
import { DEFAULT_ELECTRICAL } from '../../../utils/electricalSettings';
import { AR_TR } from '../../../utils/vdLabels';
import { issueTextKey } from '../../../utils/e2Presentation';
import { translate } from '../../../i18n';
import { cableTypeEntry } from '../catalogue/cableTypes';
import { resolveSpan } from '../catalogue/resolve';
import { runStudyE2 } from '../index';
import type { CircuitResult } from '../model';
import { drawing } from './references';

// Stage C0: cable type integrity — the span form keeps the cable type, merge / split treat it as part
// of the span's electrical identity, an unresolved merge of different cable types is not calculated by
// E2, the company table never fills a span linked to the library, and X = 0 is an entered value.
// ALL VALUES ARE SYNTHETIC.

const v = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz', status: 'unverified' | 'checked' | 'approved' = 'checked') =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km' as const, basis, verification: { status } }) as never;
const data = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'synthetic ABC', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: v(0.5, 'ac'), x: v(0.08, 'ac-50hz'), rn: v(0.6, 'unspecified'), xn: v(0.09, 'ac-50hz'), source: { name: 'synthetic', page: '1' }, ...o,
});
const h1 = createCableType('ct_a', data(), { now: 1 });
const R1 = latestRevision(h1);
const R2 = latestRevision(editCableType(h1, { r: { value: 0.55, unit: 'ohm/km', basis: 'ac' } }, { now: 2 }).history);
const OTHER = latestRevision(createCableType('ct_b', data({ name: 'other' }), { now: 3 }));
const linked = (rev: CableTypeRevision, more: Omit<SpanProps, 'poles'> = {}, poles: [string, string] = ['A', 'B']): SpanProps => assignCableType({ poles, system: '3ph4w', ...more }, rev, 10);
const withOverride = (p: SpanProps) => setCableTypeOverride(p, 'rn', { value: 0.9, unit: 'ohm/km', basis: 'ac', source: { name: 'site' }, verification: { status: 'approved', by: 'eng' } });

const pole = (id: string, x: number) => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as SymbolElement;
/** a cable over `poles`, the given record on each span (by index) */
const cableWith = (poles: string[], recs: (Omit<SpanProps, 'poles'> | undefined)[]): CableElement => {
  const els = normalizeElements([...poles.map((p, i) => pole(p, i * 100)), { id: 'k1', type: 'cable', x: 0, y: 0, poleIds: poles, cableIndex: 0, offset: 0, strokeColor: '#f00', fillColor: 'none', strokeWidth: 2 } as CableElement]);
  let k = els[els.length - 1] as CableElement;
  recs.forEach((r, i) => { if (r) k = withSpanProps(k, k.spanIds![i], { ...r, poles: [poles[i], poles[i + 1]] }); });
  return k;
};
let n = 0;
const gen = () => `new${++n}`;
const records = (k: CableElement) => k.spanIds!.map((id) => k.spanProps?.[id]);
const noPoles = ({ poles: _p, ...rest }: SpanProps) => rest;

describe('G1. the span form keeps the cable type', () => {
  it('1. open → save (with or without other edits) keeps the reference, revision, snapshot, overrides and verification exactly', () => {
    const stored = withOverride(linked(R2, { rOhmPerKm: 0.4, dataSource: 'old' }));
    const same = fromForm(toForm(stored, '30'), ['A', 'B'], stored, AR_TR);
    expect(same.errors).toEqual([]);
    expect(same.props.cableType).toEqual(stored.cableType);
    expect(same.props.cableType!.overrides!.rn!.verification).toEqual({ status: 'approved', by: 'eng' });
    // another field edited: the cable type is untouched
    const edited = fromForm({ ...toForm(stored, '30'), r: '0.45', parallel: '2' }, ['A', 'B'], stored, AR_TR).props;
    expect([edited.rOhmPerKm, edited.parallel]).toEqual([0.45, 2]);
    expect(edited.cableType).toEqual(stored.cableType);
    // the sheet's save keeps a record that has a cable type and nothing else
    const only = linked(R1);
    const saved = fromForm(toForm(only, ''), ['A', 'B'], only, AR_TR).props;
    expect(hasElectrical(saved)).toBe(true);
    const empty = cableWith(['A', 'B'], [undefined]);
    const k = withSpanProps(empty, empty.spanIds![0], saved);
    expect(spanAt(k, 0).props!.cableType).toEqual(only.cableType);
  });
  it('a span without a cable type saves exactly as before (no cableType key added)', () => {
    const stored: SpanProps = { poles: ['A', 'B'], material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 's', review: ['split'] };
    const out = fromForm(toForm(stored, ''), ['A', 'B'], stored, AR_TR).props;
    expect(out).toEqual({ poles: ['A', 'B'], material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 's' });
    expect('cableType' in out).toBe(false);
  });
  it('saving the form does not resolve a cable type merge conflict (no cable type is chosen by it)', () => {
    const conflicted: SpanProps = { ...linked(R1), review: ['merge-different', 'split'], mergedFrom: [noPoles(linked(R1)), noPoles(linked(OTHER))] };
    const out = fromForm(toForm(conflicted, ''), ['A', 'B'], conflicted, AR_TR).props;
    expect(out.mergedFrom).toEqual(conflicted.mergedFrom);
    expect(out.review).toEqual(['merge-different']);
    expect(cableTypeMergeConflict(out)).toBe(true);
  });
});

describe('G2. merge, split and inheritance with a cable type', () => {
  it('2. a split keeps the cable type on both new spans (and marks them split)', () => {
    const prev = cableWith(['A', 'B'], [noPoles(withOverride(linked(R1)))]);
    const next = reconcileCable(prev, { ...prev, poleIds: ['A', 'M', 'B'] }, gen);
    const [a, b] = records(next);
    for (const r of [a, b]) {
      expect(r!.cableType).toEqual(prev.spanProps![prev.spanIds![0]].cableType);
      expect(r!.review).toContain('split');
    }
    expect([a!.poles, b!.poles]).toEqual([['A', 'M'], ['M', 'B']]);
  });
  it('3. merging spans with the same cable type (same revision, overrides) makes no conflict', () => {
    const rec = noPoles(withOverride(linked(R1, { parallel: 1 })));
    const prev = cableWith(['A', 'B', 'C'], [rec, rec]);
    const [m] = records(reconcileCable(prev, { ...prev, poleIds: ['A', 'C'] }, gen));
    expect(m!.cableType).toEqual(rec.cableType);
    expect(m!.review ?? []).not.toContain('merge-different');
    expect(m!.mergedFrom).toBeUndefined();
    expect(cableTypeMergeConflict(m)).toBe(false);
  });
  it('4. merging spans with a different type, revision or overrides: merge-different, every original kept, nothing chosen', () => {
    const a = noPoles(linked(R1));
    const cases: [string, Omit<SpanProps, 'poles'> | undefined][] = [
      ['other type', noPoles(linked(OTHER))],
      ['other revision', noPoles(linked(R2))],
      ['other overrides', noPoles(withOverride(linked(R1)))],
      ['no cable type', { system: '3ph4w', rOhmPerKm: 0.5, xOhmPerKm: 0.08 }],
      ['no record', undefined],
    ];
    for (const [name, b] of cases) {
      const prev = cableWith(['A', 'B', 'C'], [a, b]);
      const [m] = records(reconcileCable(prev, { ...prev, poleIds: ['A', 'C'] }, gen));
      expect(m!.review, name).toContain(b ? 'merge-different' : 'merge-partial');
      expect(m!.mergedFrom, name).toEqual([a, b ?? null]);
      expect(cableTypeMergeConflict(m), name).toBe(true);
    }
    // the other order: the merged record takes the first one's values; the conflict is the same
    const prev = cableWith(['A', 'B', 'C'], [noPoles(linked(OTHER)), a]);
    expect(cableTypeMergeConflict(records(reconcileCable(prev, { ...prev, poleIds: ['A', 'C'] }, gen))[0])).toBe(true);
  });
  it('a span with only a cable type is inherited while drawing (a copy of the same snapshot)', () => {
    const prev = cableWith(['A', 'B'], [noPoles(linked(R1))]);
    const [, added] = records(reconcileCable(prev, { ...prev, poleIds: ['A', 'B', 'C'] }, gen));
    expect(added).toMatchObject({ poles: ['B', 'C'], inherited: true, cableType: prev.spanProps![prev.spanIds![0]].cableType });
  });
  it('7. spans without a cable type compare, merge and inherit as before', () => {
    const p: SpanProps = { poles: ['A', 'B'], material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.5 };
    expect([sameElectrical(p, { ...p }), sameElectrical(p, { ...p, rOhmPerKm: 0.6 }), hasElectrical(p), hasElectrical({ poles: ['A', 'B'] })]).toEqual([true, false, true, false]);
    const legacy = cableWith(['A', 'B', 'C'], [noPoles(p), { ...noPoles(p), rOhmPerKm: 0.6 }]);
    const [m] = records(reconcileCable(legacy, { ...legacy, poleIds: ['A', 'C'] }, gen));
    expect(m).toEqual({ poles: ['A', 'C'], material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.5, review: ['merge-different'], mergedFrom: [noPoles(p), { ...noPoles(p), rOhmPerKm: 0.6 }] });
    expect(cableTypeMergeConflict(m)).toBe(false);
  });
});

const ON_A = { consumers: { u0: { a: 5, source: 'design', verification: { status: 'checked' } } }, singlePhaseSpans: {} } as never;
const e2 = (props: Omit<SpanProps, 'poles'>, balanced = true) => {
  const { doc } = drawing({ Lm: 100, props, consumers: [balanced ? { variant: 'square', label: '30' } : { variant: 'circle', count: 5 }], electrical: { conductorTempC: 70 } });
  const r = runStudyE2(doc, { inputOrigin: 'legacy-project', ...(balanced ? {} : { allocation: ON_A }) });
  return { r, c: r.circuits.find((x) => x.spans.length)! as CircuitResult };
};
// the span's own quantities (its drop follows from the node voltages: unavailable, from the node)
// (its phase currents are 'node-voltage-unknown' — the sweep's rule for any blocked span, unchanged)
const spanQs = (c: CircuitResult) => [c.spans[0].pLossW, c.spans[0].qAbsorbedVar, ...Object.values(c.nodes.find((x) => x.poleId === 'A')!.dropV)];

describe('E2 and an unresolved merge of different cable types', () => {
  it('5. not calculated: one blocking issue, every quantity of the span unavailable (cable-type-conflict), nothing else claimed', () => {
    const merged: Omit<SpanProps, 'poles'> = { ...noPoles(linked(R1)), review: ['merge-different'], mergedFrom: [noPoles(linked(R1)), noPoles(linked(OTHER))] };
    for (const balanced of [true, false]) {
      const { r, c } = e2(merged, balanced);
      const mine = r.issues.filter((i) => i.target.kind === 'span' && i.target.id === 'k1#0').map((i) => i.code);
      expect(mine).toEqual(['cable-type:merge-conflict']);
      expect(r.issues.find((i) => i.code === 'cable-type:merge-conflict')).toEqual({ code: 'cable-type:merge-conflict', severity: 'blocks', target: { kind: 'span', id: 'k1#0' }, params: { records: 2 } });
      for (const q of spanQs(c)) expect(q).toMatchObject({ status: 'unavailable', reason: 'cable-type-conflict' });
      for (const q of Object.values(c.spans[0].dropV)) expect(q.status).toBe('unavailable');
      for (const k of ['a', 'b', 'c'] as const) expect(c.spans[0].current[k]).toMatchObject({ status: 'unavailable', reason: 'node-voltage-unknown' });
      expect(c.completeness).toMatchObject({ status: 'unavailable', reason: 'cable-type-conflict' });
      expect(JSON.stringify(c)).not.toMatch(/"name":"(R|X|RN|XN)"/);
    }
    // the same merge with the same cable type is calculated
    const same: Omit<SpanProps, 'poles'> = { ...noPoles(linked(R1)), review: ['merge-different'], mergedFrom: [noPoles(linked(R1)), { ...noPoles(linked(R1)), parallel: 1 }] };
    expect(cableTypeMergeConflict(same)).toBe(false);
    expect(e2(same).c.nodes.find((x) => x.poleId === 'A')!.dropV.a.status).not.toBe('unavailable');
    for (const code of ['cable-type:merge-conflict', 'cable-type:legacy-values-ignored']) {
      expect(translate('ar', issueTextKey(code)!), code).toMatch(/[؀-ۿ]/);
      expect(typeof translate('en', issueTextKey(code)!), code).toBe('string');
    }
  });
  it('a legacy merge without cable types is calculated as before (only its review warning)', () => {
    const merged = { system: '3ph4w' as const, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 's', review: ['merge-different' as const], mergedFrom: [{ rOhmPerKm: 0.5 }, { rOhmPerKm: 0.6 }] };
    const { r, c } = e2(merged);
    expect(r.issues.some((i) => i.code === 'cable-type:merge-conflict')).toBe(false);
    expect(c.nodes.find((x) => x.poleId === 'A')!.dropV.a).toMatchObject({ status: 'provisional', warnings: expect.arrayContaining(['span-review']) });
  });
  it('the difference with E1 is stated: a span with a cable type and its own R / X / Rn', () => {
    const { r } = e2({ ...noPoles(linked(R1)), rOhmPerKm: 0.4, xOhmPerKm: 0.07 });
    expect(r.issues).toContainEqual({ code: 'cable-type:legacy-values-ignored', severity: 'reported', target: { kind: 'span', id: 'k1#0' }, params: { fields: 'R,X' } });
    expect(e2(noPoles(linked(R1))).r.issues.some((i) => i.code === 'cable-type:legacy-values-ignored')).toBe(false);
  });
});

describe('G3. the company table never fills a span linked to the library', () => {
  it('6. fillMissingSpanDefaults and «fill the defaults» skip it; its fields stay as they are', () => {
    const only = linked(R1);
    expect(fillMissingSpanDefaults(only, ['A', 'B'])).toBeNull();
    expect(fillMissingSpanDefaults({ ...only, material: 'al', crossSectionMm2: 70 }, ['A', 'B'])).toBeNull();
    const k = cableWith(['A', 'B', 'C'], [noPoles(only), undefined]);
    const plan = planMissingDefaults([k]);
    const after = plan.updates[0].changes.spanProps!;
    expect(after[k.spanIds![0]]).toEqual(k.spanProps![k.spanIds![0]]);
    expect([plan.empty, plan.partial]).toEqual([1, 0]);
    // E2 does not read the company table values for it (it has none, and uses the snapshot)
    expect(JSON.stringify(after[k.spanIds![0]])).not.toContain('"rOhmPerKm"');
  });
  it('7. an old span without a cable type is still filled exactly as before', () => {
    expect(fillMissingSpanDefaults(undefined, ['A', 'B'])).toEqual({ ...defaultSpanValues(), poles: ['A', 'B'], review: ['defaults'] });
    expect(fillMissingSpanDefaults({ poles: ['A', 'B'], material: 'al', crossSectionMm2: 70 }, ['A', 'B'])).toMatchObject({ rOhmPerKm: expect.any(Number), xOhmPerKm: expect.any(Number), review: ['defaults'] });
  });
});

describe('X = 0 is an entered value; a missing X stays missing', () => {
  const style = { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
  const roundTrip = (props: SpanProps) => {
    const k = cableWith(['A', 'B'], [noPoles(props)]);
    const v1 = validateProjectFile(JSON.parse(serializeProject([pole('A', 0), pole('B', 100), k] as DrawingElement[], style, 1, 'circle', { A_B: '30' }, {}, 'p', 'x', undefined, undefined, DEFAULT_ELECTRICAL, {})));
    return v1;
  };
  it('8. X = 0 through the form, export / import, the library and E2', () => {
    const form = fromForm({ ...toForm(undefined, ''), r: '0.5', x: '0', system: '3ph4w' }, ['A', 'B'], undefined, AR_TR);
    expect(form.errors).toEqual([]);
    expect(form.props.xOhmPerKm).toBe(0);
    const imported = roundTrip(form.props);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(spanAt(imported.data.elements.find((e): e is CableElement => e.type === 'cable')!, 0).props!.xOhmPerKm).toBe(0);
    expect(resolveSpan('k', form.props, undefined, undefined, {}, 'legacy-project').x).toMatchObject({ value: 0, input: { provenance: 'project' } });
    // the library: X = 0 is complete and calculable (X N, R, RN keep their > 0 rule)
    const zero = latestRevision(createCableType('ct_z', data({ x: v(0, 'ac-50hz') }), { now: 1 }));
    expect(cableTypeRevisionProblem(zero)).toBeNull();
    expect(cableTypeCompleteness(zero).missing).not.toContain('x');
    expect(cableTypeRevisionProblem({ ...zero, xn: v(0, 'ac-50hz') })).toBe('xn.value');
    expect(cableTypeRevisionProblem({ ...zero, r: v(0, 'ac') })).toBe('r.value');
    const entry = cableTypeEntry({ typeId: zero.id, revision: 1, snapshot: zero } as SpanCableType);
    expect([entry.problems, entry.entry!.x!.value]).toEqual([undefined, 0]);
    const { c } = e2(noPoles(linked(zero)));
    expect(c.spans[0].pLossW.inputs.find((i) => i.name === 'X')!.value).toBe(0);
    expect(c.nodes.find((x) => x.poleId === 'A')!.dropV.a.status).toBe('computed');
    // other zero values are still refused on import
    expect(roundTrip({ ...form.props, rOhmPerKm: 0 } as SpanProps).ok).toBe(false);
  });
  it('9. a missing X stays missing (never 0): form, import, library, E2', () => {
    const form = fromForm({ ...toForm(undefined, ''), r: '0.5', x: '', system: '3ph4w' }, ['A', 'B'], undefined, AR_TR).props;
    expect('xOhmPerKm' in form).toBe(false);
    const imported = roundTrip(form);
    expect(imported.ok && 'xOhmPerKm' in spanAt(imported.data.elements.find((e): e is CableElement => e.type === 'cable')!, 0).props!).toBe(false);
    const noX = latestRevision(createCableType('ct_n', data({ x: v(undefined, 'ac-50hz') }), { now: 1 }));
    expect(cableTypeCompleteness(noX).missing).toContain('x');
    expect(cableTypeEntry({ typeId: noX.id, revision: 1, snapshot: noX } as SpanCableType).entry!.x).toBeUndefined();
    const { r, c } = e2({ system: '3ph4w', rOhmPerKm: 0.5, dataSource: 's' });
    expect(r.issues.map((i) => i.code)).toContain('phase:reactance-missing');
    expect(c.nodes.find((x) => x.poleId === 'A')!.dropV.a).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
  });
});
