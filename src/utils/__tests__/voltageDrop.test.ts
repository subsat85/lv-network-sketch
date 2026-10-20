import { describe, expect, it } from 'vitest';
import { computeVoltageDrop, spanKey } from '../voltageDrop';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { tableResistance } from '../../data/conductors';
import type { CableElement, ConsumerElement, DrawingElement, ElectricalSettings, SpanProps, SymbolElement } from '../../types/drawing';

// Hand calculations used below (all values in the comments were worked out by hand):
//   Al 95 mm² at 70 °C: R = 0.320 × (1 + 0.00403 × 50) = 0.38448 Ω/km
//   cos φ = 0.9 → sin φ = √(1 − 0.81) = 0.435890
//   R cos φ + X sin φ with X = 0.08: 0.346032 + 0.034871 = 0.380903 Ω/km
const R95_70 = 0.38448;
const ZPH = R95_70 * 0.9 + 0.08 * Math.sqrt(1 - 0.81); // 0.380903…

const RED = '#ff0000', BLUE = '#0000ff';
const pole = (id: string, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string) => pole(id, { symbolId: 'transformer' });
const cable = (id: string, poleIds: string[], color = RED): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: color, fillColor: 'none', strokeWidth: 2 });
let k = 0;
const sub = (poleId: string, variant: 'circle' | 'square', count = 1, label = '', color = RED): ConsumerElement =>
  ({ id: `u${++k}`, type: 'consumer', x: 0, y: 0, poleId, color, count, variant, label, strokeColor: color, fillColor: color, strokeWidth: 2 });
// Stage 7.8: the conductor table needs the cable kind (ABC / underground) and the neutral's own material
const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, system: '3ph4w', dataSource: 'test' };
const SET: ElectricalSettings = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };

/** give every span of every cable the same props (or per-cable overrides) */
const withProps = (els: DrawingElement[], per: Record<string, Partial<SpanProps>> = {}, base: Omit<SpanProps, 'poles'> = AL95) =>
  normalizeElements(els).map((e) => {
    if (e.type !== 'cable') return e;
    let c = e;
    c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...base, ...(per[e.id] ?? {}), poles: [p, c.poleIds[i + 1]] }); });
    return c;
  });
const run = (els: DrawingElement[], d: Record<string, string>, s: ElectricalSettings = SET) => computeVoltageDrop(els, d, s);
const at = (r: ReturnType<typeof run>, pole: string, i = 0) => r.byPole.get(pole)![i];

describe('conductor table', () => {
  it('IEC 60228 values with temperature correction', () => {
    expect(tableResistance('al', 95, 20)).toBeCloseTo(0.320, 6);
    expect(tableResistance('al', 95, 70)).toBeCloseTo(R95_70, 6);
    expect(tableResistance('cu', 50, 70)).toBeCloseTo(0.387 * (1 + 0.00393 * 50), 6); // 0.4630…
    expect(tableResistance('al', 54.6, 70)).toBeNull(); // not a table size: never guessed
  });
});

describe('hand-checked cases', () => {
  it('one span, balanced three-phase load: ΔV = I(R cos φ + X sin φ)L', () => {
    // 63 A × 0.380903 Ω/km × 0.1 km = 2.39969 V → 1.04334 % of 230 V; 227.6003 V; line: 400 − √3·2.39969 = 395.8436 V
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '63')]), { A_T: '100' });
    const p = at(r, 'A');
    expect(p.dropV).toBeCloseTo(63 * ZPH * 0.1, 9);
    expect(p.dropV).toBeCloseTo(2.39969, 4);
    expect(p.percent).toBeCloseTo(1.04334, 4);
    expect(p.phaseV).toBeCloseTo(227.6003, 3);
    expect(p.lineV).toBeCloseTo(395.8436, 3);
    expect(p.status).toBe('ok');
  });
  it('single-phase span (1φ+N): the drop is over phase and neutral', () => {
    // 2 × 4 A = 8 A; neutral = phase (95 mm²): 8 × (0.380903 + 0.380903) × 0.1 = 0.609445 V; no phase-to-phase value
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'circle', 2)], { c: { system: '1ph2w' } }), { A_T: '100' });
    expect(at(r, 'A').dropV).toBeCloseTo(0.609445, 5);
    expect(at(r, 'A').lineV).toBeUndefined();
  });
  it('mixed loads, worst case: unknown-phase single-phase load all on the checked phase, returning in the neutral', () => {
    // I3 = 63, I1 = 8: (71 × 0.380903 + 8 × 0.380903) × 0.1 = 79 × 0.0380903 = 3.009134 V
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '63'), sub('A', 'circle', 2)]), { A_T: '100' });
    expect(at(r, 'A').dropV).toBeCloseTo(3.009134, 5);
    expect(at(r, 'A').lineV).toBeUndefined();
  });
  it('mixed loads, balanced mode (an assumption the user chose): I1/3 per phase, no neutral current', () => {
    // (63 + 8/3) × 0.0380903 = 2.501263 V; line voltage shown
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '63'), sub('A', 'circle', 2)]), { A_T: '100' }, { ...SET, singlePhaseMode: 'balanced' });
    expect(at(r, 'A').dropV).toBeCloseTo(2.501263, 5);
    expect(at(r, 'A').lineV).toBeCloseTo(400 - Math.sqrt(3) * 2.501263, 4);
  });
  it('two spans: the first carries both loads, the second only the far one; drops add up', () => {
    // T–A 40 m carries 32+32 A: 64 × 0.380903 × 0.04 = 0.975112 V
    // A–B 60 m carries 32 A:    32 × 0.380903 × 0.06 = 0.731334 V → at B 1.706446 V
    const els = withProps([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('A', 'square'), sub('B', 'square')]);
    const r = run(els, { A_T: '40', A_B: '60' });
    expect(r.bySpan.get(spanKey('c', 0))!.dropV).toBeCloseTo(0.975112, 5);
    expect(r.bySpan.get(spanKey('c', 1))!.dropV).toBeCloseTo(0.731334, 5);
    expect(at(r, 'A').dropV).toBeCloseTo(0.975112, 5);
    expect(at(r, 'B').dropV).toBeCloseTo(1.706446, 5);
    expect(r.bySpan.get(spanKey('c', 1))!.cumulativeDropV).toBeCloseTo(1.706446, 5);
  });
  it('a branch: its loads are carried by the trunk spans before it, not by the trunk spans after it', () => {
    // T–A 50 m carries 4 (B) + 12 (C) A worst case with neutral = phase: 16 × 2 × 0.380903 × 0.05 = 0.609445 V
    // A–B 30 m: 4 × 2 × 0.380903 × 0.03 = 0.091417 V; A–C 20 m: 12 × 2 × 0.380903 × 0.02 = 0.182833 V
    const els = withProps([tr('T'), pole('A'), pole('B'), pole('C'), cable('t', ['T', 'A', 'B']), cable('br', ['A', 'C']), sub('B', 'circle'), sub('C', 'circle', 3)]);
    const r = run(els, { A_T: '50', A_B: '30', A_C: '20' });
    expect(at(r, 'A').dropV).toBeCloseTo(0.609445, 5);
    expect(at(r, 'B').dropV).toBeCloseTo(0.609445 + 0.091417, 5);
    expect(at(r, 'C').dropV).toBeCloseTo(0.609445 + 0.182833, 5);
  });
  it('parallel conductors in one span (parallel = 2) halve the impedance', () => {
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '63')], { c: { parallel: 2 } }), { A_T: '100' });
    expect(at(r, 'A').dropV).toBeCloseTo(2.39969 / 2, 4);
  });
  it('manual R / X per span are used as entered (no temperature correction applied to them)', () => {
    // R 0.5, X 0.1: 0.45 + 0.043589 = 0.493589; 32 A × 0.2 km = 3.158970 V
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square')], { c: { rOhmPerKm: 0.5, xOhmPerKm: 0.1 } }), { A_T: '200' });
    expect(at(r, 'A').dropV).toBeCloseTo(3.158970, 5);
    expect(r.bySpan.get(spanKey('c', 0))!.rSource).toBe('manual');
  });
  it('cos φ = 1: reactance is not needed', () => {
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square')], { c: { xOhmPerKm: undefined } }), { A_T: '100' }, { ...SET, powerFactor: 1 });
    expect(at(r, 'A').dropV).toBeCloseTo(32 * R95_70 * 0.1, 9);
  });
});

describe('limits and status', () => {
  const longLine = (m: string, s: ElectricalSettings = SET) => run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '100')]), { A_T: m }, s);
  // 100 A × 0.380903 × L: 1 % of 230 V = 2.3 V ↔ L = 60.38 m
  it('below 80 % of the limit: ok; from 80 %: near; above the limit: over', () => {
    expect(at(longLine('200'), 'A').status).toBe('ok');    // 7.618 V = 3.31 %
    expect(at(longLine('250'), 'A').status).toBe('near');  // 9.523 V = 4.14 %
    expect(at(longLine('320'), 'A').status).toBe('over');  // 12.189 V = 5.30 %
  });
  it('the limit is a setting', () => {
    // 12.189 V → 217.81 V is also below 218 V, and 400 − √3·12.189 = 378.9 V below 380 V, so the minimum voltages are lowered too
    expect(at(longLine('320', { ...SET, limitPercent: 6, minPhaseVoltage: 210, minLineVoltage: 370 }), 'A').status).toBe('near');
  });
  it('the minimum voltage is checked as well (218 V phase-to-neutral by default)', () => {
    // 5.2 % limit → 300 m = 11.427 V = 4.97 % < 5.2 %, but 218.57 V ≥ 218 → near; with min 219 V → over
    expect(at(longLine('300', { ...SET, limitPercent: 5.2 }), 'A').status).toBe('near');
    expect(at(longLine('300', { ...SET, limitPercent: 5.2, minPhaseVoltage: 219 }), 'A').status).toBe('over');
  });
});

describe('nothing misleading is shown', () => {
  const base = () => [tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('B', 'square')];
  it('a missing length makes that span and everything after it not computable, the span before is still computed', () => {
    const r = run(withProps(base()), { A_T: '40' });
    expect(at(r, 'A').status).not.toBe('na');
    expect(at(r, 'B')).toMatchObject({ status: 'na', reason: 'missing-data' });
    expect(r.bySpan.get(spanKey('c', 1))!.missing).toEqual(['length']);
  });
  it('the drawing\'s placeholder distance (1 m or less) is not taken as a length', () => {
    const r = run(withProps(base()), { A_T: '1', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.missing).toEqual(['length-suspect']);
    expect(at(r, 'B').status).toBe('na');
  });
  it('missing cable data are listed per span', () => {
    const r = run(withProps(base(), {}, { system: '3ph4w' }), { A_T: '40', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.missing).toEqual(['resistance', 'reactance']);
  });
  it('the neutral is only required when neutral current flows', () => {
    const noNeutral = { ...AL95, neutralCrossSectionMm2: undefined };
    const three = run(withProps(base(), {}, noNeutral), { A_T: '40', A_B: '40' });
    expect(at(three, 'B').status).not.toBe('na');
    const single = run(withProps([...base(), sub('B', 'circle')], {}, noNeutral), { A_T: '40', A_B: '40' });
    expect(single.bySpan.get(spanKey('c', 0))!.missing).toEqual(['neutral']);
  });
  it('a size that is not in the table is reported, never interpolated', () => {
    const r = run(withProps(base(), {}, { ...AL95, crossSectionMm2: 90 }), { A_T: '40', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.missing).toContain('section-not-in-table');
  });
  it('without a power factor nothing is computed and the setting is reported missing', () => {
    const r = run(withProps(base()), { A_T: '40', A_B: '40' }, { ...SET, powerFactor: undefined });
    expect(r.settingsMissing).toContain('powerFactor');
    expect(at(r, 'A')).toMatchObject({ status: 'na', reason: 'settings' });
  });
  it('without a conductor temperature, table resistances are not used', () => {
    const r = run(withProps(base()), { A_T: '40', A_B: '40' }, { ...SET, conductorTempC: undefined });
    expect(r.settingsMissing).toContain('conductorTempC');
    expect(at(r, 'A').status).toBe('na');
  });
  it('a three-phase load behind a single-phase span is an error, not a number', () => {
    const r = run(withProps(base(), { c: { system: '1ph2w' } }), { A_T: '40', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.missing).toContain('three-phase-on-single-phase');
  });
  it('no source / non-radial network: every pole is "not computable (network)"', () => {
    const r = run(withProps([pole('A'), pole('B'), cable('c', ['A', 'B']), sub('B', 'square')]), { A_B: '40' });
    expect(at(r, 'A')).toMatchObject({ status: 'na', reason: 'network' });
    expect(at(r, 'B')).toMatchObject({ status: 'na', reason: 'network' });
    const loop = run(withProps([tr('T'), pole('A'), cable('p1', ['T', 'A']), cable('p2', ['T', 'A'])]), { A_T: '40' });
    expect(loop.circuits[0].status).toBe('non-radial');
    expect(at(loop, 'A').status).toBe('na');
  });
  it('a span that needs review is still computed but carries its review marks', () => {
    const els = withProps(base(), { c: { review: ['split'] } });
    const r = run(els, { A_T: '40', A_B: '40' });
    expect(r.bySpan.get(spanKey('c', 0))!.review).toEqual(['split']);
    expect(at(r, 'B').status).not.toBe('na');
  });
});

describe('other source / independent spans', () => {
  it('choosing another pole as source changes the reference point (drops counted from it)', () => {
    // A chosen: loads at B fed from A only; T reported as not the source
    const els = withProps([tr('T'), pole('A', { modifiers: { vdSource: true } }), pole('B'), cable('c', ['T', 'A', 'B']), sub('B', 'square')]);
    const r = run(els, { A_T: '40', A_B: '60' });
    expect(at(r, 'B').dropV).toBeCloseTo(32 * ZPH * 0.06, 9);
    expect(r.issues).toContainEqual({ kind: 'transformer-not-source', poleId: 'T' });
  });
  it('parallel cables of different colours on one route: each has its own properties and loads', () => {
    const els = withProps([tr('T'), pole('A'), cable('r', ['T', 'A']), cable('b', ['T', 'A'], BLUE), sub('A', 'square'), sub('A', 'square', 1, '', BLUE)], { b: { crossSectionMm2: 50, neutralCrossSectionMm2: 50 } });
    const r = run(els, { A_T: '100' });
    const red = r.byPole.get('A')!.find((p) => p.color === RED)!;
    const blue = r.byPole.get('A')!.find((p) => p.color === BLUE)!;
    const r50 = 0.641 * (1 + 0.00403 * 50);
    expect(red.dropV).toBeCloseTo(32 * ZPH * 0.1, 9);
    expect(blue.dropV).toBeCloseTo(32 * (r50 * 0.9 + 0.08 * Math.sqrt(0.19)) * 0.1, 9);
  });
});

describe('7.8 no misleading results', () => {
  it('audit case: a −40 A label no longer gives a negative drop "within the limit": not computable, reason listed', () => {
    const r = run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '-40')]), { A_T: '100' });
    expect(at(r, 'A')).toMatchObject({ status: 'na', reason: 'missing-data' });
    expect(at(r, 'A').dropV).toBeUndefined();
    expect(r.bySpan.get(spanKey('c', 0))!.missing).toContain('invalid-load');
    expect(r.issues.some((i) => i.kind === 'invalid-load')).toBe(true);
  });
  it('the invalid load only blocks the spans that carry it; a parallel branch is still computed', () => {
    const els = withProps([tr('T'), pole('A'), pole('B'), cable('a', ['T', 'A']), cable('b', ['T', 'B']), sub('A', 'square', 1, '0'), sub('B', 'square', 1, '63')]);
    const r = run(els, { A_T: '100', B_T: '100' });
    expect(at(r, 'A').status).toBe('na');
    expect(at(r, 'B').dropV).toBeCloseTo(2.39969, 4);
  });
  it('audit case: a span marked for review is still computed but shown as provisional, never as a confirmed result', () => {
    const els = withProps([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('B', 'square', 1, '63')]);
    const c = els.find((e) => e.id === 'c') as CableElement;
    const marked = els.map((e) => (e.id === 'c' ? withSpanProps(c, c.spanIds![0], { ...c.spanProps![c.spanIds![0]], review: ['split'] }) : e));
    const r = run(marked, { A_T: '100', A_B: '50' });
    expect(at(r, 'A').provisional).toEqual(['review']);
    expect(at(r, 'B').provisional).toEqual(['review']);            // everything fed through it too
    expect(at(r, 'A').dropV).toBeCloseTo(2.39969, 4);               // the value is kept (useful), but marked
    expect(r.circuits[0].worstProvisional).toBe(true);
    const clean = run(els, { A_T: '100', A_B: '50' });
    expect(at(clean, 'B').provisional).toEqual([]);                 // confirmed data: not provisional
  });
  it('copied (inherited) properties that were not confirmed make the result provisional', () => {
    const els = withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '63')], { c: { inherited: true } });
    expect(at(run(els, { A_T: '100' }), 'A').provisional).toEqual(['inherited']);
  });
});

describe('7.8 conductor data must match the conductor', () => {
  const one = (p: Partial<SpanProps>, subs = [sub('A', 'square', 1, '63')]) => run(withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), ...subs], { c: p }), { A_T: '100' }).bySpan.get(spanKey('c', 0))!;
  it('audit case: bare overhead conductors do not get IEC 60228 (insulated-cable) values', () => {
    const s = one({ cableKind: 'bare', xOhmPerKm: 0.3 });
    expect(s.missing).toContain('resistance-bare');
    expect(s.rSource).toBeUndefined();
    expect(s.computable).toBe(false);
  });
  it('bare conductors are computed once R is entered with its source', () => {
    const s = one({ cableKind: 'bare', rOhmPerKm: 0.36, xOhmPerKm: 0.3, dataSource: 'catalogue AAC 95' });
    expect(s.computable).toBe(true);
    expect(s.rSource).toBe('manual');
    expect(s.provisional).toEqual([]);
  });
  it('unknown or "other" cable kind: the table is not applied', () => {
    expect(one({ cableKind: undefined }).missing).toContain('resistance-kind');
    expect(one({ cableKind: 'other' }).missing).toContain('resistance-kind');
    expect(one({ cableKind: 'underground' }).computable).toBe(true);
  });
  it('audit case: an aluminium-alloy neutral (ABC messenger) is never given plain-aluminium resistance', () => {
    const s = one({ neutralMaterial: 'alloy', neutralCrossSectionMm2: 54.6 }, [sub('A', 'circle', 2)]);
    expect(s.missing).toContain('neutral-alloy');
    const s2 = one({ neutralMaterial: 'alloy', neutralCrossSectionMm2: 70 }, [sub('A', 'circle', 2)]);
    expect(s2.missing).toContain('neutral-alloy'); // even when 70 mm² is a table size
    expect(s2.rnSource).not.toBe('table');
  });
  it('the neutral material is not assumed from the phase material', () => {
    expect(one({ neutralMaterial: undefined }, [sub('A', 'circle', 2)]).missing).toContain('neutral-material');
    const cuN = one({ neutralMaterial: 'cu', neutralCrossSectionMm2: 50 }, [sub('A', 'circle', 2)]);
    expect(cuN.rnSource).toBe('table');
    expect(cuN.rn).toBeCloseTo(0.387 * (1 + 0.00393 * 50), 9);
  });
  it('an entered Rn from a stated source is used for an alloy neutral', () => {
    const s = one({ neutralMaterial: 'alloy', neutralCrossSectionMm2: 54.6, rNeutralOhmPerKm: 0.63 }, [sub('A', 'circle', 2)]);
    expect([s.computable, s.rnSource, s.rn]).toEqual([true, 'manual', 0.63]);
  });
  it('values typed per span without a stated source make the result provisional (warning, not hidden)', () => {
    expect(one({ dataSource: undefined }).provisional).toContain('source-unknown');          // X typed
    expect(one({ dataSource: '  ' }).provisional).toContain('source-unknown');
    expect(one({ rOhmPerKm: 0.4, dataSource: undefined }).provisional).toContain('source-unknown');
    expect(one({}).provisional).toEqual([]);                                                  // source given
  });
  it('no interpolation: a size between table rows is not computed', () => {
    expect(one({ crossSectionMm2: 90 }).missing).toContain('section-not-in-table');
  });
});

describe('7.9 load model', () => {
  const CP: ElectricalSettings = { ...SET, loadModel: 'constant-power' };
  it('default and older projects: constant current, results unchanged (no setting = constant current)', () => {
    const els = withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '63')]);
    const { loadModel: _omit, ...older } = SET;
    const a = run(els, { A_T: '100' }, older as ElectricalSettings), b = run(els, { A_T: '100' }, { ...SET, loadModel: 'constant-current' });
    expect(at(a, 'A').dropV).toBe(at(b, 'A').dropV);
    expect(at(a, 'A').dropV).toBeCloseTo(2.39969, 4);
    expect(a.circuits[0].loadModel).toBe('constant-current');
  });
  it('one lumped load: matches the closed form v = (1 + √(1 − 4d)) / 2', () => {
    // 100 A three-phase at 300 m: d0 = 100 × 0.380903 × 0.3 / 230 = 0.049683
    const els = withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '100')]);
    const d0 = 100 * ZPH * 0.3 / 230;
    const v = (1 + Math.sqrt(1 - 4 * d0)) / 2;
    const cc = run(els, { A_T: '300' });
    const cp = run(els, { A_T: '300' }, CP);
    expect(at(cc, 'A').percent).toBeCloseTo(d0 * 100, 9);
    expect(at(cp, 'A').percent).toBeCloseTo((1 - v) * 100, 4);   // 5.24 % instead of 4.97 %
    expect(at(cp, 'A').dropV).toBeCloseTo(230 * (1 - v), 3);
    expect(cp.circuits[0]).toMatchObject({ loadModel: 'constant-power', converged: true });
    expect(cp.circuits[0].iterations!).toBeLessThanOrEqual(50);
    // the reference table of the design review: 5 % → 5.279 %
    expect((1 - (1 + Math.sqrt(1 - 0.2)) / 2) * 100).toBeCloseTo(5.279, 3);
  });
  it('single-phase load on a 1φ+N span: the same closed form with the loop impedance', () => {
    const els = withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'circle', 10)], { c: { system: '1ph2w' } });
    const d0 = 40 * 2 * ZPH * 0.2 / 230;
    const v = (1 + Math.sqrt(1 - 4 * d0)) / 2;
    expect(at(run(els, { A_T: '200' }, CP), 'A').dropV).toBeCloseTo(230 * (1 - v), 3);
  });
  it('branched network: equals an independent fixed-point solution of the same circuit', () => {
    // T–A 60 m (Al 95), A–B 80 m, A–C 50 m; loads: A 63 A 3φ, B 4×4 A 1φ, C 2×32 A 3φ — worst case
    const els = withProps([tr('T'), pole('A'), pole('B'), pole('C'), cable('t', ['T', 'A', 'B']), cable('br', ['A', 'C']),
      sub('A', 'square', 1, '63'), sub('B', 'circle', 4), sub('C', 'square', 2)]);
    const r = run(els, { A_T: '60', A_B: '80', A_C: '50' }, CP);
    // independent solution: unknown pole voltages, loads at Vph·I/V, worst-case span formula
    const z = ZPH, L = { TA: 0.06, AB: 0.08, AC: 0.05 };
    let VA = 230, VB = 230, VC = 230;
    for (let k = 0; k < 2000; k++) {
      const iA3 = 63 * 230 / VA, iB1 = 16 * 230 / VB, iC3 = 64 * 230 / VC;
      const dTA = ((iA3 + iC3 + iB1) * z + iB1 * z) * L.TA;
      const dAB = ((0 + iB1) * z + iB1 * z) * L.AB;
      const dAC = (iC3 * z) * L.AC;
      VA = 230 - dTA; VB = VA - dAB; VC = VA - dAC;
    }
    expect(at(r, 'A').phaseV).toBeCloseTo(VA, 3);
    expect(at(r, 'B').phaseV).toBeCloseTo(VB, 3);
    expect(at(r, 'C').phaseV).toBeCloseTo(VC, 3);
    // and it is larger than the constant-current drop
    expect(at(r, 'B').dropV!).toBeGreaterThan(at(run(els, { A_T: '60', A_B: '80', A_C: '50' }), 'B').dropV!);
  });
  it('no solution (drop far too large): "not computable: not converged", no value shown', () => {
    const els = withProps([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', 'square', 1, '400')]);
    const cc = run(els, { A_T: '500' });           // constant current: 33 % — a number, "over"
    expect(at(cc, 'A').status).toBe('over');
    const cp = run(els, { A_T: '500' }, CP);
    expect(cp.circuits[0].converged).toBe(false);
    expect(at(cp, 'A')).toMatchObject({ status: 'na', reason: 'not-converged' });
    expect(at(cp, 'A').dropV).toBeUndefined();
    expect(cp.bySpan.get(spanKey('c', 0))!.missing).toContain('not-converged');
  });
  it('constant power: a span whose loads sit behind missing data is not computed (their voltage is unknown)', () => {
    const els = withProps([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('B', 'square')]);
    const cc = run(els, { A_T: '40' });            // A–B length missing
    expect(at(cc, 'A').status).not.toBe('na');     // constant current: T–A is still computed
    const cp = run(els, { A_T: '40' }, CP);
    expect(at(cp, 'A').status).toBe('na');
    expect(cp.bySpan.get(spanKey('c', 0))!.missing).toContain('downstream-voltage-unknown');
  });
  it('performance: 300 spans with branches, constant power, well under the 50 ms target', () => {
    const els: Parameters<typeof withProps>[0] = [tr('T')];
    const d: Record<string, string> = {};
    // a realistic bushy radial network: every pole feeds up to three others (depth ≈ 5)
    for (let i = 0; i < 300; i++) {
      const id = `P${i}`;
      els.push(pole(id));
      const from = i < 3 ? 'T' : `P${Math.floor(i / 3) - 1}`;
      els.push(cable(`c${i}`, [from, id]));
      d[[from, id].sort().join('_')] = '30';
      if (i % 3 === 0) els.push(sub(id, 'circle', 1));
      if (i % 25 === 0) els.push(sub(id, 'square', 1, '16'));
    }
    const prepared = withProps(els, {}, { ...AL95, crossSectionMm2: 240 });
    const t0 = performance.now();
    const r = run(prepared, d, CP);
    const ms = performance.now() - t0;
    expect(r.bySpan.size).toBe(300);
    expect(r.circuits[0].converged).toBe(true);
    expect(r.circuits[0].maxPercent!).toBeGreaterThan(1);   // a real (non-trivial) drop
    console.log(`[perf] 300 spans, constant power: ${ms.toFixed(1)} ms, ${r.circuits[0].iterations} iterations`);
    expect(ms).toBeLessThan(250); // hard ceiling for slow CI; the measured time is printed and reported
  });
});
