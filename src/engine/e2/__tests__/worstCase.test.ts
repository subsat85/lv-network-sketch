import { describe, expect, it } from 'vitest';
import { createCableType, latestRevision } from '../../../utils/cableTypeModel';
import { linkSpanCable } from '../../../utils/spanCableLink';
import { normalizeElements, withSpanProps } from '../../../utils/spanModel';
import { pairKey } from '../../../utils/cableSegments';
import { DEFAULT_ELECTRICAL } from '../../../utils/electricalSettings';
import { voltageView } from '../../../utils/e2Presentation';
import { badgeText } from '../../../utils/vdOverlayLayout';
import { allocateSinglePhase, runStudyE2, type E2StudyResult, type PhaseAllocation } from '..';

// Worst Case (worstCase.ts): all single-phase loads on one phase only when the condition proves it;
// otherwise every distribution is checked, or the result is searched and says so. Every
// distribution is evaluated by E2 itself. ALL VALUES SYNTHETIC.

const val = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'checked' } });
const mk = (k: string, R: number, X: number, RN: number, XN: number) => latestRevision(createCableType(`ct_${k}`, { name: k, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'al', sectionMm2: 70 }, r: val(R, 'unspecified'), x: val(X, 'ac-50hz'), rn: val(RN, 'unspecified'), xn: val(XN, 'ac-50hz'), source: { name: 'synthetic' } } as never, { now: 1 }));
const CABLE = {
  C1: mk('C1', 0.5, 0.08, 0.5, 0.08), // resistive: ∠Z ≈ 9°
  XX: mk('XX', 0.05, 0.3, 0.05, 0.3), // very reactive: ∠Z ≈ 80° (synthetic extreme)
};
type Edge = [string, string, number, keyof typeof CABLE];
const pole = (id: string) => ({ id, type: 'symbol', symbolId: id.startsWith('T') ? 'transformer' : 'lv-pole', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const doc = (edges: Edge[], loads: { bus: string; count: number }[], pf: number) => {
  const buses = [...new Set(edges.flatMap((e) => [e[0], e[1]]))];
  const cables = edges.map((e, i) => ({ id: `k${i}`, type: 'cable', x: 0, y: 0, poleIds: [e[0], e[1]], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 }));
  const cons = loads.map((l, i) => ({ id: `u${i}`, type: 'consumer', x: 0, y: 0, poleId: l.bus, color: '#ff0000', count: l.count, variant: 'circle', strokeColor: '#000', fillColor: '#000', strokeWidth: 2 }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let els: any[] = normalizeElements([...buses.map(pole), ...cables, ...cons] as never);
  els = els.map((el) => {
    if (el.type !== 'cable') return el;
    const e = edges[Number(el.id.slice(1))];
    const { poles: _p, ...props } = linkSpanCable({ poles: [e[0], e[1]], system: '3ph4w' }, [e[0], e[1]], CABLE[e[3]], 1);
    return withSpanProps(el, el.spanIds[0], { poles: [e[0], e[1]], ...props });
  });
  const connectionDistances: Record<string, string> = {};
  for (const e of edges) connectionDistances[pairKey(e[0], e[1])] = String(e[2]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { elements: els, connectionDistances, distanceFlags: {}, electrical: { ...DEFAULT_ELECTRICAL, powerFactor: pf, singlePhaseMode: 'worst' } } as any;
};
const highest = (r: E2StudyResult) => {
  let w = -Infinity;
  for (const c of r.circuits) for (const n of c.nodes) for (const p of ['a', 'b', 'c'] as const) { const q = n.dropPercent[p]; if (q.value !== undefined && q.value > w) w = q.value; }
  return w;
};
/** every distribution of the units of u0 and u1 over a, b, c (counts), evaluated with E2 */
const exhaustiveMax = (d: ReturnType<typeof doc>, n0: number, n1: number) => {
  const comps = (n: number) => { const o: [number, number, number][] = []; for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) o.push([a, b, n - a - b]); return o; };
  let best = -Infinity, count = 0;
  for (const [a0, b0, c0] of comps(n0)) for (const [a1, b1, c1] of comps(n1)) {
    const allocation: PhaseAllocation = { consumers: { u0: { a: a0, b: b0, c: c0, source: 'design' }, u1: { a: a1, b: b1, c: c1, source: 'design' } }, singlePhaseSpans: {} } as PhaseAllocation;
    best = Math.max(best, highest(runStudyE2(d, { inputOrigin: 'legacy-project', allocation })));
    count++;
  }
  return { best, count };
};

// the case the final review found: reactive trunk, resistive branch, pf 1.0 — a mixed distribution is worse
const MIX: Edge[] = [['T', 'A', 150, 'XX'], ['A', 'B', 150, 'C1'], ['A', 'C', 10, 'XX']];
const MIX_LOADS = [{ bus: 'B', count: 3 }, { bus: 'C', count: 3 }];

describe('Worst Case: the condition', () => {
  it('resistive cables: the condition holds, all on one phase is the worst (checked against every distribution)', () => {
    const d = doc([['T', 'A', 150, 'C1'], ['A', 'B', 150, 'C1'], ['A', 'C', 10, 'C1']], MIX_LOADS, 1.0);
    const r = runStudyE2(d, { inputOrigin: 'legacy-project', allocationMethod: 'worst' });
    expect(Object.values(r.worstCase!).map((x) => x.guarantee)).toEqual(['condition']);
    const allA = runStudyE2(d, { inputOrigin: 'legacy-project', allocation: allocateSinglePhase(d, d.electrical, 'worst') });
    expect(highest(r)).toBe(highest(allA)); // one E2 run, the same result as before
    const ex = exhaustiveMax(d, 3, 3);
    expect(ex.count).toBe(100);
    expect(highest(r)).toBeGreaterThanOrEqual(ex.best - 1e-9);
  });
  it('the same network at pf 0.9: the condition holds again (φ moves ∠Z − φ below the bound)', () => {
    const r = runStudyE2(doc(MIX, MIX_LOADS, 0.9), { inputOrigin: 'legacy-project', allocationMethod: 'worst' });
    expect(Object.values(r.worstCase!)[0].guarantee).toBe('condition');
  });
});

describe('Worst Case: the case that failed before (XX trunk, C1 branch, pf 1.0)', () => {
  const d = doc(MIX, MIX_LOADS, 1.0);
  const ex = exhaustiveMax(d, 3, 3);
  it('all on one phase is NOT the worst here (the reason the three scenarios are not a guarantee)', () => {
    const allA = highest(runStudyE2(d, { inputOrigin: 'legacy-project', allocation: allocateSinglePhase(d, d.electrical, 'worst') }));
    expect(allA).toBeCloseTo(0.9444, 3);
    expect(ex.best).toBeCloseTo(1.0457, 3);
    expect(ex.best - allA).toBeGreaterThan(0.1);
  });
  it('Worst Case checks every distribution and finds the global maximum', () => {
    const r = runStudyE2(d, { inputOrigin: 'legacy-project', allocationMethod: 'worst' });
    const g = Object.values(r.worstCase!)[0];
    expect(g.guarantee).toBe('exhaustive');
    expect(g.evaluations).toBe(ex.count + 1);
    expect(highest(r)).toBeCloseTo(ex.best, 9);
    // no load lost or doubled: 6 units × 4 A in total (constant current)
    const amps = r.circuits.flatMap((c) => c.loads).reduce((t, l) => t + (['a', 'b', 'c'] as const).reduce((u, p) => u + (l.currentA[p].value ?? 0), 0), 0);
    expect(amps).toBeCloseTo(24, 9);
  });
  it('the search (when too large to enumerate) finds the same maximum here, and says it is not a guarantee', () => {
    const r = runStudyE2(d, { inputOrigin: 'legacy-project', allocationMethod: 'worst', worstCaseLimits: { exhaustive: 0, search: 300 } });
    const g = Object.values(r.worstCase!)[0];
    expect(g.guarantee).toBe('searched');
    expect(g.evaluations).toBeLessThanOrEqual(300);
    expect(highest(r)).toBeCloseTo(ex.best, 9);
  });
  it('the view and the drawing: Worst Case named with its guarantee, badges marked ▲; Equal Phase Current unmarked', () => {
    const w = voltageView(d);
    expect(w.method).toBe('worst');
    expect(w.worstCase).toBe('exhaustive');
    expect(w.circuits[0].worstCase).toBe('exhaustive');
    const p = [...w.byPole.values()].flat().find((x) => x.status !== 'na')!;
    expect(badgeText(p, true).startsWith('▲')).toBe(true);
    const b = voltageView({ ...d, electrical: { ...d.electrical, singlePhaseMode: 'balanced' } });
    expect(b.method).toBe('balanced');
    expect(b.worstCase).toBeUndefined();
    expect(b.study.worstCase).toBeUndefined();
    const q = [...b.byPole.values()].flat().find((x) => x.status !== 'na')!;
    expect(badgeText(q, b.method === 'worst')).not.toContain('▲');
  });
});

describe('Worst Case leaves everything else as it was', () => {
  it('Equal Phase Current: the allocation is exactly the one of allocateSinglePhase (unchanged)', () => {
    const d = doc(MIX, MIX_LOADS, 1.0);
    const a = runStudyE2(d, { inputOrigin: 'legacy-project', allocationMethod: 'balanced' });
    const b = runStudyE2(d, { inputOrigin: 'legacy-project', allocation: allocateSinglePhase(d, d.electrical, 'balanced') });
    expect(JSON.stringify(a.circuits)).toBe(JSON.stringify(b.circuits));
  });
  it('a given allocation is used as it is (no search)', () => {
    const d = doc(MIX, MIX_LOADS, 1.0);
    const r = runStudyE2(d, { inputOrigin: 'legacy-project', allocation: allocateSinglePhase(d, d.electrical, 'worst') });
    expect(r.worstCase).toBeUndefined();
  });
});
