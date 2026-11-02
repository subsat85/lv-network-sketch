import { describe, expect, it } from 'vitest';
import type { CableTypeData } from '../../types/cableType';
import { createCableType, editCableType, latestRevision } from '../cableTypeModel';
import { cableFormFrom, emptyCableForm, formCompleteness, parseNumber, planEdit, readCableForm, type CableForm } from '../cableTypeForm';

// Stage C3: the cable type form (pure). ALL VALUES ARE SYNTHETIC.

/** a filled form: ABC 3×70 + 54.6, the four values entered, the cable data source stated */
const filled = (o: Partial<CableForm> = {}): CableForm => {
  const f = emptyCableForm();
  return {
    ...f, name: 'ABC 3x70 (synthetic)', construction: 'abc', phaseConductors: '3', neutralConductors: '1',
    phaseMaterial: 'al', phaseSection: '70', neutralMaterial: 'alloy', neutralSection: '54,6', sourceName: 'maker', sourcePage: '12',
    r: { ...f.r, value: '0.443', basis: 'dc', referenceTempC: '20' }, x: { ...f.x, value: '0.08' },
    rn: { ...f.rn, value: '0.6' }, xn: { ...f.xn, value: '0.09' }, ...o,
  };
};
const fields = (f: CableForm) => readCableForm(f).errors.map((e) => `${e.field}:${e.code}`);

describe('a new form', () => {
  it('has no default value in any field (verification starts unverified, resistances «not stated»)', () => {
    const f = emptyCableForm();
    for (const k of ['name', 'description', 'construction', 'phaseConductors', 'neutralConductors', 'phaseMaterial', 'phaseSection', 'neutralMaterial', 'neutralSection', 'sourceName', 'sourceReference', 'sourcePage', 'sourceTable', 'note'] as const) expect(f[k], k).toBe('');
    for (const p of ['r', 'x', 'rn', 'xn'] as const) expect([f[p].value, f[p].referenceTempC, f[p].status, f[p].ownSource], p).toEqual(['', '', 'unverified', false]);
    expect([f.r.basis, f.rn.basis, f.x.basis, f.xn.basis]).toEqual(['unspecified', 'unspecified', 'ac-50hz', 'ac-50hz']);
  });
  it('parses numbers as typed: empty → undefined, comma decimals, nothing else', () => {
    expect([parseNumber(''), parseNumber('  '), parseNumber('0'), parseNumber('0,5'), parseNumber('.5'), parseNumber('12.')]).toEqual([undefined, undefined, 0, 0.5, 0.5, 12]);
    for (const s of ['abc', '1e3', '0.5 ohm', '--1', '1,2,3']) expect(Number.isNaN(parseNumber(s)), s).toBe(true);
  });
});

describe('reading the form', () => {
  it('a complete cable: every value as typed, DC kept DC, the reference temperature only as typed', () => {
    const { errors, data } = readCableForm(filled());
    expect(errors).toEqual([]);
    expect(data).toMatchObject({ name: 'ABC 3x70 (synthetic)', construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 } });
    expect(data!.r).toEqual({ value: 0.443, unit: 'ohm/km', basis: 'dc', referenceTempC: 20, verification: { status: 'unverified' } });
    expect(data!.rn).toEqual({ value: 0.6, unit: 'ohm/km', basis: 'unspecified', verification: { status: 'unverified' } });
    expect('referenceTempC' in data!.rn).toBe(false);
    expect(formCompleteness(data!)).toEqual({ complete: true, missing: [] });
  });
  it('a draft: empty values stay undefined (never 0), the record is saved as a draft', () => {
    const f = filled();
    const { errors, data } = readCableForm({ ...f, r: { ...f.r, value: '' }, x: { ...f.x, value: '' }, rn: { ...f.rn, value: ' ' }, sourceName: '', sourcePage: '' });
    expect(errors).toEqual([]);
    expect(['value' in data!.r, 'value' in data!.x, 'value' in data!.rn]).toEqual([false, false, false]);
    expect(formCompleteness(data!)).toEqual({ complete: false, missing: ['r', 'x', 'rn', 'source'] });
  });
  it('X = 0 entered explicitly is a value; R, Rn, Xn = 0 are refused', () => {
    const f = filled();
    expect(readCableForm({ ...f, x: { ...f.x, value: '0' } }).data!.x.value).toBe(0);
    expect(fields({ ...f, r: { ...f.r, value: '0' }, rn: { ...f.rn, value: '0' }, xn: { ...f.xn, value: '0' } })).toEqual(['r.value:positive', 'rn.value:positive', 'xn.value:positive']);
    expect(fields({ ...f, x: { ...f.x, value: '-0.1' } })).toEqual(['x.value:nonNegative']);
  });
  it('no neutral: no neutral spec, Rn and Xn not needed for completeness', () => {
    const f = filled({ neutralConductors: '0', neutralMaterial: 'alloy', neutralSection: '54.6' });
    const { data } = readCableForm({ ...f, rn: { ...f.rn, value: '' }, xn: { ...f.xn, value: '' } });
    expect(data!.neutral).toBeUndefined();
    expect(formCompleteness(data!)).toEqual({ complete: true, missing: [] });
  });
  it('the required fields and the number rules are named', () => {
    expect(fields({ ...emptyCableForm() })).toEqual(['name:required', 'construction:required', 'phaseConductors:required', 'neutralConductors:required']);
    expect(fields(filled({ phaseConductors: '2.5', neutralConductors: '-1', phaseSection: 'x', neutralSection: '0' }))).toEqual(['phaseConductors:integer', 'neutralConductors:nonNegative', 'phaseSection:number']);
    expect(fields(filled({ phaseConductors: '0' }))).toEqual(['phaseConductors:positive']);
    const f = filled();
    expect(fields({ ...f, r: { ...f.r, referenceTempC: '400' } })).toEqual(['r.referenceTempC:range']);
  });
  it('checked / approved need an entered value and a source (no undocumented «manufacturer» value)', () => {
    const f = filled({ sourceName: '', sourcePage: '' });
    expect(fields({ ...f, r: { ...f.r, status: 'approved' } })).toEqual(['r.status:verifiedNeedsSource']);
    expect(fields({ ...f, r: { ...f.r, status: 'checked', ownSource: true, sourceName: 'lab report' } })).toEqual([]);
    expect(fields({ ...f, x: { ...f.x, value: '', status: 'checked', ownSource: true, sourceName: 'maker' } })).toEqual(['x.status:verifiedNeedsValue']);
    expect(fields(filled({ r: { ...filled().r, status: 'approved', verifiedBy: 'eng' } }))).toEqual([]);
    expect(readCableForm(filled({ r: { ...filled().r, status: 'approved', verifiedBy: ' eng ', verifiedOn: '2026-11-01' } })).data!.r.verification).toEqual({ status: 'approved', by: 'eng', on: '2026-11-01' });
  });
});

describe('editing: the form of a revision, and what a save does', () => {
  const h1 = createCableType('ct', readCableForm(filled({ description: 'old text' })).data!, { now: 1 });
  const r1 = latestRevision(h1);
  it('the form of a revision reads back to exactly the same data: nothing to save', () => {
    const { data } = readCableForm(cableFormFrom(r1));
    const { id: _i, revision: _r, typeCreatedAt: _a, revisionCreatedAt: _b, ...stored } = r1;
    expect(data).toEqual(stored);
    expect(planEdit(r1, data!)).toEqual({ reset: [], verify: [], revisions: 0 });
  });
  it('a changed value: one revision, its verification reset by the library; unchanged values keep theirs', () => {
    const f = cableFormFrom(r1);
    const plan = planEdit(r1, readCableForm({ ...f, r: { ...f.r, value: '0.5', basis: 'ac', referenceTempC: '' }, description: '' }).data!);
    expect(plan.reset).toEqual(['r']);
    expect(plan.verify).toEqual([]);
    expect(plan.revisions).toBe(1);
    expect(plan.edit).toMatchObject({ r: { value: 0.5, basis: 'ac' }, description: null });
    expect('verification' in (plan.edit!.r as object)).toBe(false);
    const after = latestRevision(editCableType(h1, plan.edit!, { now: 2 }).history);
    expect(after).toMatchObject({ revision: 2, r: { value: 0.5, basis: 'ac', verification: { status: 'unverified' } } });
    expect(after.description).toBeUndefined();
    expect(after.x).toEqual(r1.x);
  });
  it('a verification chosen by the person is its own revision (never set automatically)', () => {
    const f = cableFormFrom(r1);
    const plan = planEdit(r1, readCableForm({ ...f, x: { ...f.x, status: 'checked', verifiedBy: 'eng' } }).data!);
    expect(plan.edit).toBeUndefined();
    expect(plan.verify).toEqual([{ property: 'x', verification: { status: 'checked', by: 'eng' } }]);
    expect(plan.revisions).toBe(1);
    // a value changed and approved in the same save: the data revision, then the verification
    const both = planEdit(r1, readCableForm({ ...f, xn: { ...f.xn, value: '0.1', status: 'approved' } }).data!);
    expect([both.reset, both.verify.map((v) => v.property), both.revisions]).toEqual([['xn'], ['xn'], 2]);
  });
  it('a stored conversion request and the verification note are kept as they are', () => {
    const conv: CableTypeData = { ...readCableForm(filled()).data!, r: { value: 0.443, unit: 'ohm/km', basis: 'dc', referenceTempC: 20, conversion: 'dc20-to-conductor-temp', verification: { status: 'checked', note: 'from lab' } } as never };
    const r = latestRevision(createCableType('c', conv, { now: 1 }));
    const back = readCableForm(cableFormFrom(r)).data!;
    expect(back.r).toEqual(r.r);
    expect(planEdit(r, back).revisions).toBe(0);
  });
});
