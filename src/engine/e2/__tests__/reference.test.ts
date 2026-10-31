import { describe, expect, it } from 'vitest';
import { solveCircuit } from '../sweep';
import { nodeLimit, phaseLimit } from '../limits';
import type { CircuitResult } from '../model';
import type { Quantity } from '../quantity';
import { circuit, oneSpan, REF, SETTINGS, single, span, three, TOL, Z, zd, zmiss } from './references';

// E2 reference cases T1–T10 and N1–N5 on the sweep itself (synthetic parameters, design section 7).

const node = (r: CircuitResult, bus: string) => r.nodes.find((n) => n.bus === bus)!;
const sp = (r: CircuitResult, key: string) => r.spans.find((s) => s.key === key)!;
const v = (q: Quantity<number>) => { expect(q.status, JSON.stringify(q)).toMatch(/computed|provisional/); return q.value!; };
const near = (q: Quantity<number>, x: number, tol: number) => expect(Math.abs(v(q) - x), `${q.value} vs ${x}`).toBeLessThan(tol);

describe('T1–T10 (D1-LOC)', () => {
  it('T1 single-phase 1ph2w, 10 A on a', () => {
    const r = solveCircuit(circuit([span('S-B', 'S', 'B', { system: '1ph2w', phase: 'a', zp: zd(Z(1.2, 0.08, 100)), zn: zd(Z(1.2, 0.08, 100)) })], [single('u', 'B', 'a', 10)]), SETTINGS());
    near(node(r, 'B').dropV.a, REF.T1.dVa, TOL.V);
    expect(node(r, 'B').voltage.b.reason).toBe('phase-not-present');
    near(sp(r, 'S-B').pLossW, REF.T1.P, TOL.W);
    near(sp(r, 'S-B').qAbsorbedVar, REF.T1.Q, TOL.W);
    expect(r.solve.status).toBe('computed');
  });
  it('T2 balanced three-phase, 30 A, 200 m: closed form, IN = 0', () => {
    const r = solveCircuit(oneSpan(200, [three('u', 'B', 30)]), SETTINGS());
    for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.T2.dV, TOL.V);
    near(node(r, 'B').lineV.ab, REF.T2.Vab, TOL.V);
    // measured at the approved tolerance 1e-4 V (optional assertion, Q4)
    expect(r.solve.iterations).toBe(4);
    expect(sp(r, 'S-B').current.n.value!.magnitude).toBe(0);
    near(sp(r, 'S-B').pLossW, REF.T2.P, TOL.W);
    near(sp(r, 'S-B').qAbsorbedVar, REF.T2.Q, TOL.W);
    // F9 (approximate) is a cross-check only: 2.9092 V
    expect(Math.abs(node(r, 'B').dropV.a.value! - 30 * (0.1 * 0.9 + 0.016 * Math.sqrt(1 - 0.81)))).toBeLessThan(0.01);
  });
  it('T3 branched network', () => {
    const z = (L: number) => zd(Z(0.5, 0.08, L));
    const r = solveCircuit(circuit([
      span('S-A', 'S', 'A', { system: '3ph4w', zp: z(100), zn: z(100) }),
      span('A-B', 'A', 'B', { system: '3ph4w', zp: z(50), zn: z(50) }),
      span('A-C', 'A', 'C', { system: '3ph4w', zp: z(80), zn: z(80) }),
    ], [three('a', 'A', 5), three('b', 'B', 20), three('c', 'C', 10)]), SETTINGS());
    for (const b of ['A', 'B', 'C'] as const) near(node(r, b).dropV.a, REF.T3.dV[b], TOL.V);
    expect(Math.abs(sp(r, 'S-A').current.a.value!.magnitude - REF.T3.I_SA)).toBeLessThan(TOL.A);
    near(r.pLossW, REF.T3.P, TOL.W);
    near(r.qAbsorbedVar, REF.T3.Q, TOL.W);
  });
  it('T4a three 10 A single-phase loads on a, b, c: IN = 0 by symmetry', () => {
    const r = solveCircuit(oneSpan(100, [single('1', 'B', 'a', 10), single('2', 'B', 'b', 10), single('3', 'B', 'c', 10)]), SETTINGS());
    for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.T4a.dV, TOL.V);
    expect(sp(r, 'S-B').current.n.value!.magnitude).toBe(0);
    near(sp(r, 'S-B').pLossW, REF.T4a.P, TOL.W);
    near(sp(r, 'S-B').qAbsorbedVar, REF.T4a.Q, TOL.W);
  });
  it('T4b the same three on a', () => {
    const r = solveCircuit(oneSpan(100, [single('1', 'B', 'a', 10), single('2', 'B', 'a', 10), single('3', 'B', 'a', 10)]), SETTINGS());
    for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.T4b.dV[p], TOL.V);
    expect(Math.abs(sp(r, 'S-B').current.n.value!.magnitude - REF.T4b.IN)).toBeLessThan(TOL.A);
    near(sp(r, 'S-B').pLossW, REF.T4b.P, TOL.W);
    near(sp(r, 'S-B').qAbsorbedVar, REF.T4b.Q, TOL.W);
  });
  it('T5a R missing on the last span: |Irule| known, phasors and every voltage of the circuit not available', () => {
    const z = (L: number) => zd(Z(0.5, 0.08, L));
    const r = solveCircuit(circuit([
      span('S-A', 'S', 'A', { system: '3ph4w', zp: z(100), zn: z(100) }),
      span('A-B', 'A', 'B', { system: '3ph4w', zp: zmiss('impedance-missing'), zn: z(50) }),
    ], [three('a', 'A', 10), three('b', 'B', 30)]), SETTINGS());
    for (const b of ['A', 'B']) {
      expect(node(r, b).voltage.a.status).toBe('unavailable');
      expect(node(r, b).voltage.a.value).toBeUndefined();
      expect(node(r, b).voltage.a.reason).toBe('impedance-missing');
      expect(node(r, b).voltage.a.blockedBy).toContain('A-B');
    }
    expect(sp(r, 'S-A').current.a.reason).toBe('node-voltage-unknown');
    expect(sp(r, 'S-A').current.a.value).toBeUndefined();
    expect(sp(r, 'S-A').arithmeticSumA.a.value).toBe(40);
    expect(sp(r, 'S-A').arithmeticSumA.a.method).toBe('bound');
    expect(r.loads.find((l) => l.consumerId === 'b')!.currentA.a.value).toBe(30);
    expect(r.solve.status).toBe('not-run');
  });
  it('T5b X missing at pf = 1: not available (no exception for pf = 1)', () => {
    const r = solveCircuit(circuit([span('S-B', 'S', 'B', { system: '3ph4w', zp: zmiss('impedance-missing'), zn: zd(Z(0.5, 0.08, 200)) })], [three('u', 'B', 30)]), SETTINGS(1));
    expect(node(r, 'B').dropV.a.status).toBe('unavailable');
    expect(node(r, 'B').dropV.a.reason).toBe('impedance-missing');
  });
  it('T5c XN missing: T4a still computed (symmetric), T4b not available', () => {
    const a = solveCircuit(oneSpan(100, [single('1', 'B', 'a', 10), single('2', 'B', 'b', 10), single('3', 'B', 'c', 10)], 1, zmiss('neutral-impedance-missing')), SETTINGS());
    near(node(a, 'B').dropV.a, REF.T4a.dV, TOL.V);
    const b = solveCircuit(oneSpan(100, [single('1', 'B', 'a', 30)], 1, zmiss('neutral-impedance-missing')), SETTINGS());
    expect(node(b, 'B').dropV.a.reason).toBe('neutral-impedance-missing');
    expect(sp(b, 'S-B').current.n.value).toBeUndefined();
  });
  it('T5d a single-phase load with no phase: phase-allocation-missing; another circuit is not affected', () => {
    const r = solveCircuit(oneSpan(100, [single('u', 'B', undefined, 20)]), SETTINGS());
    expect(node(r, 'B').dropV.a.reason).toBe('phase-allocation-missing');
    expect(r.loads[0].currentA.a.status).toBe('unavailable');
    const other = solveCircuit(oneSpan(200, [three('v', 'B', 30)]), SETTINGS());
    near(node(other, 'B').dropV.a, REF.T2.dV, TOL.V);
  });
  it('T6 power factor 1.0 and 0.8', () => {
    near(node(solveCircuit(oneSpan(200, [three('u', 'B', 30)]), SETTINGS(1)), 'B').dropV.a, REF.T6.pf1, TOL.V);
    const r = solveCircuit(oneSpan(200, [three('u', 'B', 30)]), SETTINGS(0.8));
    near(node(r, 'B').dropV.a, REF.T6.pf08, TOL.V);
    near(r.pLossW, 270, TOL.W);
  });
  it('T7 400 m: not twice T2', () => {
    const r = solveCircuit(oneSpan(400, [three('u', 'B', 30)]), SETTINGS());
    near(node(r, 'B').dropV.a, REF.T7.dV, TOL.V);
    near(node(r, 'B').dropPercent.a, REF.T7.pct, 1e-3);
    expect(Math.abs(node(r, 'B').dropV.a.value! - 2 * REF.T2.dV)).toBeGreaterThan(1e-3);
    near(r.pLossW, REF.T7.P, TOL.W);
    near(r.qAbsorbedVar, REF.T7.Q, TOL.W);
    expect(node(r, 'B').limit).toBe('ok');
  });
  it('T8 limits of the default settings', () => {
    const s = SETTINGS();
    expect(phaseLimit(3.99, 225, s)).toBe('ok');
    expect(phaseLimit(4.0, 225, s)).toBe('near');
    expect(phaseLimit(5.0, 225, s)).toBe('near');
    expect(phaseLimit(5.01, 225, s)).toBe('over');
    expect(phaseLimit(1, 217.9, s)).toBe('over');
    expect(nodeLimit([{ percent: 1, vpn: 228 }, { percent: 1, vpn: 228 }], [379.9], s)).toBe('over');
    expect(nodeLimit([{ percent: 1, vpn: 228 }, undefined], [], s)).toBe('na');
  });
  it('T9 explicit unbalance a = 20 A, b = 10 A', () => {
    const r = solveCircuit(oneSpan(100, [single('1', 'B', 'a', 20), single('2', 'B', 'b', 10)]), SETTINGS());
    const IN = sp(r, 'S-B').current.n.value!;
    expect(Math.abs(IN.magnitude - REF.T9.IN)).toBeLessThan(TOL.A);
    expect(Math.abs(IN.angleDeg - REF.T9.INdeg)).toBeLessThan(TOL.deg);
    for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.T9.dV[p], TOL.V);
    near(r.pLossW, REF.T9.P, TOL.W);
    near(r.qAbsorbedVar, REF.T9.Q, TOL.W);
  });
  it('T10 constant power (T2 network)', () => {
    const r = solveCircuit(oneSpan(200, [three('u', 'B', 30)]), SETTINGS(0.9, 'constant-power'));
    expect(r.solve.converged).toBe(true);
    expect(r.solve.iterations).toBeLessThanOrEqual(100);
    // Q4: exactly 4 passes at the approved tolerance 1e-4 V (deltas 3.038, 4.065e-2, 5.508e-4, 7.467e-6 V)
    expect(r.solve.iterations).toBe(4);
    expect(Math.abs(v(node(r, 'B').dropV.a) - 2.9487198)).toBeLessThan(1e-5);
    expect(Math.abs(sp(r, 'S-B').current.a.value!.magnitude - REF.T10.I)).toBeLessThan(TOL.A);
    near(r.loads[0].currentA.a, REF.T10.I, TOL.A);
    near(node(r, 'B').dropV.a, REF.T10.dV, TOL.V);
    near(r.pLossW, REF.T10.P, TOL.W);
    near(r.qAbsorbedVar, REF.T10.Q, TOL.W);
  });
});

describe('N1–N5 neutral', () => {
  it('N1 load on a alone: IN = Ia (same angle, returning), ΔVa positive, b and c rise, neutral shift', () => {
    const r = solveCircuit(oneSpan(100, [single('u', 'B', 'a', 20)]), SETTINGS());
    const s = sp(r, 'S-B');
    expect(Math.abs(s.current.a.value!.magnitude - REF.N1.I)).toBeLessThan(TOL.A);
    expect(Math.abs(s.current.n.value!.magnitude - REF.N1.I)).toBeLessThan(TOL.A);
    expect(Math.abs(s.current.n.value!.angleDeg - s.current.a.value!.angleDeg)).toBeLessThan(1e-9);
    expect(Math.abs(s.current.a.value!.angleDeg - REF.N1.Ideg)).toBeLessThan(TOL.deg);
    for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.N1.dV[p], TOL.V);
    // the wrong sign (+ZN·IN) would give ΔVa = 0.0000 V: this value rules it out
    expect(node(r, 'B').dropV.a.value!).toBeGreaterThan(1.9);
    expect(Math.abs(node(r, 'B').neutralShiftV.value!.magnitude - REF.N1.shift)).toBeLessThan(TOL.V);
    near(s.pLossW, REF.N1.P, TOL.W);
    near(s.qAbsorbedVar, REF.N1.Q, TOL.W);
  });
  it('N2 loads on a and b', () => {
    const r = solveCircuit(oneSpan(100, [single('1', 'B', 'a', 20), single('2', 'B', 'b', 20)]), SETTINGS());
    const IN = sp(r, 'S-B').current.n.value!;
    expect(Math.abs(IN.magnitude - REF.N2.IN)).toBeLessThan(TOL.A);
    expect(Math.abs(IN.angleDeg - REF.N2.INdeg)).toBeLessThan(TOL.deg);
    for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.N2.dV[p], TOL.V);
    near(r.pLossW, REF.N2.P, TOL.W);
    near(r.qAbsorbedVar, REF.N2.Q, TOL.W);
  });
  it('N3 balanced on the three phases; with XN missing still computed', () => {
    const loads = () => [single('1', 'B', 'a', 20), single('2', 'B', 'b', 20), single('3', 'B', 'c', 20)];
    for (const zn of [undefined, zmiss('neutral-impedance-missing')]) {
      const r = solveCircuit(oneSpan(100, loads(), 1, zn), SETTINGS());
      for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.N3.dV, TOL.V);
      expect(sp(r, 'S-B').current.n.value!.magnitude).toBe(0);
      near(r.pLossW, REF.N3.P, TOL.W);
      near(r.qAbsorbedVar, REF.N3.Q, TOL.W);
    }
  });
  it('N4 two complete sets, 40 A on a: voltages of N1, 20 A per set, twice the losses', () => {
    const r = solveCircuit(oneSpan(100, [single('u', 'B', 'a', 40)], 2), SETTINGS());
    for (const p of ['a', 'b', 'c'] as const) near(node(r, 'B').dropV[p], REF.N1.dV[p], TOL.V);
    near(sp(r, 'S-B').perSetCurrentA.a, REF.N4.perSet, TOL.A);
    near(sp(r, 'S-B').perSetCurrentA.n, REF.N4.perSet, TOL.A);
    near(r.pLossW, REF.N4.P, TOL.W);
    near(r.qAbsorbedVar, REF.N4.Q, TOL.W);
    expect(sp(r, 'S-B').perSetCurrentA.a.assumptions).toContain('A8');
  });
  it('N5 two complete sets, balanced 60 A, 200 m = T2', () => {
    const r = solveCircuit(oneSpan(200, [three('u', 'B', 60)], 2), SETTINGS());
    near(node(r, 'B').dropV.a, REF.N5.dV, TOL.V);
    near(sp(r, 'S-B').perSetCurrentA.a, REF.N5.perSet, TOL.A);
    near(r.pLossW, REF.N5.P, TOL.W);
    near(r.qAbsorbedVar, REF.N5.Q, TOL.W);
  });
});

describe('E2 Phase 1 corrections (sweep)', () => {
  it('P3-1 an invalid parallel on a span without current: the nodes behind it are not-run (parallel-invalid)', () => {
    const c = circuit([
      span('S-A', 'S', 'A', { system: '3ph4w', zp: zd(Z(0.5, 0.08, 100)), zn: zd(Z(0.5, 0.08, 100)) }),
      span('A-B', 'A', 'B', { system: '3ph4w', zp: zmiss('parallel-invalid'), zn: zd(Z(0.5, 0.08, 100)) }),
    ], [three('u', 'A', 30)]);
    const r = solveCircuit(c, SETTINGS());
    expect(node(r, 'A').dropV.a.status).toBe('computed');
    for (const q of [node(r, 'B').dropV.a, node(r, 'B').voltage.a, node(r, 'B').lineV.ab, node(r, 'B').neutralShiftV, sp(r, 'A-B').dropV.a, sp(r, 'A-B').pLossW, sp(r, 'A-B').qAbsorbedVar]) {
      expect(q.status, JSON.stringify(q)).toBe('not-run');
      expect(q.reason).toBe('parallel-invalid');
      expect(q.blockedBy).toEqual(['A-B']);
      expect(q.value).toBeUndefined();
    }
    // a node further behind inherits the not-run state
    const deeper = solveCircuit(circuit([...c.spans, span('B-C', 'B', 'C', { system: '3ph4w', zp: zd(Z(0.5, 0.08, 50)), zn: zd(Z(0.5, 0.08, 50)) })], c.loads), SETTINGS());
    expect(node(deeper, 'C').dropV.a).toMatchObject({ status: 'not-run', reason: 'upstream-unavailable', blockedBy: ['A-B'] });
    // a missing (not invalid) impedance stays unavailable
    const missing = solveCircuit(circuit([c.spans[0], span('A-B', 'A', 'B', { system: '3ph4w', zp: zmiss('impedance-missing'), zn: zd(Z(0.5, 0.08, 100)) })], c.loads), SETTINGS());
    expect(node(missing, 'B').dropV.a).toMatchObject({ status: 'unavailable', reason: 'impedance-missing' });
  });
  it("C4(c)' an explicit documented 20 A on a, 200 m: computed, no default warning", () => {
    const r = solveCircuit(oneSpan(200, [single('u', 'B', 'a', 20)]), SETTINGS());
    expect(r.solve.status).toBe('computed');
    for (const p of ['a', 'b', 'c'] as const) {
      near(node(r, 'B').dropV[p], REF.C4c.dV[p], TOL.V);
      expect(node(r, 'B').dropV[p].status).toBe('computed');
      expect(node(r, 'B').dropV[p].warnings).toEqual([]);
    }
    expect(Math.abs(sp(r, 'S-B').current.n.value!.magnitude - REF.C4c.IN)).toBeLessThan(TOL.A);
    near(sp(r, 'S-B').pLossW, REF.C4c.P, TOL.W);
    near(sp(r, 'S-B').qAbsorbedVar, REF.C4c.Q, TOL.W);
  });
});
