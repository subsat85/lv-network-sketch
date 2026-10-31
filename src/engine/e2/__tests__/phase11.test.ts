import { describe, expect, it } from 'vitest';
import type { CableElement, ConsumerElement, ConsumerProposal, DrawingElement, ElectricalSettings, SymbolElement } from '../../../types/drawing';
import { normalizeElements } from '../../../utils/spanModel';
import { effectiveSettings } from '../../../utils/electricalSettings';
import { goldenCases, goldenTreeCases } from '../../../utils/__tests__/vdGoldenNetworks';
import type { NetworkIssue } from '../../../utils/network';
import { runStudy } from '../../index';
import { toNetwork } from '../../adapter';
import type { DataIssue } from '../../issues';
import type { ProjectDocument } from '../../model';
import { runStudyE2, type E2Options } from '../index';
import type { CircuitResult } from '../model';
import type { PhaseAllocation } from '../phases';
import type { Quantity } from '../quantity';
import { solveCircuit } from '../sweep';
import { circuit, drawing, SETTINGS, settingsOf, span, synCatalogue, synEntry, three, Z, zd, zmiss } from './references';

// E2 Phase 1.1: findings F1–F9 of the final review (F10 deferred, F11 is a comment).

const RED = '#ff0000', BLUE = '#0000ff', GREEN = '#00ff00';
const pole = (id: string, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string) => pole(id, { symbolId: 'transformer' });
const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: RED, fillColor: 'none', strokeWidth: 2, ...extra });
const sub = (id: string, poleId: string, color = RED, extra: Partial<ConsumerElement> = {}): ConsumerElement =>
  ({ id, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: '30', strokeColor: color, fillColor: color, strokeWidth: 2, ...extra });
const prop = (id: string, poleId: string, p: ConsumerProposal) => sub(id, poleId, RED, { proposal: p });
const docOf = (els: DrawingElement[], electrical: Partial<ElectricalSettings> = {}): ProjectDocument =>
  ({ elements: normalizeElements(els), connectionDistances: {}, distanceFlags: {}, electrical: settingsOf(electrical) });
const E2 = (doc: ProjectDocument, o: Partial<E2Options> = {}) => runStudyE2(doc, { inputOrigin: 'e2-input', catalogue: synCatalogue(synEntry(), synEntry('syn-3x70', false)), catalogueSelection: { k1: { entryId: 'syn-4x70' } }, ...o });
const key = (i: DataIssue) => `${i.code}|${i.target.kind}:${i.target.id}`;
const A = (c: CircuitResult) => c.nodes.find((n) => n.poleId === 'A')!;
const main = (r: ReturnType<typeof E2>) => r.circuits.find((x) => x.spans.length > 0)!;
const checked = { verification: { status: 'checked' as const } };
const allQ = (c: CircuitResult): Quantity<unknown>[] => [
  c.pLossW, c.qAbsorbedVar,
  ...c.nodes.flatMap((n) => [...Object.values(n.voltage), n.neutralShiftV, ...Object.values(n.lineV), ...Object.values(n.dropV), ...Object.values(n.dropPercent)]),
  ...c.spans.flatMap((s) => [...Object.values(s.current), ...Object.values(s.perSetCurrentA), ...Object.values(s.arithmeticSumA), ...Object.values(s.dropV), s.pLossW, s.qAbsorbedVar]),
  ...c.loads.flatMap((l) => Object.values(l.currentA)),
];

// one drawing per representative E1 issue kind
const FIXTURES: { name: string; kind: NetworkIssue['kind']; doc: ProjectDocument }[] = [
  { name: 'loop', kind: 'loop', doc: docOf([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B', 'T'])]) },
  { name: 'missing pole', kind: 'missing-pole', doc: docOf([tr('T'), pole('A'), cable('c', ['T', 'A', 'Z'])]) },
  { name: 'legacy jumper', kind: 'legacy-jumper', doc: docOf([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A']), cable('d', ['B', 'A'], { strokeColor: BLUE }), { id: 'L', type: 'jumper', fromPoleId: 'A', toPoleId: 'B', x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 } as DrawingElement]) },
  { name: 'ambiguous junction', kind: 'ambiguous-junction', doc: docOf([tr('T'), pole('X'), pole('Y'), pole('P'), pole('Q'), pole('B'), cable('t1', ['T', 'X', 'Y']), cable('t2', ['P', 'X', 'Q']), cable('br', ['X', 'B']), sub('u', 'B')]) },
  { name: 'split side unassigned', kind: 'split-side-unassigned', doc: docOf([tr('T'), pole('A'), pole('B'), pole('C'), cable('main', ['T', 'A', 'B', 'C'], { suggestedSplits: ['B'] }), sub('s', 'C'), prop('p', 'B', { status: 'confirmed', connection: { cableId: 'main', occurrence: 0 } })], { studySuggestedSplits: true }) },
  { name: 'proposal unconnected (blocks)', kind: 'proposed-consumer-unconnected', doc: docOf([tr('T'), pole('A'), cable('c', ['T', 'A']), prop('p', 'A', { status: 'proposed', connection: { cableId: 'gone', occurrence: 0 } })], { studyProposedConsumers: true }) },
  { name: 'proposal unconnected (no cable at its pole)', kind: 'proposed-consumer-unconnected', doc: docOf([tr('T'), pole('A'), pole('Z'), cable('c', ['T', 'A']), prop('p', 'Z', { status: 'proposed', connection: { cableId: 'c', occurrence: 0 } })], { studyProposedConsumers: true }) },
  { name: 'orphan', kind: 'orphan-consumer', doc: docOf([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('o', 'A', BLUE)]) },
];
const GOLDEN = [...goldenCases(), ...goldenTreeCases()].map((g) => ({ name: g.name, doc: { elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical: g.settings } as ProjectDocument }));
const e1Issues = (doc: ProjectDocument): { issue: NetworkIssue; circuitId?: string }[] => {
  const { legacy } = toNetwork(doc, effectiveSettings(doc.electrical as ElectricalSettings));
  return [...legacy.issues.map((issue) => ({ issue })), ...legacy.circuits.flatMap((c) => c.issues.map((issue) => ({ issue, circuitId: c.id })))];
};

describe('F1 every E1 network issue is in the E2 result', () => {
  it('the same network issues as E1 (code and target), over the fixtures and every golden network; none twice', () => {
    for (const { name, doc } of [...FIXTURES, ...GOLDEN]) {
      const e1 = new Set(runStudy(doc).issues.filter((i) => i.code.startsWith('network:')).map(key));
      const e2 = E2(doc).issues.filter((i) => i.code.startsWith('network:'));
      expect(new Set(e2.map(key)), name).toEqual(e1);
      expect(new Set(e2.map((i) => JSON.stringify(i))).size, name).toBe(e2.length);
    }
  });
  it('each representative kind keeps its kind, source and every field of E1', () => {
    for (const { name, kind, doc } of FIXTURES) {
      const found = e1Issues(doc).filter((x) => x.issue.kind === kind);
      expect(found.length, name).toBeGreaterThan(0);
      const e2 = E2(doc).issues;
      for (const { issue, circuitId } of found) {
        const fields = Object.fromEntries(Object.entries(issue).filter(([k]) => k !== 'kind').map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v]));
        const got = e2.filter((i) => i.code === `network:${kind}` && Object.entries(fields).every(([k, v]) => i.params?.[k] === v));
        expect(got, `${name}: ${JSON.stringify(issue)}`).toHaveLength(1);
        expect(got[0].params?.source).toBe('e1-network');
        if (circuitId) expect(String(got[0].params?.circuitIds).split(',')).toContain(circuitId);
      }
    }
  });
  it('an issue found in several circuits is one issue that names all of them', () => {
    const doc = FIXTURES.find((f) => f.kind === 'ambiguous-junction')!.doc;
    const inE1 = e1Issues(doc).filter((x) => x.issue.kind === 'ambiguous-junction');
    const distinct = new Set(inE1.map((x) => JSON.stringify(x.issue)));
    const e2 = E2(doc).issues.filter((i) => i.code === 'network:ambiguous-junction');
    expect(inE1.length).toBeGreaterThan(distinct.size);
    expect(e2).toHaveLength(distinct.size);
    const named = e2.flatMap((i) => String(i.params!.circuitIds).split(','));
    expect(new Set(named)).toEqual(new Set(inE1.map((x) => x.circuitId)));
  });
  it('the auto-junction review list of E1 is kept (network:inferred-junction)', () => {
    let n = 0;
    for (const { doc } of GOLDEN) {
      const e1 = runStudy(doc).issues.filter((i) => i.code === 'network:inferred-junction');
      const e2 = E2(doc).issues.filter((i) => i.code === 'network:inferred-junction');
      expect(e2.map(({ params, ...rest }) => ({ ...rest, params: { ...params, source: undefined } })).map((i) => JSON.stringify({ ...i, params: Object.fromEntries(Object.entries(i.params).filter(([, v]) => v !== undefined)) })))
        .toEqual(e1.map((i) => JSON.stringify(i)));
      n += e2.length;
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('F2 a proposal that cannot be connected', () => {
  // T —— A (k1, 200 m, documented), a subscriber at A, a proposal at pole Z (no cable there) naming k1
  const study = (on: boolean, extra: DrawingElement[]) => {
    const { doc } = drawing({ Lm: 200, props: { system: '3ph4w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'square', label: '30' }], electrical: { studyProposedConsumers: on } });
    return E2({ ...doc, elements: [...doc.elements, ...extra] });
  };
  const atZ = [pole('Z'), prop('p', 'Z', { status: 'proposed', connection: { cableId: 'k1', occurrence: 0 } })];
  it('study on: issue kept, not in the loads, the circuit it names is provisional (proposed-consumer-excluded)', () => {
    const r = study(true, atZ);
    const c = main(r);
    expect(r.issues).toContainEqual({ code: 'network:proposed-consumer-unconnected', severity: 'provisional', target: { kind: 'consumer', id: 'p' }, params: { consumerId: 'p', poleId: 'Z', source: 'e1-network' } });
    expect(c.loads.map((l) => l.consumerId)).toEqual(['u0']);
    expect(A(c).dropV.a).toMatchObject({ status: 'provisional', warnings: ['proposed-consumer-excluded'] });
    expect(c.spans[0].arithmeticSumA.a.warnings).toContain('proposed-consumer-excluded');
    expect(c.completeness.status).toBe('provisional');
  });
  it('study off: nothing changes (the approved behaviour)', () => {
    const off = study(false, atZ);
    expect(off.issues.some((i) => i.code === 'network:proposed-consumer-unconnected')).toBe(false);
    expect(A(main(off)).dropV.a.status).toBe('computed');
    expect(main(off).completeness.status).toBe('computed');
  });
  it('where it blocks the circuit (a cable at its pole, a connection that is not there): not-run, with the issue', () => {
    const r = study(true, [prop('p', 'A', { status: 'proposed', connection: { cableId: 'gone', occurrence: 0 } })]);
    const c = r.circuits.find((x) => x.nodes.some((n) => n.poleId === 'A'))!;
    expect(c.solve).toMatchObject({ status: 'not-run', reason: 'circuit-not-computed' });
    expect(c.completeness.status).toBe('not-run');
    for (const q of allQ(c)) expect(q.value).toBeUndefined();
    expect(r.issues).toContainEqual(expect.objectContaining({ code: 'network:proposed-consumer-unconnected', target: { kind: 'consumer', id: 'p' }, params: expect.objectContaining({ circuitIds: c.id }) }));
  });
});

describe('F3 the arithmetic bound carries what it rests on', () => {
  it('an excluded orphan: the bound is provisional with orphan-consumer-excluded', () => {
    const base = { Lm: 200, props: { system: '3ph4w' as const, cableKind: 'underground' as const, parallel: 1 } };
    const without = main(E2(drawing({ ...base, consumers: [{ variant: 'square', label: '30' }] }).doc));
    const withOrphan = main(E2(drawing({ ...base, consumers: [{ variant: 'square', label: '30' }, { variant: 'square', label: '30', color: GREEN }] }).doc));
    expect(without.spans[0].arithmeticSumA.a).toMatchObject({ status: 'computed', value: 30 });
    expect(withOrphan.spans[0].arithmeticSumA.a).toMatchObject({ status: 'provisional', value: 30, warnings: ['orphan-consumer-excluded'] });
    expect(withOrphan.spans[0].arithmeticSumA.n.warnings).toEqual(['orphan-consumer-excluded']);
  });
  it('an unverified 1ph2w allocation: the bound is provisional with allocation-unverified', () => {
    const { doc } = drawing({ Lm: 100, props: { system: '1ph2w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'square', label: '30', count: 1 }] });
    // a square is three-phase: use a single-phase subscriber with its own (checked) allocation
    const single = { ...doc, elements: doc.elements.map((e) => (e.type === 'consumer' ? { ...e, variant: 'circle', label: undefined, count: 5 } as DrawingElement : e)) };
    const allocation = (spanVerified: boolean): PhaseAllocation => ({ consumers: { u0: { b: 5, source: 'design', ...checked } }, singlePhaseSpans: { 'k1#0': { phase: 'b', source: 'design', ...(spanVerified ? checked : {}) } } });
    const ok = main(E2(single, { inputOrigin: 'legacy-project', allocation: allocation(true) })).spans[0].arithmeticSumA.b;
    const unverified = main(E2(single, { inputOrigin: 'legacy-project', allocation: allocation(false) })).spans[0].arithmeticSumA.b;
    expect(ok.warnings).toEqual(['load-default']);
    expect(unverified.status).toBe('provisional');
    expect(unverified.warnings.slice().sort()).toEqual(['allocation-unverified', 'load-default']);
    expect(unverified.value).toBe(20);
  });
  it('the power factor (not a current input) does not mark the bound', () => {
    const { doc } = drawing({ Lm: 200, props: { system: '3ph4w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'square', label: '30' }], electrical: { powerFactor: undefined } });
    const c = main(E2(doc));
    expect(A(c).dropV.a.warnings).toEqual(['power-factor-default']);
    expect(c.spans[0].arithmeticSumA.a).toMatchObject({ status: 'computed', warnings: [] });
  });
});

describe('F4 an invalid 1ph2w span allocation is an invalid input (not-run)', () => {
  const props = { system: '1ph2w' as const, cableKind: 'underground' as const, parallel: 1 };
  const doc = drawing({ Lm: 100, props, consumers: [{ variant: 'circle', count: 5 }] }).doc;
  const run = (spanAlloc: PhaseAllocation['singlePhaseSpans']) => main(E2(doc, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { b: 5, source: 'design', ...checked } }, singlePhaseSpans: spanAlloc } }));
  it('invalid phase, source or verification: the whole circuit not-run, no current or voltage given', () => {
    for (const bad of [
      { phase: 'd' as never, source: 'design' as const },
      { phase: 'b' as const, source: 'guess' as never },
      { phase: 'b' as const, source: 'design' as const, verification: { status: 'maybe' as never } },
      { phase: 'b' as const, source: 'design' as const, verification: { status: 'approved' as const, by: 7 as never, on: '2026-10-31' } },
    ]) {
      const c = run({ 'k1#0': bad });
      expect(c.solve, JSON.stringify(bad)).toMatchObject({ status: 'not-run', reason: 'phase-allocation-invalid', blockedBy: ['k1#0'] });
      expect(c.completeness).toMatchObject({ status: 'not-run', reason: 'phase-allocation-invalid' });
      for (const q of allQ(c)) { expect(q.status).toBe('not-run'); expect(q.value).toBeUndefined(); }
    }
  });
  it('a missing span allocation stays different: unavailable (|Irule| known, no voltage)', () => {
    const c = run({});
    expect(A(c).dropV.b).toMatchObject({ status: 'unavailable', reason: 'phase-allocation-missing' });
    expect(c.loads[0].currentA.b).toMatchObject({ status: 'provisional', value: 20 });
    expect(c.completeness).toMatchObject({ status: 'unavailable', reason: 'phase-allocation-missing' });
  });
  it('an invalid allocation on a span without current: the nodes behind it are not-run', () => {
    const c = circuit([
      span('S-A', 'S', 'A', { system: '3ph4w', zp: zd(Z(0.5, 0.08, 100)), zn: zd(Z(0.5, 0.08, 100)) }),
      { ...span('A-B', 'A', 'B', { system: '1ph2w', zp: zd(Z(0.5, 0.08, 50)), zn: zd(Z(0.5, 0.08, 50)) }), topologyReason: 'phase-allocation-invalid' as const },
    ], [three('u', 'A', 30)]);
    const r = solveCircuit(c, SETTINGS());
    expect(r.nodes.find((n) => n.bus === 'A')!.dropV.a.status).toBe('computed');
    const B = r.nodes.find((n) => n.bus === 'B')!;
    for (const q of [B.dropV.a, B.voltage.b, ...Object.values(r.spans[1].current)]) expect(q).toMatchObject({ status: 'not-run', reason: 'phase-allocation-invalid' });
    expect(r.completeness).toMatchObject({ status: 'not-run', reason: 'phase-allocation-invalid', blockedBy: ['A-B'] });
  });
});

describe('F5 an invalid parallel comes first', () => {
  const at = (Lm: number | undefined) => {
    const { doc } = drawing({ Lm: Lm ?? 100, props: { system: '3ph4w', cableKind: 'underground', parallel: 1.5 }, consumers: [{ variant: 'square', label: '30' }] });
    return E2(Lm === undefined ? { ...doc, connectionDistances: {} } : doc);
  };
  it('parallel 1.5 and no length (runStudyE2): not-run parallel-invalid, with its DataIssue; nothing inferred', () => {
    const r = at(undefined);
    const c = main(r);
    expect(r.issues).toContainEqual({ code: 'parallel-invalid', severity: 'blocks', target: { kind: 'span', id: 'k1#0' }, params: { value: '1.5' } });
    expect(c.solve).toMatchObject({ status: 'not-run', reason: 'parallel-invalid', blockedBy: ['k1#0'] });
    expect(A(c).dropV.a).toMatchObject({ status: 'not-run', reason: 'parallel-invalid' });
    for (const q of allQ(c)) expect(q.value).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('"name":"np"');
  });
  it('the same with a suspect length (1 m), and with a valid length', () => {
    for (const Lm of [1, 100]) expect(main(at(Lm)).solve, String(Lm)).toMatchObject({ status: 'not-run', reason: 'parallel-invalid' });
  });
});

describe('F6 solve status and result completeness', () => {
  const study = (consumers: Partial<ConsumerElement>[], o: Partial<E2Options> = {}) =>
    main(E2(drawing({ Lm: 200, props: { system: '3ph4w', cableKind: 'underground', parallel: 1 }, consumers }).doc, o));
  it('computed / provisional / unavailable / not-run', () => {
    const computed = study([{ variant: 'square', label: '30' }]);
    expect([computed.solve.status, computed.completeness.status]).toEqual(['computed', 'computed']);
    const provisional = study([{ variant: 'circle', count: 5 }], { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { a: 5, source: 'design', ...checked } }, singlePhaseSpans: {} } });
    expect([provisional.solve.status, provisional.completeness.status]).toEqual(['provisional', 'provisional']);
    // the sweep did not start (a phase is missing); the circuit's result is unavailable, not invalid
    const missing = study([{ variant: 'circle', count: 5 }]);
    expect(missing.solve.status).toBe('not-run');
    expect(missing.completeness).toMatchObject({ status: 'unavailable', reason: 'phase-allocation-missing' });
    const invalid = study([{ variant: 'circle', count: 5 }], { allocation: { consumers: { u0: { a: 4, source: 'design' } }, singlePhaseSpans: {} } });
    expect([invalid.solve.status, invalid.completeness.status]).toEqual(['not-run', 'not-run']);
  });
  it('a converged sweep with a not-run part: solve computed, completeness not-run, totals not-run', () => {
    const r = solveCircuit(circuit([
      span('S-A', 'S', 'A', { system: '3ph4w', zp: zd(Z(0.5, 0.08, 100)), zn: zd(Z(0.5, 0.08, 100)) }),
      span('A-B', 'A', 'B', { system: '3ph4w', zp: zmiss('parallel-invalid'), zn: zd(Z(0.5, 0.08, 100)) }),
    ], [three('u', 'A', 30)]), SETTINGS());
    expect(r.solve).toMatchObject({ status: 'computed', converged: true });
    expect(r.completeness).toEqual({ status: 'not-run', reason: 'parallel-invalid', blockedBy: ['A-B'] });
    expect(r.pLossW).toMatchObject({ status: 'not-run', reason: 'parallel-invalid' });
    expect(r.qAbsorbedVar).toMatchObject({ status: 'not-run', reason: 'parallel-invalid' });
  });
  it('a converged sweep with an unavailable part: completeness unavailable (never computed)', () => {
    const r = solveCircuit(circuit([
      span('S-A', 'S', 'A', { system: '3ph4w', zp: zd(Z(0.5, 0.08, 100)), zn: zd(Z(0.5, 0.08, 100)) }),
      span('A-B', 'A', 'B', { system: '3ph4w', zp: zmiss('impedance-missing'), zn: zd(Z(0.5, 0.08, 100)) }),
    ], [three('u', 'A', 30)]), SETTINGS());
    expect(r.solve.status).toBe('computed');
    expect(r.completeness).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
  });
  it('a phase the node does not have is not missing: a complete 1ph2w circuit is not unavailable', () => {
    const { doc } = drawing({ Lm: 100, props: { system: '1ph2w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'circle', count: 5 }] });
    const c = main(E2(doc, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { b: 5, source: 'design', ...checked } }, singlePhaseSpans: { 'k1#0': { phase: 'b', source: 'design', ...checked } } } }));
    expect(A(c).voltage.a.reason).toBe('phase-not-present');
    expect(c.completeness.status).toBe('provisional');
  });
});

describe('F7 a span that cannot be used', () => {
  const S_A = span('S-A', 'S', 'A', { system: '3ph4w', zp: zd(Z(0.5, 0.08, 100)), zn: zd(Z(0.5, 0.08, 100)) });
  const L = [three('u', 'A', 30)];
  it('an invalid one: every result of it not-run (current, per set, bound, drop, losses)', () => {
    const r = solveCircuit(circuit([S_A, span('A-B', 'A', 'B', { system: '3ph4w', zp: zmiss('parallel-invalid'), zn: zd(Z(0.5, 0.08, 100)) })], L), SETTINGS());
    const s = r.spans[1];
    for (const q of [...Object.values(s.current), ...Object.values(s.perSetCurrentA), ...Object.values(s.arithmeticSumA), ...Object.values(s.dropV), s.pLossW, s.qAbsorbedVar])
      expect(q).toMatchObject({ status: 'not-run', reason: 'parallel-invalid', blockedBy: ['A-B'] });
  });
  it('a missing impedance, no load behind it: current and losses zero by topology, drop not known', () => {
    const r = solveCircuit(circuit([S_A, span('A-B', 'A', 'B', { system: '3ph4w', zp: zmiss('impedance-missing'), zn: zd(Z(0.5, 0.08, 100)) })], L), SETTINGS());
    const s = r.spans[1];
    for (const k of ['a', 'b', 'c', 'n'] as const) {
      expect(s.current[k]).toMatchObject({ status: 'computed', method: 'topology', value: { magnitude: 0, angleDeg: 0 } });
      expect(s.perSetCurrentA[k]).toMatchObject({ status: 'computed', method: 'topology', value: 0 });
    }
    expect(s.pLossW).toMatchObject({ method: 'topology', value: 0 });
    expect(s.dropV.a).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
    // a calculated current is never labelled 'topology'
    expect(r.spans[0].current.a.method).toBe('F2');
  });
  it('a 1ph2w span without its phase: no conductor is claimed, the reason is the missing allocation', () => {
    const r = solveCircuit(circuit([S_A, { ...span('A-B', 'A', 'B', { system: '1ph2w', zp: zd(Z(0.5, 0.08, 50)), zn: zd(Z(0.5, 0.08, 50)) }), topologyReason: 'phase-allocation-missing' as const }], L), SETTINGS());
    for (const p of ['a', 'b', 'c'] as const) {
      expect(r.spans[1].current[p]).toMatchObject({ status: 'unavailable', reason: 'phase-allocation-missing' });
      expect(r.spans[1].dropV[p]).toMatchObject({ status: 'unavailable', reason: 'phase-allocation-missing' });
    }
  });
});

describe('F8 an orphan makes the phase distribution unknown', () => {
  const base = { Lm: 200, props: { system: '3ph4w' as const, cableKind: 'underground' as const, parallel: 1 } };
  const SQ = { variant: 'square' as const, label: '30' }, ORPHAN = { variant: 'circle' as const, count: 3, color: GREEN };
  it('three-phase circuit: no symmetry is assumed; IN from the connected loads (F2), with ZN; provisional', () => {
    const without = main(E2(drawing({ ...base, consumers: [SQ] }).doc));
    const withOrphan = main(E2(drawing({ ...base, consumers: [SQ, ORPHAN] }).doc));
    expect(without.spans[0].current.n.method).toBe('F7');
    expect(without.spans[0].pLossW.inputs.some((i) => i.name === 'XN')).toBe(false);
    const n = withOrphan.spans[0].current.n;
    expect(n.method).toBe('F2');
    expect(n.status).toBe('provisional');
    expect(withOrphan.spans[0].pLossW.inputs.some((i) => i.name === 'XN')).toBe(true);
    expect(withOrphan.spans[0].pLossW.assumptions).not.toEqual(without.spans[0].pLossW.assumptions);
    expect(A(withOrphan).dropV.a).toMatchObject({ status: 'provisional', warnings: ['orphan-consumer-excluded'] });
  });
  it('three-phase circuit without a neutral conductor: with an orphan the neutral is required → unavailable', () => {
    const sel = { catalogueSelection: { k1: { entryId: 'syn-3x70' } } };
    expect(A(main(E2(drawing({ ...base, consumers: [SQ] }).doc, sel))).dropV.a.status).toBe('computed');
    const c = main(E2(drawing({ ...base, consumers: [SQ, ORPHAN] }).doc, sel));
    expect(A(c).dropV.a).toMatchObject({ status: 'unavailable', reason: 'neutral-conductor-missing' });
    expect(c.spans[0].current.n.value).toBeUndefined();
    expect(c.completeness.status).toBe('unavailable');
  });
  it('single-phase circuit (1ph2w): provisional with the orphan, no orphan current invented', () => {
    const { doc } = drawing({ Lm: 100, props: { system: '1ph2w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'circle', count: 5 }, ORPHAN] });
    const c = main(E2(doc, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { b: 5, source: 'design', ...checked } }, singlePhaseSpans: { 'k1#0': { phase: 'b', source: 'design', ...checked } } } }));
    expect(c.loads.map((l) => l.consumerId)).toEqual(['u0']);
    expect(A(c).dropV.b.status).toBe('provisional');
    expect(A(c).dropV.b.warnings.slice().sort()).toEqual(['load-default', 'orphan-consumer-excluded']);
    expect(c.spans[0].current.b.value!.magnitude).toBeCloseTo(20, 9);
  });
});

describe('F9 verification metadata', () => {
  const doc = drawing({ Lm: 200, props: { system: '3ph4w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'circle', count: 5 }] }).doc;
  const run = (verification: unknown) => {
    const r = E2(doc, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { a: 5, source: 'site-survey', ...(verification === undefined ? {} : { verification: verification as never }) } }, singlePhaseSpans: {} } });
    return { r, c: main(r) };
  };
  it('approved with by and on: verified', () => {
    const { r, c } = run({ status: 'approved', by: 'synthetic reviewer', on: '2026-10-31' });
    expect(A(c).dropV.a.warnings).toEqual(['load-default']);
    expect(r.issues.some((i) => i.code === 'allocation:approval-incomplete')).toBe(false);
  });
  it('approved without by or on (or with empty text): not approved — provisional, with its issue', () => {
    for (const v of [{ status: 'approved' }, { status: 'approved', by: 'x' }, { status: 'approved', on: '2026-10-31' }, { status: 'approved', by: ' ', on: '' }]) {
      const { r, c } = run(v);
      expect(A(c).dropV.a.status, JSON.stringify(v)).toBe('provisional');
      expect(A(c).dropV.a.warnings).toContain('allocation-unverified');
      expect(r.issues).toContainEqual({ code: 'allocation:approval-incomplete', severity: 'provisional', target: { kind: 'consumer', id: 'u0' }, params: { needs: 'by,on' } });
    }
  });
  it('by / on that are not text: invalid input, not-run', () => {
    for (const v of [{ status: 'approved', by: 1, on: '2026-10-31' }, { status: 'checked', on: 20261031 }]) {
      const { c } = run(v);
      expect(c.solve, JSON.stringify(v)).toMatchObject({ status: 'not-run', reason: 'phase-allocation-invalid' });
    }
  });
  it('checked needs no by / on; unverified needs nothing; a source alone is never an approval', () => {
    expect(A(run({ status: 'checked' }).c).dropV.a.warnings).toEqual(['load-default']);
    expect(A(run({ status: 'unverified' }).c).dropV.a.warnings).toContain('allocation-unverified');
    expect(A(run(undefined).c).dropV.a.warnings).toContain('allocation-unverified');
  });
  it('the same on a 1ph2w span allocation', () => {
    const d = drawing({ Lm: 100, props: { system: '1ph2w', cableKind: 'underground', parallel: 1 }, consumers: [{ variant: 'circle', count: 5 }] }).doc;
    const r = E2(d, { inputOrigin: 'legacy-project', allocation: { consumers: { u0: { b: 5, source: 'design', ...checked } }, singlePhaseSpans: { 'k1#0': { phase: 'b', source: 'design', verification: { status: 'approved' } } } } });
    expect(r.issues).toContainEqual({ code: 'allocation:approval-incomplete', severity: 'provisional', target: { kind: 'span', id: 'k1#0' }, params: { needs: 'by,on' } });
    expect(A(main(r)).dropV.b.warnings).toContain('allocation-unverified');
  });
});
