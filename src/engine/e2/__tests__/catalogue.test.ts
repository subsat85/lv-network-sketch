import { describe, expect, it } from 'vitest';
import { CABLE_ENTRIES, CATALOGUE_DOCUMENTS } from '../catalogue/entries';
import { resolveSpan } from '../catalogue/resolve';
import { validateCatalogue } from '../catalogue/schema';
import { COMPANY_RX_OHM_PER_KM, R20_OHM_PER_KM } from '../../../data/conductors';
import { DOC_ID, synCatalogue, synEntry } from './references';

// Catalogue schema and the order of the sources (design section 5, D9, D10).

const K = 'k#0';
const T = { conductorTempC: 70 };

describe('catalogue schema', () => {
  it('the app catalogue is empty (no value typed without a document)', () => {
    expect(CABLE_ENTRIES).toEqual([]);
    expect(CATALOGUE_DOCUMENTS).toEqual([]);
    expect(validateCatalogue({ documents: CATALOGUE_DOCUMENTS, entries: CABLE_ENTRIES })).toEqual([]);
  });
  it('a value without its document, page or unit is refused', () => {
    const e = synEntry();
    expect(validateCatalogue(synCatalogue(e))).toEqual([]);
    expect(validateCatalogue(synCatalogue({ ...e, x: { ...e.x!, source: { documentId: 'nope', page: '1' } } }))).toContainEqual({ entryId: e.id, field: 'x', problem: 'unknown-document' });
    expect(validateCatalogue(synCatalogue({ ...e, x: { ...e.x!, source: { documentId: DOC_ID, page: ' ' } } }))).toContainEqual({ entryId: e.id, field: 'x', problem: 'no-page' });
    expect(validateCatalogue(synCatalogue({ ...e, rAc: { ...e.rAc!, unit: 'mm2' } }))).toContainEqual({ entryId: e.id, field: 'rAc', problem: 'unit' });
    expect(validateCatalogue(synCatalogue({ ...e, rAc: { ...e.rAc!, value: 0 } }))).toContainEqual({ entryId: e.id, field: 'rAc', problem: 'value' });
    expect(validateCatalogue(synCatalogue({ ...e, construction: '3x95' }))).toContainEqual({ entryId: e.id, field: 'construction', problem: 'construction' });
  });
});

describe('order of the sources', () => {
  const e = synEntry();
  it('a value typed on the span comes first, and is provisional without a source', () => {
    const r = resolveSpan(K, { poles: ['a', 'b'], rOhmPerKm: 0.3, xOhmPerKm: 0.07 }, e, { entryId: e.id }, T, 'e2-input');
    expect(r.r).toMatchObject({ value: 0.3, warnings: ['source-unknown'], input: { provenance: 'project' } });
    expect(r.x).toMatchObject({ value: 0.07, input: { provenance: 'project' } });
  });
  it('then the catalogue AC value, then DC 20 °C (F8, with its warning)', () => {
    expect(resolveSpan(K, undefined, e, { entryId: e.id }, T, 'e2-input').r).toMatchObject({ value: 0.5, warnings: [], input: { provenance: 'catalogue' } });
    const dc = { ...e, rAc: undefined, rDc20: { ...e.rAc!, value: 0.443, conditions: 'DC 20 degC' } };
    const r = resolveSpan(K, undefined, dc, { entryId: e.id }, T, 'e2-input').r;
    expect(r.value).toBeCloseTo(0.443 * (1 + 0.00403 * 50), 12);
    expect(r.warnings).toEqual(['dc-resistance-used']);
    expect(resolveSpan(K, undefined, dc, { entryId: e.id }, {}, 'e2-input').r.reason).toBe('settings-missing');
  });
  it('IEC 60228 for the table kinds only; the company table is never used (D5)', () => {
    const props = { poles: ['a', 'b'] as [string, string], cableKind: 'abc' as const, material: 'cu' as const, crossSectionMm2: 120 };
    const r = resolveSpan(K, props, undefined, undefined, T, 'e2-input').r;
    expect(r.value).toBeCloseTo(R20_OHM_PER_KM.cu[120] * (1 + 0.00393 * 50), 12);
    expect(r.value).not.toBeCloseTo(COMPANY_RX_OHM_PER_KM.cu[120].r, 3);
    expect(r.input?.provenance).toBe('iec-table');
    expect(resolveSpan(K, { ...props, cableKind: 'bare' }, undefined, undefined, T, 'e2-input').r.reason).toBe('impedance-missing');
    // no X from any table, also not at pf = 1
    expect(resolveSpan(K, props, undefined, undefined, T, 'e2-input').x.reason).toBe('impedance-missing');
  });
  it('XN only from the catalogue: never X, never a span value', () => {
    const props = { poles: ['a', 'b'] as [string, string], xOhmPerKm: 0.08, rNeutralOhmPerKm: 0.5, dataSource: 's' };
    expect(resolveSpan(K, props, undefined, undefined, T, 'e2-input').xn.reason).toBe('neutral-impedance-missing');
    expect(resolveSpan(K, undefined, { ...e, xn: undefined }, { entryId: e.id }, T, 'e2-input').xn.reason).toBe('neutral-impedance-missing');
    expect(resolveSpan(K, undefined, e, { entryId: e.id }, T, 'e2-input').xn).toMatchObject({ value: 0.08, input: { provenance: 'catalogue' } });
    expect(resolveSpan(K, undefined, synEntry('n', false), { entryId: 'n' }, T, 'e2-input').xn.reason).toBe('neutral-conductor-missing');
  });
});

describe('np and nN (D10)', () => {
  const e = synEntry();
  const P = (o: object) => ({ poles: ['a', 'b'] as [string, string], ...o });
  it('np: written / legacy default / missing / invalid', () => {
    expect(resolveSpan(K, P({ parallel: 2 }), e, { entryId: e.id }, T, 'e2-input').np).toMatchObject({ value: 2, input: { provenance: 'project' } });
    const legacy = resolveSpan(K, P({}), e, { entryId: e.id }, T, 'legacy-project');
    expect(legacy.np).toMatchObject({ value: 1, warnings: ['phase-parallel-default'], input: { provenance: 'legacy-default' } });
    expect(legacy.issues).toEqual([{ code: 'setting-default:phase-parallel', severity: 'reported', target: { kind: 'span', id: K }, params: { value: 1 } }]);
    expect(resolveSpan(K, P({}), e, { entryId: e.id }, T, 'e2-input').np.reason).toBe('phase-parallel-unknown');
    expect(resolveSpan(K, P({ parallel: 1.5 }), e, { entryId: e.id }, T, 'legacy-project').np.reason).toBe('parallel-invalid');
  });
  it('nN: rules 1–5, never from np', () => {
    expect(resolveSpan(K, P({ parallel: 1 }), e, { entryId: e.id }, T, 'e2-input').nN).toMatchObject({ value: 1 });
    expect(resolveSpan(K, P({ parallel: 2 }), e, { entryId: e.id, completeSets: 2 }, T, 'e2-input').nN).toMatchObject({ value: 2 });
    expect(resolveSpan(K, P({ parallel: 2 }), e, { entryId: e.id, completeSets: 3 }, T, 'e2-input').nN.reason).toBe('parallel-conflict');
    expect(resolveSpan(K, P({}), e, { entryId: e.id }, T, 'legacy-project').nN.reason).toBe('neutral-parallel-unknown');
    expect(resolveSpan(K, P({ parallel: 2 }), e, { entryId: e.id }, T, 'e2-input').nN.reason).toBe('neutral-parallel-unknown');
    expect(resolveSpan(K, P({ parallel: 1 }), synEntry('n', false), { entryId: 'n' }, T, 'e2-input').nN.reason).toBe('neutral-conductor-missing');
    expect(resolveSpan(K, P({ parallel: 1 }), undefined, undefined, T, 'e2-input').nN.reason).toBe('neutral-impedance-missing');
  });
});
