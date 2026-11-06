import { describe, expect, it } from 'vitest';
import type { CableTypeData, CableTypeRevision } from '../../types/cableType';
import { createCableType, editCableType, latestRevision, setCableTypeVerification } from '../cableTypeModel';
import { compareRevisions, filterTypes, NO_FILTER, revisionChanges, searchableText, typeVerification, valueView } from '../cableLibraryView';

// Stage C2: the library screens' logic (search, filters, values as stored, revision comparison).
// ALL VALUES ARE SYNTHETIC.

const v = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz', status: 'unverified' | 'checked' | 'approved' = 'checked', more: object = {}) =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km', basis, verification: { status }, ...more }) as never;
const data = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'ABC 3x70', description: 'overhead feeder', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: v(0.5, 'ac'), x: v(0.08, 'ac-50hz'), rn: v(0.6, 'ac'), xn: v(0.09, 'ac-50hz'), source: { name: 'maker', reference: 'sheet 7' }, ...o,
});
const rev = (id: string, o: Partial<CableTypeData> = {}) => latestRevision(createCableType(id, data(o), { now: 1 }));
const LABELS = { construction: (c: string) => ({ abc: 'ABC معزول', underground: 'أرضي', bare: 'مكشوف', other: 'آخر' } as Record<string, string>)[c], material: (m: string) => ({ al: 'ألمنيوم', cu: 'نحاس', alloy: 'سبيكة' } as Record<string, string>)[m] };
const deepFreeze = <T,>(x: T): T => { if (x && typeof x === 'object') { Object.freeze(x); for (const k of Object.keys(x)) deepFreeze((x as Record<string, unknown>)[k]); } return x; };

const TYPES = deepFreeze([
  rev('t1'),
  rev('t2', { name: 'UG 4x95 Cu', description: 'underground copper', construction: 'underground', phase: { material: 'cu', sectionMm2: 95 }, neutral: { material: 'cu', sectionMm2: 95 }, r: v(0.2, 'dc', 'approved'), x: v(0.07, 'ac-50hz', 'approved'), rn: v(0.2, 'dc', 'approved'), xn: v(0.07, 'ac-50hz', 'approved') }),
  rev('t3', { name: 'Bare draft', description: undefined, construction: 'bare', neutralConductors: 0, neutral: undefined, x: v(undefined, 'ac-50hz'), rn: v(undefined, 'ac'), xn: v(undefined, 'ac-50hz'), r: v(0.3, 'unspecified', 'unverified') }),
  rev('t4', { name: 'Other cable', construction: 'other', r: v(0.4, 'ac', 'approved'), x: v(0.1, 'ac-50hz', 'checked'), rn: v(0.4, 'ac', 'approved'), xn: v(0.1, 'ac-50hz', 'approved') }),
]) as CableTypeRevision[];
const ids = (f: Partial<typeof NO_FILTER>) => filterTypes(TYPES, { ...NO_FILTER, ...f }, LABELS).map((t) => t.id);

describe('search (on the loaded list only)', () => {
  it('5. by name and by description, any case, every word must match', () => {
    expect(ids({ query: 'bare' })).toEqual(['t3']);
    expect(ids({ query: 'UNDERGROUND copper' })).toEqual(['t2']);
    expect(ids({ query: 'feeder' })).toEqual(['t1', 't4']);
    expect(ids({ query: 'nothing like this' })).toEqual([]);
  });
  it('by construction (code or shown label), material (code or label) and section', () => {
    expect(ids({ query: 'أرضي' })).toEqual(['t2']);
    expect(ids({ query: 'نحاس' })).toEqual(['t2']);
    expect(ids({ query: 'alloy' })).toEqual(['t1', 't4']);
    expect(ids({ query: '95' })).toEqual(['t2']);
    expect(ids({ query: '54.6' })).toEqual(['t1', 't4']);
    expect(searchableText(TYPES[2], LABELS)).not.toContain('undefined');
  });
});

describe('filters', () => {
  it('6. by construction (several at once)', () => {
    expect(ids({ constructions: ['abc'] })).toEqual(['t1']);
    expect(ids({ constructions: ['bare', 'other'] })).toEqual(['t3', 't4']);
  });
  it('7. complete / draft (the model\'s completeness)', () => {
    expect(ids({ completeness: 'draft' })).toEqual(['t3']);
    expect(ids({ completeness: 'complete' })).toEqual(['t1', 't4', 't2']);
  });
  it('8. by verification: the weakest status among the entered values', () => {
    expect(TYPES.map((t) => typeVerification(t))).toEqual(['checked', 'approved', 'unverified', 'checked']);
    expect(ids({ verification: ['approved'] })).toEqual(['t2']);
    expect(ids({ verification: ['unverified', 'approved'] })).toEqual(['t3', 't2']);
  });
  it('9. search and filters together', () => {
    expect(ids({ query: 'cable', constructions: ['other'], completeness: 'complete', verification: ['checked'] })).toEqual(['t4']);
    expect(ids({ query: 'feeder', constructions: ['other'], verification: ['approved'] })).toEqual([]);
    expect(ids({})).toEqual(['t1', 't3', 't4', 't2']); // name order
  });
});

describe('values as stored', () => {
  it('11 / 12 / 13. R, X, Rn, Xn each on their own: a missing value is missing (not 0), a DC value stays DC, no temperature is inferred', () => {
    const t = rev('t', { r: v(0.443, 'dc', 'checked', { referenceTempC: 20 }), x: v(0, 'ac-50hz'), rn: v(0.6, 'unspecified', 'unverified', { source: { name: 'site' } }), xn: v(undefined, 'ac-50hz', 'unverified'), source: {} });
    const r = valueView(t, 'r'), x = valueView(t, 'x'), rn = valueView(t, 'rn'), xn = valueView(t, 'xn');
    expect(r).toMatchObject({ entered: true, value: 0.443, basis: 'dc', referenceTempC: 20, sourceFrom: 'none' });
    expect(x).toMatchObject({ entered: true, value: 0, basis: 'ac-50hz' });
    expect(rn).toMatchObject({ entered: true, value: 0.6, basis: 'unspecified', sourceFrom: 'value', source: { name: 'site' } });
    expect('referenceTempC' in rn).toBe(false);
    expect(xn.entered).toBe(false);
    expect('value' in xn).toBe(false);
    expect(valueView(rev('u'), 'r')).toMatchObject({ sourceFrom: 'type', source: { name: 'maker', reference: 'sheet 7' } });
    expect(valueView(rev('w', { r: v(0.5, 'dc', 'checked', { conversion: 'dc20-to-conductor-temp', referenceTempC: 20 }) }), 'r').conversionRequested).toBe(true);
  });
});

describe('revision comparison', () => {
  const h1 = createCableType('ct', data({ description: undefined, rn: v(undefined, 'ac') }), { now: 1 });
  const h2 = editCableType(h1, { description: 'now described', r: { value: 0.55, unit: 'ohm/km', basis: 'dc', referenceTempC: 20 }, rn: { value: 0.6, unit: 'ohm/km', basis: 'ac' }, xn: null, phase: { material: 'cu', sectionMm2: 70 } }, { now: 2 }).history;
  const h3 = setCableTypeVerification(h2, 'x', { status: 'approved', by: 'eng' }, { now: 3 }).history;
  const [r1, , r3] = h3.revisions;
  it('15. added / changed / removed / unchanged, for every field of the model (values and their verification apart)', () => {
    const rows = Object.fromEntries(compareRevisions(r1, r3).map((r) => [r.field, r.status]));
    expect(rows).toMatchObject({
      name: 'unchanged', description: 'added', construction: 'unchanged', 'phase.material': 'changed', 'phase.sectionMm2': 'unchanged',
      r: 'changed', 'r.verification': 'changed', rn: 'added', xn: 'removed', 'xn.verification': 'changed', x: 'unchanged', 'x.verification': 'changed', source: 'unchanged',
    });
    expect(Object.keys(rows)).toEqual(['name', 'description', 'construction', 'phaseConductors', 'neutralConductors', 'phase.material', 'phase.sectionMm2', 'neutral.material', 'neutral.sectionMm2',
      'r', 'r.verification', 'x', 'x.verification', 'rn', 'rn.verification', 'xn', 'xn.verification', 'source', 'maxCurrentA']);
    expect(rows.maxCurrentA).toBe('unchanged'); // neither revision states one
    const r = compareRevisions(r1, r3).find((x) => x.field === 'r')!;
    expect(r.before).toMatchObject({ value: 0.5, basis: 'ac' });
    expect(r.after).toMatchObject({ value: 0.55, basis: 'dc', referenceTempC: 20 });
    expect(compareRevisions(r3, r3).every((x) => x.status === 'unchanged')).toBe(true);
  });
  it('the history: newest first, each with what changed from the one before (nothing for the first)', () => {
    const list = revisionChanges(h3.revisions);
    expect(list.map((x) => x.revision.revision)).toEqual([3, 2, 1]);
    expect(list[0].changed).toEqual(['x.verification']);
    expect(list[2].changed).toEqual([]);
    expect(list[1].changed).toContain('rn');
  });
  it('16. reading never changes a record (inputs frozen)', () => {
    const frozen = deepFreeze(structuredClone(h3.revisions));
    expect(() => { revisionChanges(frozen); compareRevisions(frozen[0], frozen[2]); filterTypes(frozen, { ...NO_FILTER, query: 'abc' }, LABELS); valueView(frozen[1], 'r'); typeVerification(frozen[0]); }).not.toThrow();
    expect(frozen).toEqual(h3.revisions);
  });
});
