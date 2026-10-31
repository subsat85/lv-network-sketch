import { describe, expect, it } from 'vitest';
import type { CableElement, DrawingElement, ElectricalSettings } from '../../../types/drawing';
import { goldenCases, goldenTreeCases } from '../../../utils/__tests__/vdGoldenNetworks';
import { computeVoltageDrop } from '../../../utils/voltageDrop';
import { runStudyE2, type E2Options } from '../index';
import type { CircuitResult } from '../model';
import type { PhaseAllocation } from '../phases';
import type { Quantity } from '../quantity';
import type { ProjectDocument } from '../../model';
import { drawing, REF, synCatalogue, synEntry, TOL } from './references';

// E2 through runStudyE2 (drawing → result): N6, N7, C1–C6, purity.

type D = Parameters<typeof drawing>[0];
const run = (d: D, o: Partial<E2Options> & Pick<E2Options, 'inputOrigin'>) => {
  const { doc } = drawing(d);
  const r = runStudyE2(doc, { catalogue: synCatalogue(synEntry(), synEntry('syn-3x70', false)), catalogueSelection: { k1: { entryId: 'syn-4x70' } }, ...o });
  return { r, c: r.circuits.find((x) => x.spans.length > 0)!, doc };
};
const A = (c: CircuitResult) => c.nodes.find((n) => n.poleId === 'A')!;
const num = (q: Quantity<number>) => { expect(q.value, JSON.stringify(q)).toBeDefined(); return q.value!; };
const near = (q: Quantity<number>, x: number, tol: number) => expect(Math.abs(num(q) - x), `${q.value} vs ${x}`).toBeLessThan(tol);
const SQ = (label: string) => ({ variant: 'square' as const, label });
const CIRCLES = (count: number) => ({ variant: 'circle' as const, count });
// P5-4: these tests use a verified allocation (stated explicitly; a missing verification counts as unverified)
const ON_A = (count: number): PhaseAllocation => ({ consumers: { u0: { a: count, source: 'design', verification: { status: 'checked' } } }, singlePhaseSpans: {} });
const BASE = { system: '3ph4w' as const, cableKind: 'underground' as const };

describe('C1–C6 np compatibility', () => {
  it('C1 legacy project, parallel empty: np = 1 legacy-default, provisional, with its DataIssue', () => {
    const { r, c } = run({ Lm: 200, props: BASE, consumers: [SQ('30')] }, { inputOrigin: 'legacy-project' });
    expect(r.issues).toContainEqual({ code: 'setting-default:phase-parallel', severity: 'reported', target: { kind: 'span', id: 'k1#0' }, params: { value: 1 } });
    const s = c.spans[0], a = A(c);
    near(a.dropV.a, REF.C1.dV, TOL.V);
    expect(a.dropV.a.status).toBe('provisional');
    expect(a.dropV.a.warnings).toEqual(['phase-parallel-default']);
    expect(s.pLossW.status).toBe('provisional');
    near(s.pLossW, REF.C1.P, TOL.W);
    near(s.qAbsorbedVar, REF.C1.Q, TOL.W);
    near(s.perSetCurrentA.a, REF.C1.perSet, TOL.A);
    expect(Math.abs(s.current.a.value!.magnitude - REF.C1.I)).toBeLessThan(TOL.A);
    expect(s.pLossW.inputs).toContainEqual(expect.objectContaining({ name: 'np', provenance: 'legacy-default', value: 1 }));
    expect(c.solve.status).toBe('provisional');
  });
  it('C2 new E2 input, parallel empty: np missing, no default, |Irule| only', () => {
    const { r, c } = run({ Lm: 200, props: BASE, consumers: [SQ('30')] }, { inputOrigin: 'e2-input' });
    expect(r.issues.some((i) => i.code === 'setting-default:phase-parallel')).toBe(false);
    expect(A(c).dropV.a.status).toBe('unavailable');
    expect(A(c).dropV.a.reason).toBe('phase-parallel-unknown');
    expect(c.spans[0].pLossW.value).toBeUndefined();
    expect(c.spans[0].qAbsorbedVar.value).toBeUndefined();
    expect(c.loads[0].currentA.a.value).toBe(30);
    expect(c.spans[0].arithmeticSumA.a.value).toBe(30);
  });
  it('C3 legacy project, parallel = 2: documented, computed, 15 A per set', () => {
    const { r, c } = run({ Lm: 200, props: { ...BASE, parallel: 2 }, consumers: [SQ('30')] }, { inputOrigin: 'legacy-project' });
    expect(r.issues.some((i) => i.code === 'setting-default:phase-parallel')).toBe(false);
    const s = c.spans[0], a = A(c);
    expect(a.dropV.a.status).toBe('computed');
    near(a.dropV.a, REF.C3.dV, TOL.V);
    near(s.pLossW, REF.C3.P, TOL.W);
    near(s.qAbsorbedVar, REF.C3.Q, TOL.W);
    near(s.perSetCurrentA.a, REF.C3.perSet, TOL.A);
    expect(Math.abs(s.current.a.value!.magnitude - REF.C3.I)).toBeLessThan(TOL.A);
    expect(s.pLossW.inputs).toContainEqual(expect.objectContaining({ name: 'np', provenance: 'project', value: 2 }));
  });
  it('C4 missing neutral information is not taken from np = 1', () => {
    // (a) no neutral data at all (R and X typed on the span, with a source)
    const a = run({ Lm: 100, props: { ...BASE, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 'synthetic test value' }, consumers: [CIRCLES(5)] }, { inputOrigin: 'legacy-project', catalogueSelection: {}, allocation: ON_A(5) });
    expect(A(a.c).dropV.a.reason).toBe('neutral-impedance-missing');
    // (b) neutral documented (catalogue), parallel empty: nN missing although np = 1 by default
    const b = run({ Lm: 100, props: BASE, consumers: [CIRCLES(5)] }, { inputOrigin: 'legacy-project', allocation: ON_A(5) });
    expect(A(b.c).dropV.a.reason).toBe('neutral-parallel-unknown');
    expect(b.c.spans[0].pLossW.value).toBeUndefined();
    // (c) parallel = 1 written, documented neutral: nN = 1, 200 m as in the design (provisional only for the 4 A rule)
    const c = run({ Lm: 200, props: { ...BASE, parallel: 1 }, consumers: [CIRCLES(5)] }, { inputOrigin: 'legacy-project', allocation: ON_A(5) });
    for (const p of ['a', 'b', 'c'] as const) {
      near(A(c.c).dropV[p], REF.C4c.dV[p], TOL.V);
      expect(A(c.c).dropV[p].status).toBe('provisional');
      expect(A(c.c).dropV[p].warnings).toEqual(['load-default']);
    }
    expect(Math.abs(c.c.spans[0].current.n.value!.magnitude - REF.C4c.IN)).toBeLessThan(TOL.A);
    near(c.c.spans[0].pLossW, REF.C4c.P, TOL.W);
    near(c.c.spans[0].qAbsorbedVar, REF.C4c.Q, TOL.W);
    expect(c.c.spans[0].pLossW.status).toBe('provisional');
    expect(c.c.loads[0].currentA.a.inputs).toContainEqual(expect.objectContaining({ name: 'I', provenance: 'default', value: 4 }));
  });
  it('C5 the default changes nothing in the project (deep-frozen; no parallel written)', () => {
    const { doc } = drawing({ Lm: 200, props: BASE, consumers: [SQ('30')] });
    const before = JSON.stringify(doc);
    const frozen = deepFreeze(structuredClone(doc));
    const opts: E2Options = { inputOrigin: 'legacy-project', catalogue: synCatalogue(), catalogueSelection: { k1: { entryId: 'syn-4x70' } } };
    const r1 = runStudyE2(frozen, opts), r2 = runStudyE2(frozen, opts);
    expect(JSON.stringify(frozen)).toBe(before);
    const cable = frozen.elements.find((e): e is CableElement => e.type === 'cable')!;
    expect(Object.values(cable.spanProps!).every((p) => p.parallel === undefined && !('parallel' in p))).toBe(true);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
  it('C6 the effect of np alone: same network, np = 1 then np = 2 with completeSets = 2', () => {
    const one = run({ Lm: 200, props: { ...BASE, parallel: 1 }, consumers: [SQ('30')] }, { inputOrigin: 'e2-input' }).c;
    const two = run({ Lm: 200, props: { ...BASE, parallel: 2 }, consumers: [SQ('30')] }, { inputOrigin: 'e2-input', catalogueSelection: { k1: { entryId: 'syn-4x70', completeSets: 2 } } }).c;
    for (const x of [one, two]) { expect(A(x).dropV.a.status).toBe('computed'); expect(Math.abs(x.spans[0].current.a.value!.magnitude - 30)).toBeLessThan(TOL.A); }
    near(one.spans[0].perSetCurrentA.a, 30, TOL.A);
    near(two.spans[0].perSetCurrentA.a, 15, TOL.A);
    expect(Math.abs(num(two.spans[0].pLossW) / num(one.spans[0].pLossW) - 0.5)).toBeLessThan(1e-9);
    expect(Math.abs(num(two.spans[0].qAbsorbedVar) / num(one.spans[0].qAbsorbedVar) - 0.5)).toBeLessThan(1e-9);
    near(A(one).dropV.a, REF.C1.dV, TOL.V);
    near(A(two).dropV.a, REF.C3.dV, TOL.V);
    // the drop is not halved exactly (difference of magnitudes): 0.49986
    expect(Math.abs(num(A(two).dropV.a) / num(A(one).dropV.a) - 0.49986)).toBeLessThan(1e-4);
  });
});

describe('N6 nN not known (constant current)', () => {
  it('(a) parallel = 2 without completeSets, balanced 60 A: computed (no neutral current)', () => {
    const { c } = run({ Lm: 200, props: { ...BASE, parallel: 2 }, consumers: [SQ('60')] }, { inputOrigin: 'legacy-project' });
    expect(A(c).dropV.a.status).toBe('computed');
    near(A(c).dropV.a, REF.N5.dV, TOL.V);
  });
  it('(b) the same with 40 A constant-current on a: only |Irule| and the bounds', () => {
    const { c } = run({ Lm: 100, props: { ...BASE, parallel: 2 }, consumers: [CIRCLES(10)] }, { inputOrigin: 'legacy-project', allocation: ON_A(10) });
    const s = c.spans[0];
    expect(A(c).dropV.a.reason).toBe('neutral-parallel-unknown');
    expect(s.current.a.reason).toBe('node-voltage-unknown');
    expect(s.current.n.reason).toBe('node-voltage-unknown');
    expect(s.current.a.value).toBeUndefined();
    expect(s.arithmeticSumA.a.value).toBe(40);
    expect(s.arithmeticSumA.n.value).toBe(40);
    expect(s.arithmeticSumA.a.method).toBe('bound');
    expect(c.loads[0].currentA.a.value).toBe(40);
    expect(s.pLossW.value).toBeUndefined();
    expect(s.qAbsorbedVar.value).toBeUndefined();
  });
  it('(c) new input, parallel empty: phase-parallel-unknown first', () => {
    const { c } = run({ Lm: 100, props: BASE, consumers: [CIRCLES(10)] }, { inputOrigin: 'e2-input', allocation: ON_A(10) });
    expect(A(c).dropV.a.reason).toBe('phase-parallel-unknown');
    expect(A(c).dropV.a.blockedBy).toContain('k1#0');
  });
  it('(d) a catalogue cable without a neutral conductor', () => {
    const { c } = run({ Lm: 100, props: { ...BASE, parallel: 1 }, consumers: [CIRCLES(10)] }, { inputOrigin: 'legacy-project', allocation: ON_A(10), catalogueSelection: { k1: { entryId: 'syn-3x70' } } });
    expect(A(c).dropV.a.reason).toBe('neutral-conductor-missing');
  });
  it('(e) completeSets = 3 with parallel = 2', () => {
    const { c } = run({ Lm: 100, props: { ...BASE, parallel: 2 }, consumers: [CIRCLES(10)] }, { inputOrigin: 'legacy-project', allocation: ON_A(10), catalogueSelection: { k1: { entryId: 'syn-4x70', completeSets: 3 } } });
    expect(A(c).dropV.a.reason).toBe('parallel-conflict');
  });
});

describe('N7 nN not known (constant power)', () => {
  const CP = { loadModel: 'constant-power' as const };
  it('(a) reference: 9200 VA on a, two complete sets', () => {
    const { c } = run({ Lm: 100, props: { ...BASE, parallel: 2 }, consumers: [CIRCLES(10)], electrical: CP }, { inputOrigin: 'legacy-project', allocation: ON_A(10), catalogueSelection: { k1: { entryId: 'syn-4x70', completeSets: 2 } } });
    expect(c.solve.converged).toBe(true);
    expect(Math.abs(c.spans[0].current.a.value!.magnitude - REF.N7a.I)).toBeLessThan(TOL.A);
    expect(Math.abs(c.spans[0].current.n.value!.magnitude - REF.N7a.I)).toBeLessThan(TOL.A);
    for (const p of ['a', 'b', 'c'] as const) near(A(c).dropV[p], REF.N7a.dV[p], TOL.V);
    near(c.spans[0].pLossW, REF.N7a.P, TOL.W);
    near(c.spans[0].qAbsorbedVar, REF.N7a.Q, TOL.W);
  });
  it('(b) without completeSets: not run, no current at all, only S', () => {
    const { c } = run({ Lm: 100, props: { ...BASE, parallel: 2 }, consumers: [CIRCLES(10)], electrical: CP }, { inputOrigin: 'legacy-project', allocation: ON_A(10) });
    expect(c.solve.status).toBe('not-run');
    expect(c.solve.reason).toBe('neutral-parallel-unknown');
    const s = c.spans[0];
    for (const q of [s.current.a, s.current.n, s.arithmeticSumA.a, s.arithmeticSumA.n, s.perSetCurrentA.a, s.pLossW, s.qAbsorbedVar, A(c).voltage.a, A(c).dropV.a, c.loads[0].currentA.a]) {
      expect(q.status).toBe('not-run');
      expect(q.value).toBeUndefined();
    }
    expect(c.loads[0].apparentPowerVA!.a.value).toBe(9200);
    // P3-2: S is an input (Vph · |Irule|), not a result of F1′
    expect(c.loads[0].apparentPowerVA!.a.method).toBe('input');
  });
  it('(c) balanced 3ph constant power, parallel = 2 without completeSets: computed (no neutral current)', () => {
    const { c } = run({ Lm: 200, props: { ...BASE, parallel: 2 }, consumers: [SQ('60')], electrical: CP }, { inputOrigin: 'legacy-project' });
    expect(Math.abs(c.spans[0].current.a.value!.magnitude - REF.N7c.I)).toBeLessThan(TOL.A);
    near(A(c).dropV.a, REF.N7c.dV, TOL.V);
    near(c.spans[0].pLossW, REF.N7c.P, TOL.W);
    near(c.spans[0].qAbsorbedVar, REF.N7c.Q, TOL.W);
  });
});

// ---------- purity, on the golden networks of the existing engine ----------
const CASES = [...goldenCases(), ...goldenTreeCases()];
const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]); }
  return v;
};
const docOf = (g: (typeof CASES)[number], s: ElectricalSettings = g.settings): ProjectDocument => ({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical: s });
const quantities = (v: unknown, out: Quantity<unknown>[] = []): Quantity<unknown>[] => {
  if (v && typeof v === 'object') {
    if ('status' in v && 'unit' in v && 'method' in v) out.push(v as Quantity<unknown>);
    else for (const x of Object.values(v)) quantities(x, out);
  }
  return out;
};

describe('purity and consistency on the golden networks', () => {
  const variants = (g: (typeof CASES)[number]) => [g.settings, { ...g.settings, loadModel: 'constant-power' as const }];
  it('deep-frozen documents: nothing written, same result twice, every Quantity consistent', () => {
    let runs = 0, values = 0;
    for (const g of CASES) for (const s of variants(g)) for (const inputOrigin of ['legacy-project', 'e2-input'] as const) {
      const doc = deepFreeze(docOf(g, s));
      const text = JSON.stringify(doc);
      const r1 = runStudyE2(doc, { inputOrigin }), r2 = runStudyE2(doc, { inputOrigin });
      expect(JSON.stringify(doc)).toBe(text);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
      for (const q of quantities(r1.circuits)) {
        if (q.status === 'computed' || q.status === 'provisional') { expect(q.value).toBeDefined(); expect(q.reason).toBeUndefined(); values++; }
        else { expect(q.value).toBeUndefined(); expect(q.reason).toBeDefined(); }
        if (q.status === 'computed') expect(q.warnings).toEqual([]);
        if (q.status === 'provisional') expect(q.warnings.length).toBeGreaterThan(0);
        // XN never comes from anywhere but a catalogue (the app's catalogue is empty) — never from X (Stage A)
        expect(q.inputs.some((i) => i.name === 'XN')).toBe(false);
      }
      // no single-phase load gets a phase current without an allocation
      const singles = new Set(g.elements.filter((e) => e.type === 'consumer' && (e as { variant?: string }).variant === 'circle').map((e) => e.id));
      for (const c of r1.circuits) for (const l of c.loads) if (singles.has(l.consumerId)) for (const p of ['a', 'b', 'c'] as const) expect(l.currentA[p].value).toBeUndefined();
      runs++;
    }
    expect(runs).toBe(CASES.length * 4);
    console.info(`E2 purity: ${runs} runs, ${values} quantities with a value`);
  }, 60_000);
  it('runStudyE2 refuses a call without inputOrigin', () => {
    expect(() => runStudyE2(docOf(CASES[0]), {} as E2Options)).toThrow(/inputOrigin/);
  });
  it('comparison with the existing engine (information only, not a pass condition)', () => {
    let compared = 0, maxDiff = 0;
    for (const g of CASES) {
      const legacy = computeVoltageDrop(g.elements as DrawingElement[], g.distances, { ...g.settings, powerFactor: g.settings.powerFactor ?? 0.9 });
      const e2 = runStudyE2(docOf(g), { inputOrigin: 'legacy-project' });
      for (const c of e2.circuits) for (const n of c.nodes) {
        const d = n.dropV.a.value;
        const l = legacy.byPole.get(n.poleId)?.find((p) => p.bus === n.bus)?.dropV;
        if (d === undefined || l === undefined) continue;
        compared++; maxDiff = Math.max(maxDiff, Math.abs(d - l));
      }
    }
    console.info(`E2 vs legacy (phase a, both computed): ${compared} nodes, max |difference| ${maxDiff.toFixed(4)} V`);
    expect(compared).toBeGreaterThanOrEqual(0);
  });
});

describe('E2 Phase 1 corrections (study)', () => {
  const DOC = { ...BASE, parallel: 1 };
  it('P3-3 a refused catalogue entry and an unknown id are two different issues; no catalogue value is used', () => {
    const e = synEntry();
    const refusedEntry = { ...e, x: { ...e.x!, source: { ...e.x!.source, page: ' ' } } };
    const refused = run({ Lm: 100, props: DOC, consumers: [SQ('30')] }, { inputOrigin: 'e2-input', catalogue: synCatalogue(refusedEntry) });
    expect(refused.r.catalogueErrors).toContainEqual({ entryId: 'syn-4x70', field: 'x', problem: 'no-page' });
    const ir = refused.r.issues.filter((i) => i.code.startsWith('catalogue:'));
    expect(ir).toEqual([{ code: 'catalogue:entry-refused', severity: 'reported', target: { kind: 'span', id: 'k1#0' }, params: { entryId: 'syn-4x70', problems: 'x:no-page' } }]);
    const unknown = run({ Lm: 100, props: DOC, consumers: [SQ('30')] }, { inputOrigin: 'e2-input', catalogueSelection: { k1: { entryId: 'nope' } } });
    const iu = unknown.r.issues.filter((i) => i.code.startsWith('catalogue:'));
    expect(iu).toEqual([{ code: 'catalogue:entry-not-found', severity: 'reported', target: { kind: 'span', id: 'k1#0' }, params: { entryId: 'nope' } }]);
    for (const x of [refused, unknown]) {
      expect(A(x.c).dropV.a.value).toBeUndefined();
      expect(A(x.c).dropV.a.reason).toBe('impedance-missing');
      expect(JSON.stringify(x.c)).not.toContain('"provenance":"catalogue"');
    }
  });
  it('P5-1 an allocation without verification counts as unverified: allocation-unverified, provisional', () => {
    const { c } = run({ Lm: 200, props: DOC, consumers: [CIRCLES(5)] }, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { a: 5, source: 'design' } }, singlePhaseSpans: {} } });
    expect(A(c).dropV.a.status).toBe('provisional');
    expect(A(c).dropV.a.warnings).toEqual(['load-default', 'allocation-unverified']);
    expect(c.loads[0].currentA.a.warnings).toContain('allocation-unverified');
    // the values are those of the same allocation verified: only the status changes
    near(A(c).dropV.a, REF.C4c.dV.a, TOL.V);
  });
  it('P5-2 verification "unverified" written explicitly: allocation-unverified, provisional', () => {
    const { c } = run({ Lm: 200, props: DOC, consumers: [CIRCLES(5)] }, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { a: 5, source: 'site-survey', verification: { status: 'unverified' } } }, singlePhaseSpans: {} } });
    expect(A(c).dropV.a.status).toBe('provisional');
    expect(A(c).dropV.a.warnings).toContain('allocation-unverified');
  });
  it('P5-3 "checked" and "approved" give no allocation-unverified; an unknown status is refused', () => {
    for (const status of ['checked', 'approved'] as const) {
      const { c } = run({ Lm: 200, props: DOC, consumers: [CIRCLES(5)] }, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { a: 5, source: 'design', verification: { status, by: 'synthetic', on: '2026-10-31' } } }, singlePhaseSpans: {} } });
      expect(A(c).dropV.a.warnings).toEqual(['load-default']);
      expect(JSON.stringify(c)).not.toContain('allocation-unverified');
    }
    const bad = run({ Lm: 200, props: DOC, consumers: [CIRCLES(5)] }, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { a: 5, source: 'design', verification: { status: 'ok' as never } } }, singlePhaseSpans: {} } }).c;
    expect(bad.solve).toMatchObject({ status: 'not-run', reason: 'phase-allocation-invalid' });
  });
  it('I-1 an orphan consumer (no cable of its colour at its pole): issue, not calculated, circuit provisional', () => {
    const orphan = { variant: 'square' as const, label: '30', color: '#00ff00' };
    const without = run({ Lm: 200, props: DOC, consumers: [SQ('30')] }, { inputOrigin: 'e2-input' });
    const withOrphan = run({ Lm: 200, props: DOC, consumers: [SQ('30'), orphan] }, { inputOrigin: 'e2-input' });
    expect(A(without.c).dropV.a.status).toBe('computed');
    expect(withOrphan.r.issues).toContainEqual({ code: 'network:orphan-consumer', severity: 'provisional', target: { kind: 'consumer', id: 'u1' }, params: { consumerId: 'u1', poleId: 'A', color: '#00ff00', source: 'e1-network' } });
    // not in the calculation: no load, same numbers as without it (F8: computed without the symmetry shortcut, IN of the connected loads ≈ 0)
    expect(withOrphan.c.loads.map((l) => l.consumerId)).toEqual(['u0']);
    near(A(withOrphan.c).dropV.a, num(A(without.c).dropV.a), 1e-12);
    expect(A(withOrphan.c).dropV.a.status).toBe('provisional');
    expect(A(withOrphan.c).dropV.a.warnings).toEqual(['orphan-consumer-excluded']);
    expect(withOrphan.c.spans[0].pLossW.warnings).toEqual(['orphan-consumer-excluded']);
  });
  it('I-2 a proposed consumer in the study: proposed-load, provisional, the consumer is named', () => {
    const proposal = (status: 'proposed' | 'confirmed') => ({ variant: 'square' as const, label: '30', proposal: { status, connection: { cableId: 'k1', occurrence: 0 } } });
    const p = run({ Lm: 200, props: DOC, consumers: [SQ('30'), proposal('proposed')], electrical: { studyProposedConsumers: true } }, { inputOrigin: 'e2-input' });
    expect(p.c.loads.map((l) => l.consumerId)).toEqual(['u0', 'u1']);
    expect(p.r.issues).toContainEqual(expect.objectContaining({ code: 'study:proposed-consumer', severity: 'provisional', target: { kind: 'consumer', id: 'u1' } }));
    expect(A(p.c).dropV.a.status).toBe('provisional');
    expect(A(p.c).dropV.a.warnings).toEqual(['proposed-load']);
    expect(p.c.loads.find((l) => l.consumerId === 'u1')!.currentA.a.warnings).toEqual(['proposed-load']);
    // D1-LOC couples every result of the circuit: the existing consumer's current is provisional too
    expect(p.c.loads.find((l) => l.consumerId === 'u0')!.currentA.a.warnings).toEqual(['proposed-load']);
    // a confirmed proposal is a permanent subscriber: no warning
    const ok = run({ Lm: 200, props: DOC, consumers: [SQ('30'), proposal('confirmed')] }, { inputOrigin: 'e2-input' });
    expect(ok.c.loads.map((l) => l.consumerId)).toEqual(['u0', 'u1']);
    expect(A(ok.c).dropV.a.status).toBe('computed');
    expect(ok.r.issues.some((i) => i.code === 'study:proposed-consumer')).toBe(false);
  });
  it('I-4 a 1 m distance: length-suspect, not used as a length, the entered value is kept', () => {
    const { r, c, doc } = run({ Lm: 1, props: DOC, consumers: [SQ('30')] }, { inputOrigin: 'e2-input' });
    expect(r.issues).toContainEqual({ code: 'length-suspect', severity: 'blocks', target: { kind: 'span', id: 'k1#0' }, params: { limitM: 1 } });
    expect(A(c).dropV.a).toMatchObject({ status: 'unavailable', reason: 'length-suspect' });
    expect(c.spans[0].pLossW.value).toBeUndefined();
    expect(Object.values(doc.connectionDistances)).toEqual(['1']);
    // 2 m is a length
    expect(A(run({ Lm: 2, props: DOC, consumers: [SQ('30')] }, { inputOrigin: 'e2-input' }).c).dropV.a.status).toBe('computed');
  });
});
