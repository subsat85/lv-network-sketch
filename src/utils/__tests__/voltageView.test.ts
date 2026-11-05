import { describe, expect, it } from 'vitest';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { spanKey } from '../spanLength';
import type { CableElement, ConsumerElement, DrawingElement, ElectricalSettings, SpanProps, SymbolElement } from '../../types/drawing';
import { computeVoltageView } from './vdTestView';

// The voltage-drop view of the app (E2 only): what the panel, the drawing, the preview / PDF and
// the report show. The behaviour checks of the former engine, now on E2's result. ALL VALUES
// SYNTHETIC. Reference for one balanced span (closed form of E2's constant-current solution):
//   w = Z·I·e^{−jφ}, |V| = −Re w + √(Vph² − (Im w)²), ΔV = Vph − |V|.
const R = 0.38448, X = 0.08, PF = 0.9;
const closedDrop = (I: number, Lm: number, r = R, x = X, Vph = 230) => {
  const phi = Math.acos(PF), zr = r * Lm / 1000, zx = x * Lm / 1000;
  const wr = I * (zr * Math.cos(phi) + zx * Math.sin(phi)), wi = I * (zx * Math.cos(phi) - zr * Math.sin(phi));
  return Vph - (-wr + Math.sqrt(Vph * Vph - wi * wi));
};

const RED = '#ff0000', BLUE = '#0000ff';
const pole = (id: string, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string) => pole(id, { symbolId: 'transformer' });
const cable = (id: string, poleIds: string[], color = RED): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: color, fillColor: 'none', strokeWidth: 2 });
let k = 0;
const sub = (poleId: string, variant: 'circle' | 'square', count = 1, label = '', color = RED): ConsumerElement =>
  ({ id: `u${++k}`, type: 'consumer', x: 0, y: 0, poleId, color, count, variant, label, strokeColor: color, fillColor: color, strokeWidth: 2 });
const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, rOhmPerKm: R, xOhmPerKm: X, rNeutralOhmPerKm: R, system: '3ph4w', parallel: 1, dataSource: 'test' };
const SET: ElectricalSettings = { ...DEFAULT_ELECTRICAL, powerFactor: PF };
const withProps = (els: DrawingElement[], per: Record<string, Partial<SpanProps>> = {}, base: Omit<SpanProps, 'poles'> = AL95) =>
  normalizeElements(els).map((e) => {
    if (e.type !== 'cable') return e;
    let c = e;
    c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...base, ...(per[e.id] ?? {}), poles: [p, c.poleIds[i + 1]] }); });
    return c;
  });
const run = (els: DrawingElement[], d: Record<string, string>, s: ElectricalSettings = SET) => computeVoltageView(els, d, s);
const at = (r: ReturnType<typeof run>, p: string, i = 0) => r.byPole.get(p)![i];

describe('limits and status', () => {
  const longLine = (m: string, s: ElectricalSettings = SET) => run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '100')]), { A_T: m }, s);
  it('below 80 % of the limit: ok; from 80 %: near; above the limit: over (E2 values = the closed form)', () => {
    expect(at(longLine('200'), 'A').status).toBe('ok');
    expect(at(longLine('250'), 'A').status).toBe('near');
    expect(at(longLine('320'), 'A').status).toBe('over');
    expect(at(longLine('200'), 'A').dropV).toBeCloseTo(closedDrop(100, 200), 4);
    expect(at(longLine('200'), 'A').percent).toBeCloseTo(closedDrop(100, 200) / 230 * 100, 4);
  });
  it('the limit is a setting; the minimum voltages are checked as well', () => {
    expect(at(longLine('320', { ...SET, limitPercent: 6, minPhaseVoltage: 210, minLineVoltage: 370 }), 'A').status).toBe('near');
    // 300 m: about 4.98 % < 5.2 %, |Vpn| ≈ 218.6 V ≥ 218 V; E2's line voltage is |Vpn,a − Vpn,b| ≈ 378.6 V
    // (from the phasors, √3 × the phase voltage), under the 380 V minimum: over
    expect(at(longLine('300', { ...SET, limitPercent: 5.2 }), 'A').status).toBe('over');
    expect(at(longLine('300', { ...SET, limitPercent: 5.2 }), 'A').lineV).toBeCloseTo(Math.sqrt(3) * (230 - closedDrop(100, 300)), 3);
    expect(at(longLine('300', { ...SET, limitPercent: 5.2, minLineVoltage: 370 }), 'A').status).toBe('near');
    expect(at(longLine('300', { ...SET, limitPercent: 5.2, minLineVoltage: 370, minPhaseVoltage: 219 }), 'A').status).toBe('over');
  });
});

describe('nothing misleading is shown', () => {
  const base = () => [tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('B', 'square')];
  it('a missing length: that span and everything after it have no value, with the reason; never 0', () => {
    const r = run(withProps(base()), { A_T: '40' });
    expect(r.bySpan.get(spanKey('c', 1))!.reasons).toEqual(['length-missing']);
    expect(at(r, 'B')).toMatchObject({ status: 'na' });
    expect(at(r, 'B').percent).toBeUndefined();
    expect(at(r, 'B').dropV).toBeUndefined();
  });
  it('the drawing\'s placeholder distance (1 m or less) is not taken as a length', () => {
    const r = run(withProps(base()), { A_T: '1', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.reasons).toEqual(['length-suspect']);
    expect(at(r, 'B').status).toBe('na');
  });
  it('missing cable data: no value, the reason given (R and X are never assumed)', () => {
    const r = run(withProps(base(), {}, { system: '3ph4w', parallel: 1 }), { A_T: '40', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.reasons).toEqual(['impedance-missing']);
    expect(r.study.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['phase:resistance-missing', 'phase:reactance-missing']));
  });
  it('the neutral impedance is only needed when the neutral carries current', () => {
    const three = run(withProps(base()), { A_T: '40', A_B: '40' });
    expect(at(three, 'B').status).not.toBe('na');
    // a single-phase subscriber (Worst Case: on phase a) makes the neutral carry current: XN is not known
    const single = run(withProps([...base(), sub('B', 'circle')]), { A_T: '40', A_B: '40' });
    expect(single.bySpan.get(spanKey('c', 0))!.reasons).toContain('neutral-impedance-missing');
    expect(at(single, 'B').status).toBe('na');
  });
  it('a three-phase load behind a single-phase span is an error, not a number', () => {
    const r = run(withProps(base(), { c: { system: '1ph2w' } }), { A_T: '40', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.reasons).toContain('three-phase-on-single-phase');
  });
  it('no source / non-radial network: every pole has no value (the circuit is not calculated)', () => {
    const r = run(withProps([pole('A'), pole('B'), cable('c', ['A', 'B']), sub('B', 'square')]), { A_B: '40' });
    expect(at(r, 'A')).toMatchObject({ status: 'na', reason: 'circuit-not-computed' });
    expect(at(r, 'B')).toMatchObject({ status: 'na', reason: 'circuit-not-computed' });
    const loop = run(withProps([tr('T'), pole('A'), cable('p1', ['T', 'A']), cable('p2', ['T', 'A'])]), { A_T: '40' });
    expect(loop.circuits[0].status).toBe('non-radial');
    expect(at(loop, 'A').status).toBe('na');
  });
  it('a span marked for review is still calculated but provisional, and so is everything fed through it', () => {
    const els = withProps([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('B', 'square', 1, '63')]);
    const c = els.find((e) => e.id === 'c') as CableElement;
    const marked = els.map((e) => (e.id === 'c' ? withSpanProps(c, c.spanIds![0], { ...c.spanProps![c.spanIds![0]], review: ['split'] }) : e));
    const r = run(marked, { A_T: '100', A_B: '50' });
    expect(at(r, 'A')).toMatchObject({ provisional: true });
    expect(at(r, 'A').warnings).toContain('span-review');
    expect(at(r, 'B').provisional).toBe(true);
    expect(r.circuits[0].worstProvisional).toBe(true);
    expect(at(run(els, { A_T: '100', A_B: '50' }), 'B').provisional).toBe(false);
  });
  it('copied (inherited) properties that were not confirmed make the result provisional', () => {
    const els = withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '63')], { c: { inherited: true } });
    expect(at(run(els, { A_T: '100' }), 'A').warnings).toContain('span-inherited');
  });
  it('a −40 A label gives no value (not a negative drop "within the limit"); E2 does not calculate its circuit, another network still is', () => {
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '-40')]), { A_T: '100' });
    expect(at(r, 'A').status).toBe('na');
    expect(at(r, 'A').dropV).toBeUndefined();
    expect(r.bySpan.get(spanKey('c', 0))!.reasons).toContain('invalid-load');
    expect(r.issues.some((i) => i.kind === 'invalid-load')).toBe(true);
    const two = run(withProps([tr('T'), tr('T2'), pole('A'), pole('B'), cable('a', ['T', 'A']), cable('b', ['T2', 'B'], BLUE), sub('A', 'square', 1, '0'), sub('B', 'square', 1, '63', BLUE)]), { A_T: '100', B_T2: '100' });
    expect(at(two, 'A').status).toBe('na');
    expect(at(two, 'B').dropV).toBeCloseTo(closedDrop(63, 100), 4);
  });
});

describe('source, colours, branches', () => {
  it('choosing another pole as source changes the reference point (drops counted from it)', () => {
    const els = withProps([tr('T'), pole('A', { modifiers: { vdSource: true } }), pole('B'), cable('c', ['T', 'A', 'B']), sub('B', 'square')]);
    const r = run(els, { A_T: '40', A_B: '60' });
    expect(at(r, 'B').dropV).toBeCloseTo(closedDrop(32, 60), 4);
    expect(r.issues).toContainEqual({ kind: 'transformer-not-source', poleId: 'T' });
  });
  it('parallel cables of different colours on one route: each has its own properties and loads', () => {
    const els = withProps([tr('T'), pole('A'), cable('r', ['T', 'A']), cable('b', ['T', 'A'], BLUE), sub('A', 'square'), sub('A', 'square', 1, '', BLUE)], { b: { rOhmPerKm: 0.77, rNeutralOhmPerKm: 0.77 } });
    const r = run(els, { A_T: '100' });
    expect(r.byPole.get('A')!.find((p) => p.color === RED)!.dropV).toBeCloseTo(closedDrop(32, 100), 4);
    expect(r.byPole.get('A')!.find((p) => p.color === BLUE)!.dropV).toBeCloseTo(closedDrop(32, 100, 0.77), 4);
  });
  it('a pole shows its worst phase, a span its E2 currents (a, b, c, neutral) and its largest phase drop', () => {
    const els = withProps([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('A', 'square', 1, '20'), sub('B', 'square', 1, '10')]);
    const r = run(els, { A_T: '40', A_B: '60' });
    const s0 = r.bySpan.get(spanKey('c', 0))!;
    for (const p of ['a', 'b', 'c'] as const) expect(s0.currentA[p]).toBeCloseTo(30, 6);
    expect(s0.currentA.n).toBeLessThan(1e-9);
    expect(s0.computable).toBe(true);
    expect(s0.cumulativeDropV).toBeCloseTo(at(r, 'A').dropV!, 12);
    expect(['a', 'b', 'c']).toContain(at(r, 'B').phase);
    expect(r.circuits[0].maxPercent).toBeCloseTo(at(r, 'B').percent!, 12);
    expect(r.circuits[0].worstPoleId).toBe('B');
  });
});

describe('single-phase subscribers: the allocation method and the nominal load are those of the project', () => {
  const doc = (s: ElectricalSettings) => {
    const els = withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'circle', 3)]);
    return { els, s };
  };
  it('the method is shown with the results; Worst Case puts the three on one phase, Equal Phase Current one on each', () => {
    const w = run(doc(SET).els, { A_T: '100' }, { ...SET, singlePhaseMode: 'worst' });
    const b = run(doc(SET).els, { A_T: '100' }, { ...SET, singlePhaseMode: 'balanced' });
    // the default (and a project with no stored method): Equal Phase Current
    const { singlePhaseMode: _m, ...noMode } = SET;
    expect(run(doc(SET).els, { A_T: '100' }, noMode as ElectricalSettings).method).toBe('balanced');
    expect(w.method).toBe('worst');
    expect(b.method).toBe('balanced');
    // (the span's own fields have no XN: the neutral impedance is missing when the neutral carries current)
    expect(w.bySpan.get(spanKey('c', 0))!.reasons).toContain('neutral-impedance-missing');
    expect(b.bySpan.get(spanKey('c', 0))!.computable).toBe(true);
    for (const p of ['a', 'b', 'c'] as const) expect(b.bySpan.get(spanKey('c', 0))!.currentA[p]).toBeCloseTo(4, 9);
    expect(at(b, 'A').warnings).toContain('allocation-unverified');
    expect(at(b, 'A').provisional).toBe(true);
  });
  it('the nominal load setting changes the single-phase currents (no other factor)', () => {
    const b = run(doc(SET).els, { A_T: '100' }, { ...SET, singlePhaseMode: 'balanced', singlePhaseNominalA: 5 });
    for (const p of ['a', 'b', 'c'] as const) expect(b.bySpan.get(spanKey('c', 0))!.currentA[p]).toBeCloseTo(5, 9);
    expect(at(b, 'A').dropV).toBeCloseTo(closedDrop(5, 100), 4);
  });
});
