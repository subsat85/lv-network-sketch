import { describe, expect, it } from 'vitest';
import type { SpanProps } from '../../../types/drawing';
import { CABLE_CONSTRUCTION_RULE, resolveSpan, type ResolvedSpan } from '../catalogue/resolve';
import type { CableEntry } from '../catalogue/schema';
import { runStudyE2 } from '../index';
import type { CircuitResult } from '../model';
import type { PhaseAllocation } from '../phases';
import type { Quantity } from '../quantity';
import { drawing, REF, synCatalogue, synEntry, TOL } from './references';

// ABC cables, final decision (Stage A): the neutral impedance is never taken from the phase.
// R, X, RN and XN are each resolved on their own, from explicit values only; a missing RN or XN is
// reported (neutral:resistance-missing / neutral:reactance-missing) and blocks only what needs the
// neutral. One ABC cable is one complete set (np = nN from the construction) — unchanged.
// ALL VALUES ARE SYNTHETIC test values (R = 0.5, X = 0.08 Ω/km and variations), not manufacturer data.
// Synthetic tests check the rules and the arithmetic of the model, not its physical accuracy.

const K = 'k#0';
const T = { conductorTempC: 70 };
const SRC = 'synthetic test value';
/** a manually entered ABC span: three phases + an alloy neutral, no neutral impedance typed */
const MANUAL: SpanProps = { poles: ['a', 'b'], cableKind: 'abc', system: '3ph4w', rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: SRC, neutralMaterial: 'alloy', neutralCrossSectionMm2: 54.6 };
const ms = (value: number) => ({ value, unit: 'ohm/km' as const, conditions: 'synthetic test value', source: { documentId: 'syn-doc', page: 'test' } });
/** a synthetic catalogue ABC entry with its neutral; its neutral values only when given */
const abcEntry = (o: Partial<CableEntry> = {}): CableEntry => {
  const { rnAc: _rn, xn: _xn, ...e } = synEntry('syn-abc');
  return { ...e, cableKind: 'abc', ...o };
};
const neutralIssues = (r: ResolvedSpan) => r.issues.filter((i) => i.code.startsWith('neutral:')).map((i) => i.code).sort();
const noPhaseCopy = (r: ResolvedSpan) => {
  expect(JSON.stringify(r)).not.toContain('company-engineering-default');
  for (const q of [r.rn, r.xn]) if (q.value !== undefined) expect(q.input!.provenance).not.toBe('company-engineering-default');
};

describe('the neutral is never taken from the phase', () => {
  it('1. a catalogue ABC cable without neutral values: RN and XN missing (never R, X), each reported', () => {
    const r = resolveSpan(K, undefined, abcEntry(), { entryId: 'syn-abc' }, T, 'e2-input');
    expect(r.r.value).toBe(0.5);
    expect(r.x.value).toBe(0.08);
    expect([r.rn.value, r.rn.reason, r.xn.value, r.xn.reason]).toEqual([undefined, 'neutral-impedance-missing', undefined, 'neutral-impedance-missing']);
    expect(r.issues).toEqual([
      { code: 'neutral:resistance-missing', severity: 'reported', target: { kind: 'span', id: K }, params: { property: 'RN' } },
      { code: 'neutral:reactance-missing', severity: 'reported', target: { kind: 'span', id: K }, params: { property: 'XN' } },
    ]);
    noPhaseCopy(r);
  });
  it('2. a manually entered ABC span without neutral values: RN and XN missing', () => {
    const r = resolveSpan(K, MANUAL, undefined, undefined, T, 'legacy-project');
    expect([r.rn.reason, r.xn.reason]).toEqual(['neutral-impedance-missing', 'neutral-impedance-missing']);
    expect(neutralIssues(r)).toEqual(['neutral:reactance-missing', 'neutral:resistance-missing']);
    noPhaseCopy(r);
  });
  it('3. only RN explicit: RN used, XN still missing (not X)', () => {
    const r = resolveSpan(K, { ...MANUAL, rNeutralOhmPerKm: 0.9 }, undefined, undefined, T, 'e2-input');
    expect(r.rn).toMatchObject({ value: 0.9, input: { provenance: 'project' } });
    expect(r.xn).toMatchObject({ reason: 'neutral-impedance-missing' });
    expect(neutralIssues(r)).toEqual(['neutral:reactance-missing']);
  });
  it('4. only XN explicit: XN used, RN still missing (not R)', () => {
    const r = resolveSpan(K, undefined, abcEntry({ xn: ms(0.2) }), { entryId: 'syn-abc' }, T, 'e2-input');
    expect(r.xn).toMatchObject({ value: 0.2, input: { provenance: 'catalogue' } });
    expect(r.rn).toMatchObject({ reason: 'neutral-impedance-missing' });
    expect(neutralIssues(r)).toEqual(['neutral:resistance-missing']);
  });
  it('5. RN and XN both explicit: both used, nothing reported', () => {
    const r = resolveSpan(K, undefined, abcEntry({ rnAc: ms(0.9), xn: ms(0.2) }), { entryId: 'syn-abc' }, T, 'e2-input');
    expect(r.rn).toMatchObject({ value: 0.9, input: { provenance: 'catalogue' } });
    expect(r.xn).toMatchObject({ value: 0.2, input: { provenance: 'catalogue' } });
    expect(r.issues).toEqual([]);
  });
  it('6. the four values are resolved on their own: the phase order is unchanged and gives the neutral nothing', () => {
    // a value typed on the span comes before the catalogue for the phase
    const typed = resolveSpan(K, { poles: ['a', 'b'], rOhmPerKm: 0.7, xOhmPerKm: 0.1, dataSource: SRC }, abcEntry(), { entryId: 'syn-abc' }, T, 'e2-input');
    expect([typed.r.value, typed.r.input!.provenance, typed.x.value]).toEqual([0.7, 'project', 0.1]);
    expect([typed.rn.reason, typed.xn.reason]).toEqual(['neutral-impedance-missing', 'neutral-impedance-missing']);
    // RN, documented order: span RN → catalogue rnAc → catalogue rnDc20 (al / cu, F8) → the span's al / cu neutral (IEC, F8)
    const dc = resolveSpan(K, undefined, abcEntry({ rnDc20: { ...ms(0.443), conditions: 'DC 20 degC (synthetic)' } }), { entryId: 'syn-abc' }, T, 'e2-input');
    expect(dc.rn.value).toBeCloseTo(0.443 * (1 + 0.00403 * 50), 12);
    expect(dc.rn).toMatchObject({ warnings: ['dc-resistance-used'], input: { provenance: 'catalogue' } });
    const iec = resolveSpan(K, { ...MANUAL, neutralMaterial: 'al', neutralCrossSectionMm2: 70 }, undefined, undefined, T, 'e2-input');
    expect(iec.rn).toMatchObject({ input: { provenance: 'iec-table' }, warnings: ['dc-resistance-used'] });
    expect(iec.rn.value).toBeCloseTo(0.443 * (1 + 0.00403 * 50), 12);
    expect(iec.xn.reason).toBe('neutral-impedance-missing');
    // an al neutral size not in the table, or no operating temperature: no value, nothing in its place
    expect(resolveSpan(K, { ...MANUAL, neutralMaterial: 'al', neutralCrossSectionMm2: 54.6 }, undefined, undefined, T, 'e2-input').rn.reason).toBe('neutral-impedance-missing');
    expect(resolveSpan(K, { ...MANUAL, neutralMaterial: 'al', neutralCrossSectionMm2: 70 }, undefined, undefined, {}, 'e2-input').rn.reason).toBe('settings-missing');
    // a missing phase value does not touch the neutral, and the other way round
    const noX = resolveSpan(K, { ...MANUAL, xOhmPerKm: undefined, rNeutralOhmPerKm: 0.9 }, abcEntry({ xn: ms(0.2) }), { entryId: 'syn-abc' }, T, 'e2-input');
    expect(noX.x.value).toBe(0.08); // the catalogue x after the span's missing X
    expect([noX.rn.value, noX.xn.value]).toEqual([0.9, 0.2]);
  });
});

describe('complete ABC sets: np and nN from the construction (unchanged)', () => {
  it('7–8. one ABC cable without a parallel input: np = nN = 1, cable-construction, no parallel warning or issue', () => {
    for (const origin of ['legacy-project', 'e2-input'] as const) {
      for (const [props, entry] of [[MANUAL, undefined], [undefined, abcEntry({ rnAc: ms(0.5), xn: ms(0.08) })]] as const) {
        const r = resolveSpan(K, props, entry, entry ? { entryId: entry.id } : undefined, T, origin);
        expect(r.np, origin).toMatchObject({ value: 1, warnings: [], input: { provenance: 'cable-construction', ref: CABLE_CONSTRUCTION_RULE } });
        expect(r.nN, origin).toMatchObject({ value: 1, warnings: [], input: { provenance: 'cable-construction' } });
        // only the missing neutral values may be reported — no parallel default, no parallel issue
        expect(r.issues.every((i) => i.code.startsWith('neutral:')), origin).toBe(true);
        expect(r.np.warnings).not.toContain('phase-parallel-default');
      }
    }
  });
  it('9. two explicitly given complete ABC sets: np = nN = 2', () => {
    const r = resolveSpan(K, { ...MANUAL, parallel: 2 }, undefined, undefined, T, 'e2-input');
    expect(r.np).toMatchObject({ value: 2, input: { provenance: 'project' } });
    expect(r.nN).toMatchObject({ value: 2, input: { provenance: 'cable-construction' } });
    expect(resolveSpan(K, { ...MANUAL, parallel: 2 }, abcEntry(), { entryId: 'syn-abc', completeSets: 3 }, T, 'e2-input').nN.reason).toBe('parallel-conflict');
  });
  it('13. an invalid parallel stays invalid (never 1, never a default)', () => {
    for (const parallel of [1.5, 0, -2]) {
      const r = resolveSpan(K, { ...MANUAL, parallel }, undefined, undefined, T, 'legacy-project');
      expect(r.np.reason, String(parallel)).toBe('parallel-invalid');
      expect(r.nN.reason).toBe('parallel-invalid');
      expect(r.issues).toContainEqual({ code: 'parallel-invalid', severity: 'blocks', target: { kind: 'span', id: K }, params: { value: String(parallel) } });
    }
  });
});

describe('other cables and explicit neutrals', () => {
  it('10. no documented neutral, another cable kind, or 1ph2w: no construction rule; the neutral is never the phase', () => {
    const cases: [string, SpanProps | undefined, CableEntry | undefined][] = [
      ['ABC without neutral evidence', { poles: ['a', 'b'], cableKind: 'abc', system: '3ph4w', rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: SRC }, undefined],
      ['underground cable', { ...MANUAL, cableKind: 'underground' }, undefined],
      ['ABC on 1ph2w', { ...MANUAL, system: '1ph2w' }, undefined],
      ['catalogue underground entry', undefined, { ...abcEntry(), cableKind: 'underground' }],
    ];
    for (const [name, props, entry] of cases) {
      const r = resolveSpan(K, props, entry, entry ? { entryId: entry.id } : undefined, T, 'legacy-project');
      expect(r.np.input?.provenance, name).not.toBe('cable-construction');
      expect(r.nN.input?.provenance, name).not.toBe('cable-construction');
      expect(r.xn.value, name).toBeUndefined();
      noPhaseCopy(r);
    }
    // a catalogue entry without its neutral: no neutral at all (not "missing values")
    const { neutral: _n, ...noNeutral } = abcEntry();
    const r = resolveSpan(K, undefined, noNeutral as CableEntry, { entryId: 'syn-abc' }, T, 'e2-input');
    expect([r.rn.reason, r.xn.reason]).toEqual(['neutral-conductor-missing', 'neutral-conductor-missing']);
    expect(neutralIssues(r)).toEqual([]);
  });
  it('11. a cable with its own, different neutral keeps it', () => {
    const own = resolveSpan(K, undefined, abcEntry({ neutral: { material: 'al', sectionMm2: 70 }, rnAc: ms(1.2), xn: ms(0.1) }), { entryId: 'syn-abc' }, T, 'e2-input');
    expect([own.rn.value, own.rn.input!.provenance, own.xn.value, own.xn.input!.provenance]).toEqual([1.2, 'catalogue', 0.1, 'catalogue']);
    const typed = resolveSpan(K, { ...MANUAL, rNeutralOhmPerKm: 1.2 }, undefined, undefined, T, 'e2-input');
    expect([typed.rn.value, typed.rn.input!.provenance]).toEqual([1.2, 'project']);
  });
  it('12. alloy: no documented conversion — its DC value is not used and nothing replaces it', () => {
    const manual = resolveSpan(K, MANUAL, undefined, undefined, T, 'e2-input');
    expect(manual.rn.reason).toBe('neutral-impedance-missing');
    const printed = resolveSpan(K, undefined, abcEntry({ neutral: { material: 'alloy', sectionMm2: 54.6 }, construction: '3x70 + 54.6', rnDc20: ms(0.63), xn: ms(0.09) }), { entryId: 'syn-abc' }, T, 'e2-input');
    expect(printed.rn).toMatchObject({ reason: 'neutral-impedance-missing' });
    expect(printed.rn.value).toBeUndefined();
    expect(printed.xn).toMatchObject({ value: 0.09, input: { provenance: 'catalogue' } });
    expect(neutralIssues(printed)).toEqual(['neutral:resistance-missing']);
    // an explicit RN for the alloy neutral is used
    expect(resolveSpan(K, { ...MANUAL, rNeutralOhmPerKm: 0.63 }, undefined, undefined, T, 'e2-input').rn.value).toBe(0.63);
  });
});

// ---------- the numbers: phase drop, neutral shift, active loss, reactive power ----------

const ON_A = (n: number): PhaseAllocation => ({ consumers: { u0: { a: n, source: 'design', verification: { status: 'checked' } } }, singlePhaseSpans: {} });
const A = (c: CircuitResult) => c.nodes.find((n) => n.poleId === 'A')!;
const v = (q: Quantity<number>) => { expect(q.value, JSON.stringify(q)).toBeDefined(); return q.value!; };
const near = (q: Quantity<number>, x: number, tol: number) => expect(Math.abs(v(q) - x), `${q.value} vs ${x}`).toBeLessThan(tol);
const study = (props: Omit<SpanProps, 'poles'>, count: number, o: { entry?: CableEntry; square?: boolean } = {}) => {
  const { doc } = drawing({ Lm: 100, props, consumers: [o.square ? { variant: 'square', label: '30' } : { variant: 'circle', count }] });
  const r = runStudyE2(doc, { inputOrigin: 'legacy-project', ...(o.square ? {} : { allocation: ON_A(count) }), ...(o.entry ? { catalogue: synCatalogue(o.entry), catalogueSelection: { k1: { entryId: o.entry.id } } } : { catalogueSelection: {} }) });
  return { r, c: r.circuits.find((x) => x.spans.length)! };
};
const { poles: _p, ...MANUAL_PROPS } = MANUAL;
const ABC_SPAN = { system: '3ph4w' as const, cableKind: 'abc' as const };

describe('effects on the results (synthetic)', () => {
  it('an unbalanced ABC circuit without XN: no drop, no neutral shift, no losses — only the load currents; the missing value is named', () => {
    const { r, c } = study({ ...MANUAL_PROPS, rNeutralOhmPerKm: 0.5 }, 5);
    expect(r.issues).toContainEqual({ code: 'neutral:reactance-missing', severity: 'reported', target: { kind: 'span', id: 'k1#0' }, params: { property: 'XN' } });
    expect(r.issues.some((i) => i.code === 'neutral:resistance-missing')).toBe(false);
    for (const q of [A(c).dropV.a, A(c).voltage.a, A(c).lineV.ab, c.spans[0].pLossW, c.spans[0].qAbsorbedVar])
      expect(q).toMatchObject({ status: 'unavailable', reason: 'neutral-impedance-missing' });
    expect(A(c).neutralShiftV.value).toBeUndefined();
    expect(c.loads[0].currentA.a.value).toBe(20);
    expect(JSON.stringify(c)).not.toContain('company-engineering-default');
  });
  it('a balanced ABC circuit needs no neutral: computed without RN, XN or a parallel input (the missing values are only reported)', () => {
    const { r, c } = study(MANUAL_PROPS, 1, { square: true });
    expect(A(c).dropV.a.status).toBe('computed');
    expect(c.spans[0].current.n.value!.magnitude).toBe(0);
    expect(r.issues.filter((i) => i.code.startsWith('neutral:')).every((i) => i.severity === 'reported')).toBe(true);
    expect(c.completeness.status).toBe('computed');
  });
  it('explicit RN = R and XN = X (synthetic catalogue values): the N1 reference — drop, neutral shift, P, Q', () => {
    const { c } = study(ABC_SPAN, 5, { entry: abcEntry({ rnAc: ms(0.5), xn: ms(0.08) }) });
    for (const p of ['a', 'b', 'c'] as const) near(A(c).dropV[p], REF.N1.dV[p], TOL.V);
    expect(Math.abs(A(c).neutralShiftV.value!.magnitude - REF.N1.shift)).toBeLessThan(TOL.V);
    near(c.spans[0].pLossW, REF.N1.P, TOL.W);
    near(c.spans[0].qAbsorbedVar, REF.N1.Q, TOL.W);
    expect(c.spans[0].pLossW.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'RN', provenance: 'catalogue', value: 0.5 }),
      expect.objectContaining({ name: 'XN', provenance: 'catalogue', value: 0.08 }),
      expect.objectContaining({ name: 'nN', provenance: 'cable-construction', value: 1 }),
    ]));
  });
  it('a different explicit RN (1.0) changes the drop, the neutral shift and the active loss — not the reactive power', () => {
    const base = study(ABC_SPAN, 5, { entry: abcEntry({ rnAc: ms(0.5), xn: ms(0.08) }) }).c;
    const own = study(ABC_SPAN, 5, { entry: abcEntry({ rnAc: ms(1.0), xn: ms(0.08) }) }).c;
    // |IN| = |Ia| = 20 A: P = 20²·(0.05 + 0.1) = 60 W; Q = 20²·(0.008 + 0.008) = 6.4 var
    near(own.spans[0].pLossW, 60, TOL.W);
    near(own.spans[0].qAbsorbedVar, REF.N1.Q, TOL.W);
    expect(v(A(own).dropV.a)).toBeGreaterThan(v(A(base).dropV.a) + 0.1);
    expect(A(own).neutralShiftV.value!.magnitude).toBeGreaterThan(A(base).neutralShiftV.value!.magnitude + 0.1);
  });
  it('a different explicit XN (0.16) changes the reactive power — not the active loss', () => {
    const { c } = study(ABC_SPAN, 5, { entry: abcEntry({ rnAc: ms(0.5), xn: ms(0.16) }) });
    // Q = 20²·(0.008 + 0.016) = 9.6 var; P = 20²·(0.05 + 0.05) = 40 W
    near(c.spans[0].qAbsorbedVar, 9.6, TOL.W);
    near(c.spans[0].pLossW, REF.N1.P, TOL.W);
  });
  it('two complete ABC sets (parallel = 2), 40 A on a: the same drop as one set with 20 A; twice the losses', () => {
    const { c } = study({ ...ABC_SPAN, parallel: 2 }, 10, { entry: abcEntry({ rnAc: ms(0.5), xn: ms(0.08) }) });
    for (const p of ['a', 'b', 'c'] as const) near(A(c).dropV[p], REF.N1.dV[p], TOL.V);
    near(c.spans[0].perSetCurrentA.n, 20, TOL.A);
    near(c.spans[0].pLossW, 2 * REF.N1.P, TOL.W);
    near(c.spans[0].qAbsorbedVar, 2 * REF.N1.Q, TOL.W);
  });
});
