import { describe, expect, it } from 'vitest';
import type { CableTypeData } from '../../../types/cableType';
import type { ElectricalSettings } from '../../../types/drawing';
import { createCableType, latestRevision } from '../../../utils/cableTypeModel';
import { linkSpanCable } from '../../../utils/spanCableLink';
import { normalizeElements, withSpanProps } from '../../../utils/spanModel';
import { pairKey } from '../../../utils/cableSegments';
import { DEFAULT_ELECTRICAL } from '../../../utils/electricalSettings';
import type { ProjectDocument } from '../../model';
import { allocateSinglePhase, runStudyE2, type AllocationMethod, type PhaseAllocation } from '../index';
import type { CircuitResult } from '../model';

// The Single-Phase Load Allocation Method: it only builds E2's PhaseAllocation input (the
// equations are not touched). ALL VALUES ARE SYNTHETIC (test cables, not real data).

const val = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'checked' } });
const cableType = (k: string, R: number, X: number, RN: number, XN: number) => latestRevision(createCableType(`ct_${k}`, {
  name: `${k} (synthetic)`, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'al', sectionMm2: 70 },
  r: val(R, 'unspecified'), x: val(X, 'ac-50hz'), rn: val(RN, 'unspecified'), xn: val(XN, 'ac-50hz'), source: { name: 'synthetic' },
} as unknown as CableTypeData, { now: 1 }));
const CABLES = { C1: cableType('C1', 0.5, 0.08, 0.5, 0.08), C2: cableType('C2', 0.3, 0.07, 0.6, 0.08), C3: cableType('C3', 0.2145, 0.0716, 0.4126, 0.0754) };
type Net = { edges: [string, string, number, keyof typeof CABLES, ('3ph4w' | '1ph2w')?][]; loads: { bus: string; kind: 'three' | 'single'; A?: number; count?: number }[]; electrical?: Partial<ElectricalSettings> };

const docOf = (n: Net): ProjectDocument => {
  const buses = [...new Set(n.edges.flatMap((e) => [e[0], e[1]]))];
  const pole = (id: string) => ({ id, type: 'symbol', symbolId: id === 'T' ? 'transformer' : 'lv-pole', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
  const cables = n.edges.map((e, i) => ({ id: `k${i}`, type: 'cable', x: 0, y: 0, poleIds: [e[0], e[1]], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 }));
  const cons = n.loads.map((l, i) => ({ id: `u${i}`, type: 'consumer', x: 0, y: 0, poleId: l.bus, color: '#ff0000', count: l.count ?? 1, variant: l.kind === 'three' ? 'square' : 'circle', ...(l.kind === 'three' ? { label: String(l.A) } : {}), strokeColor: '#000', fillColor: '#000', strokeWidth: 2 }));
  const els = (normalizeElements([...buses.map(pole), ...cables, ...cons] as never) as never[]).map((el: { type: string; id: string; spanIds: string[] }) => {
    if (el.type !== 'cable') return el;
    const e = n.edges[Number(el.id.slice(1))];
    const { poles: _p, ...props } = linkSpanCable({ poles: [e[0], e[1]], system: e[4] ?? '3ph4w' }, [e[0], e[1]], CABLES[e[3]], 1);
    return withSpanProps(el as never, el.spanIds[0], { poles: [e[0], e[1]], ...props });
  });
  const connectionDistances: Record<string, string> = {};
  for (const e of n.edges) connectionDistances[pairKey(e[0], e[1])] = String(e[2]);
  return { elements: els as never, connectionDistances, distanceFlags: {}, electrical: { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, ...n.electrical } };
};
const study = (d: ProjectDocument, o: { allocation?: PhaseAllocation; allocationMethod?: AllocationMethod }) => runStudyE2(d, { inputOrigin: 'legacy-project', ...o });
const main = (r: ReturnType<typeof study>) => r.circuits.find((c) => c.spans.length) as CircuitResult;
/** the highest phase-to-neutral drop (%) of any node: the Worst Case criterion */
const worstPercent = (c: CircuitResult) => Math.max(...c.nodes.flatMap((n) => (['a', 'b', 'c'] as const).map((p) => n.dropPercent[p].value ?? -Infinity)));
const counts = (a: PhaseAllocation, id: string) => { const x = a.consumers[id]; return [x.a ?? 0, x.b ?? 0, x.c ?? 0]; };

const NETS: Record<string, Net> = {
  branched: { edges: [['T', 'A', 60, 'C1'], ['A', 'B', 80, 'C2'], ['A', 'C', 40, 'C3'], ['C', 'D', 90, 'C1']], loads: [{ bus: 'A', kind: 'three', A: 10 }, { bus: 'B', kind: 'single', count: 4 }, { bus: 'C', kind: 'single', count: 3 }, { bus: 'D', kind: 'single', count: 5 }, { bus: 'D', kind: 'three', A: 15 }] },
  singlePhaseBranch: { edges: [['T', 'A', 50, 'C1'], ['A', 'B', 70, 'C1', '1ph2w'], ['A', 'C', 60, 'C3']], loads: [{ bus: 'B', kind: 'single', count: 3 }, { bus: 'C', kind: 'single', count: 6 }] },
  constantPower: { electrical: { loadModel: 'constant-power', powerFactor: 0.8 }, edges: [['T', 'A', 120, 'C3'], ['A', 'B', 150, 'C2'], ['B', 'C', 100, 'C1']], loads: [{ bus: 'A', kind: 'single', count: 8 }, { bus: 'B', kind: 'single', count: 6 }, { bus: 'C', kind: 'single', count: 10 }, { bus: 'C', kind: 'three', A: 20 }] },
};

describe('both methods: no load lost or counted twice, three-phase subscribers untouched', () => {
  it.each(Object.entries(NETS))('%s', (_n, net) => {
    const d = docOf(net);
    for (const m of ['worst', 'balanced'] as const) {
      const a = allocateSinglePhase(d, d.electrical as ElectricalSettings, m);
      net.loads.forEach((l, i) => {
        if (l.kind === 'three') { expect(a.consumers[`u${i}`]).toBeUndefined(); return; }
        expect(counts(a, `u${i}`).reduce((s, x) => s + x, 0)).toBe(l.count ?? 1);
        expect(a.consumers[`u${i}`]).toMatchObject({ source: m === 'worst' ? 'method-worst-case' : 'method-equal-current', verification: { status: 'unverified' } });
      });
      // E2 with the method = E2 with the same allocation given by hand: the method only builds the input
      expect(JSON.stringify(study(d, { allocationMethod: m }).circuits)).toBe(JSON.stringify(study(d, { allocation: a }).circuits));
      // the total current drawn from the source is the same for both methods (constant current)
      if (!net.electrical?.loadModel) {
        const sum = (r: CircuitResult) => r.loads.reduce((s, l) => s + (['a', 'b', 'c'] as const).reduce((t, p) => t + (l.currentA[p].value ?? 0), 0), 0);
        const expected = net.loads.reduce((s, l) => s + (l.kind === 'three' ? 3 * l.A! : (l.count ?? 1) * 4), 0);
        expect(sum(main(study(d, { allocationMethod: m })))).toBeCloseTo(expected, 9);
      }
    }
  });
});

describe('Worst Case: all single-phase subscribers on one phase, and no distribution gives a higher drop', () => {
  it.each(Object.entries(NETS))('%s: every unit on phase a; local search and random distributions find nothing worse (E2 itself)', (_n, net) => {
    const d = docOf(net);
    const base = allocateSinglePhase(d, d.electrical as ElectricalSettings, 'worst');
    for (const [, x] of Object.entries(base.consumers)) expect([x.b ?? 0, x.c ?? 0]).toEqual([0, 0]);
    for (const s of Object.values(base.singlePhaseSpans)) expect(s.phase).toBe('a');
    const w0 = worstPercent(main(study(d, { allocation: base })));
    // the circuit's results carry the method (provisional: not the actual distribution)
    const r = main(study(d, { allocationMethod: 'worst' }));
    expect(r.completeness.status).toBe('provisional');
    expect(r.nodes.flatMap((n) => Object.values(n.dropV)).some((q) => q.warnings.includes('allocation-unverified'))).toBe(true);
    // local search: move one subscriber of each consumer to b or c (consumers behind a 1ph2w span move with it: not alone)
    const behindSinglePhase = new Set(net.edges.some((e) => e[4] === '1ph2w') ? net.loads.map((l, i) => (net.edges.find((e) => e[1] === l.bus)?.[4] === '1ph2w' ? `u${i}` : '')).filter(Boolean) : []);
    for (const id of Object.keys(base.consumers)) {
      if (behindSinglePhase.has(id)) continue;
      for (const to of ['b', 'c'] as const) {
        const trial: PhaseAllocation = structuredClone(base);
        trial.consumers[id].a! -= 1; trial.consumers[id][to] = (trial.consumers[id][to] ?? 0) + 1;
        expect(worstPercent(main(study(d, { allocation: trial }))), `${id} → ${to}`).toBeLessThanOrEqual(w0 + 1e-9);
      }
    }
    // random distributions (deterministic generator): none is worse
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 60; k++) {
      const trial: PhaseAllocation = structuredClone(base);
      const spanPhase = (['a', 'b', 'c'] as const)[Math.floor(rnd() * 3)];
      for (const s of Object.values(trial.singlePhaseSpans)) s.phase = spanPhase;
      for (const [id, x] of Object.entries(trial.consumers)) {
        const n = (x.a ?? 0) + (x.b ?? 0) + (x.c ?? 0);
        x.a = 0; x.b = 0; x.c = 0;
        for (let u = 0; u < n; u++) { const p = behindSinglePhase.has(id) ? spanPhase : (['a', 'b', 'c'] as const)[Math.floor(rnd() * 3)]; x[p] = (x[p] ?? 0) + 1; }
      }
      expect(worstPercent(main(study(d, { allocation: trial })))).toBeLessThanOrEqual(w0 + 1e-9);
    }
  });
  it('the three phases are equivalent (symmetric source and three-phase loads): all on b or c gives the same worst drop', () => {
    const d = docOf(NETS.branched);
    const a = allocateSinglePhase(d, d.electrical as ElectricalSettings, 'worst');
    const on = (p: 'b' | 'c'): PhaseAllocation => ({ ...a, consumers: Object.fromEntries(Object.entries(a.consumers).map(([k, x]) => [k, { ...x, a: 0, [p]: x.a }])) });
    const w = worstPercent(main(study(d, { allocation: a })));
    expect(worstPercent(main(study(d, { allocation: on('b') })))).toBeCloseTo(w, 9);
    expect(worstPercent(main(study(d, { allocation: on('c') })))).toBeCloseTo(w, 9);
  });
});

describe('Equal Phase Current: nominal currents balanced on every span', () => {
  it('three subscribers on one branch: one on each phase; six at one pole: two on each (no neutral current)', () => {
    const d = docOf({ edges: [['T', 'A', 100, 'C1']], loads: [{ bus: 'A', kind: 'single', count: 6 }] });
    const a = allocateSinglePhase(d, d.electrical as ElectricalSettings, 'balanced');
    expect(counts(a, 'u0')).toEqual([2, 2, 2]);
    const c = main(study(d, { allocation: a }));
    expect(c.spans[0].current.n.value!.magnitude).toBeLessThan(1e-9);
    // = a balanced 8 A per phase (hand check: |V| = −Re w + √(Vph² − Im w²), w = Z·I·e^{−jφ})
    const Z = { re: 0.5 * 0.1, im: 0.08 * 0.1 }, I = 8, phi = Math.acos(0.9);
    const w = { re: I * (Z.re * Math.cos(-phi) - Z.im * Math.sin(-phi)), im: I * (Z.re * Math.sin(-phi) + Z.im * Math.cos(-phi)) };
    const V = -w.re + Math.sqrt(230 ** 2 - w.im ** 2);
    for (const p of ['a', 'b', 'c'] as const) expect(c.nodes.find((n) => n.poleId === 'A')!.dropV[p].value!).toBeCloseTo(230 - V, 3);
  });
  it('branches: each branch is balanced, and the currents add up on the main span', () => {
    const d = docOf({ edges: [['T', 'A', 50, 'C1'], ['A', 'B', 60, 'C1'], ['A', 'C', 40, 'C1']], loads: [{ bus: 'B', kind: 'single', count: 3 }, { bus: 'C', kind: 'single', count: 3 }] });
    const a = allocateSinglePhase(d, d.electrical as ElectricalSettings, 'balanced');
    expect(counts(a, 'u0')).toEqual([1, 1, 1]);
    expect(counts(a, 'u1')).toEqual([1, 1, 1]);
    const c = main(study(d, { allocation: a }));
    for (const s of c.spans) {
      const I = (['a', 'b', 'c'] as const).map((p) => s.current[p].value!.magnitude);
      expect(Math.max(...I) - Math.min(...I)).toBeLessThan(0.05);
    }
  });
  it('a single-phase branch is one block on one phase; the rest balances against it', () => {
    const d = docOf(NETS.singlePhaseBranch);
    const a = allocateSinglePhase(d, d.electrical as ElectricalSettings, 'balanced');
    const block = a.singlePhaseSpans['k1#0'].phase;
    expect(counts(a, 'u0')).toEqual((['a', 'b', 'c'] as const).map((p) => (p === block ? 3 : 0)));
    // the six subscribers of the three-phase branch avoid the block's phase as much as they can
    const other = counts(a, 'u1');
    expect(other[['a', 'b', 'c'].indexOf(block)]).toBeLessThan(2);
    expect(main(study(d, { allocation: a })).completeness.status).toBe('provisional');
  });
  it('balances better than Worst Case: lower neutral current on the first span, lower worst drop', () => {
    for (const net of Object.values(NETS)) {
      const d = docOf(net);
      const w = main(study(d, { allocationMethod: 'worst' })), b = main(study(d, { allocationMethod: 'balanced' }));
      expect(worstPercent(b)).toBeLessThan(worstPercent(w));
      expect(b.spans[0].current.n.value!.magnitude).toBeLessThan(w.spans[0].current.n.value!.magnitude);
    }
  });
});

describe('the default single-phase nominal load in E2', () => {
  it('changing it changes the single-phase currents in proportion, and nothing of a three-phase-only circuit', () => {
    const net: Net = { edges: [['T', 'A', 100, 'C1']], loads: [{ bus: 'A', kind: 'single', count: 3 }] };
    const at = (A: number) => main(study(docOf({ ...net, electrical: { singlePhaseNominalA: A } }), { allocationMethod: 'balanced' }));
    expect(at(4).spans[0].current.a.value!.magnitude).toBeCloseTo(4, 9);
    expect(at(6).spans[0].current.a.value!.magnitude).toBeCloseTo(6, 9);
    const three: Net = { edges: [['T', 'A', 100, 'C1']], loads: [{ bus: 'A', kind: 'three', A: 30 }] };
    const t = (A: number) => JSON.stringify(main(study(docOf({ ...three, electrical: { singlePhaseNominalA: A } }), { allocationMethod: 'worst' })));
    expect(t(9)).toBe(t(4));
  });
});
