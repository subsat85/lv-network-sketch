import { beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import { defaultSpanValues, fillMissingSpanDefaults, planMissingDefaults } from '../spanDefaults';
import { DEFAULT_ELECTRICAL, DEFAULT_POWER_FACTOR, effectiveSettings, isPowerFactorDefault, readElectricalSettings } from '../electricalSettings';
import { spanAt, withSpanProps } from '../spanModel';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { computeVoltageDrop } from '../voltageDrop';
import { COMPANY_RX_OHM_PER_KM } from '../../data/conductors';
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';

// Stage 7.13 — default values for old drawings: filled only on request, existing values kept,
// cos φ 0.9 when none is stored (calculation only), the «افتراضي — يحتاج مراجعة» mark.

const S = () => useDrawingStore.getState();
const initial = S();
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
const pole = (id: string, x: number, symbolId = 'lv-pole'): SymbolElement => ({ id, type: 'symbol', symbolId, x, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[]): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 });
const consumer = (id: string, poleId: string, count = 4): ConsumerElement => ({ id, type: 'consumer', x: 0, y: 0, poleId, color: '#ff0000', count, variant: 'circle', label: '', strokeColor: '#ff0000', fillColor: '#ff0000', strokeWidth: 2 });
const cableOf = (id: string) => S().elements.find((e) => e.id === id) as CableElement;
const propsAt = (id: string, i: number) => spanAt(cableOf(id), i).props;
const doc = () => JSON.stringify({ e: S().elements, d: S().connectionDistances, f: S().distanceFlags, el: S().electrical });
const STYLE = { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
const fileOf = (elements: DrawingElement[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', elements, connectionDistances: { A_T: '100', A_B: '80' }, connectionLabelOffsets: {}, ...extra });
const open = (json: string) => { const p = parseProjectFile(json); if (!p.ok) throw new Error('rejected'); S().loadProject(p.data as Parameters<typeof initial.loadProject>[0]); historyGestureEnd(); return p.data; };
// what the panel button does: the plan, applied in one undo step
const applyDefaults = () => { const plan = planMissingDefaults(S().elements); S().saveHistory(); S().updateElements(plan.updates); S().saveHistory(); return plan; };
const vd = () => computeVoltageDrop(S().elements, S().connectionDistances, effectiveSettings(S().electrical), S().distanceFlags);
const FULL = { ...defaultSpanValues(), review: ['defaults'] };

const OLD = () => fileOf([pole('T', 0, 'transformer'), pole('A', 300), pole('B', 600), cable('main', ['T', 'A', 'B']), consumer('u', 'B')]);
const MODERN_PROPS: SpanProps = { poles: ['T', 'A'], system: '3ph4w', cableKind: 'abc', material: 'cu', crossSectionMm2: 70, neutralMaterial: 'cu', neutralCrossSectionMm2: 70, parallel: 2, rOhmPerKm: 0.32, xOhmPerKm: 0.095, rNeutralOhmPerKm: 0.32, dataSource: 'تقرير' };

describe('old drawing without cable properties', () => {
  it('opening it changes nothing: no properties added, no power factor stored, draft = the file', () => {
    const data = open(OLD());
    expect(cableOf('main').spanProps).toBeUndefined();
    expect(S().electrical.powerFactor).toBeUndefined();
    const draft = buildDraft(S());
    expect(draft.data.electrical).toEqual(DEFAULT_ELECTRICAL);
    expect((draft.data.elements.find((e) => e.id === 'main') as CableElement).spanProps).toBeUndefined();
    expect(JSON.stringify(data.elements)).toBe(JSON.stringify(S().elements)); // what was read is what is held
  });
  it('the panel counts the spans; filling gives every span the full defaults + «defaults» review, in ONE undo step', () => {
    open(OLD());
    const before = doc(); const h = S().history.length;
    const plan = applyDefaults();
    expect([plan.empty, plan.partial]).toEqual([2, 0]);
    expect(propsAt('main', 0)).toEqual({ poles: ['T', 'A'], ...FULL });
    expect(propsAt('main', 1)).toEqual({ poles: ['A', 'B'], ...FULL });
    expect(S().history.length).toBe(h + 1);
    S().undo(); expect(doc()).toBe(before);
    S().redo(); expect(propsAt('main', 1)).toEqual({ poles: ['A', 'B'], ...FULL });
    expect(planMissingDefaults(S().elements).updates).toEqual([]); // nothing left to fill
  });
  it('the filled spans are computed (cos φ 0.9 by default) and shown as provisional because of the review mark', () => {
    open(OLD());
    S().updateElectricalSettings({ conductorTempC: undefined }); S().commitHistory();
    expect(vd().settingsMissing).toEqual([]); // cos φ is not missing any more (default)
    expect([...vd().byPole.values()].flat().every((p) => p.status === 'na')).toBe(true); // nothing to compute before filling
    applyDefaults();
    const b = vd().byPole.get('B')![0];
    expect(b.status).not.toBe('na');
    expect(b.provisional).toContain('review');
  });
});

describe('modern drawing with all properties', () => {
  const modern = () => {
    const els = [pole('T', 0, 'transformer'), pole('A', 300), cable('c', ['T', 'A']), consumer('u', 'A')];
    S().loadProject({ elements: els, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: { A_T: '100' }, connectionLabelOffsets: {}, electrical: { powerFactor: 0.85, conductorTempC: 70 } });
    S().updateElement('c', withSpanProps(cableOf('c'), cableOf('c').spanIds![0], MODERN_PROPS)); S().commitHistory(); historyGestureEnd();
  };
  it('nothing to fill: the plan is empty, the spans and results stay exactly the same', () => {
    modern();
    const before = doc(); const r0 = JSON.stringify(vd().bySpan.get('c#0') ?? [...vd().bySpan.values()][0]);
    const plan = applyDefaults();
    expect([plan.empty, plan.partial, plan.updates.length]).toEqual([0, 0, 0]);
    expect(doc()).toBe(before);
    expect(JSON.stringify(vd().bySpan.get('c#0') ?? [...vd().bySpan.values()][0])).toBe(r0);
    expect(propsAt('c', 0)).toEqual(MODERN_PROPS);
  });
  it('a saved power factor is used as it is (0.85, not the default)', () => {
    modern();
    expect(isPowerFactorDefault(S().electrical)).toBe(false);
    expect(effectiveSettings(S().electrical).powerFactor).toBe(0.85);
    expect(vd().settings.powerFactor).toBe(0.85);
  });
});

describe('drawing with some properties only: every existing value is kept', () => {
  const P = (x: Partial<SpanProps>): SpanProps => ({ poles: ['A', 'B'], ...x });
  it('only a single-phase system given → the system stays 1φ+N; the rest is filled', () => {
    const f = fillMissingSpanDefaults(P({ system: '1ph2w' }), ['A', 'B'])!;
    expect(f.system).toBe('1ph2w');
    expect(f).toMatchObject({ cableKind: 'abc', material: 'al', crossSectionMm2: 120, rOhmPerKm: 0.2415, xOhmPerKm: 0.0716, neutralMaterial: 'al', neutralCrossSectionMm2: 70, rNeutralOhmPerKm: 0.4126, parallel: 1, dataSource: 'كتالوج', review: ['defaults'] });
  });
  it('Al 95 with X but no R (calculated with IEC): section, material and X kept, R NOT filled (result basis unchanged)', () => {
    const p = P({ material: 'al', crossSectionMm2: 95, xOhmPerKm: 0.08, cableKind: 'abc', system: '3ph4w', neutralMaterial: 'al', neutralCrossSectionMm2: 95, dataSource: 'تقرير' });
    const f = fillMissingSpanDefaults(p, ['A', 'B'])!;
    expect(f).toEqual({ ...p, parallel: 1, review: ['defaults'] });
    expect(f.rOhmPerKm).toBeUndefined();
    expect(f.rNeutralOhmPerKm).toBeUndefined();
  });
  it('only the material given (Cu) → the section is not guessed, and no R / X are filled', () => {
    const f = fillMissingSpanDefaults(P({ material: 'cu' }), ['A', 'B'])!;
    expect([f.material, f.crossSectionMm2, f.rOhmPerKm, f.xOhmPerKm]).toEqual(['cu', undefined, undefined, undefined]);
    expect(f.system).toBe('3ph4w');
  });
  it('Al 120 with a typed R 0.3 and no X → R kept, X from the table', () => {
    const f = fillMissingSpanDefaults(P({ material: 'al', crossSectionMm2: 120, rOhmPerKm: 0.3 }), ['A', 'B'])!;
    expect([f.rOhmPerKm, f.xOhmPerKm]).toEqual([0.3, 0.0716]);
  });
  it('Cu 35 with nothing else → R and X of Cu 35 from the table (the span’s own section)', () => {
    const f = fillMissingSpanDefaults(P({ material: 'cu', crossSectionMm2: 35 }), ['A', 'B'])!;
    expect([f.rOhmPerKm, f.xOhmPerKm]).toEqual([COMPANY_RX_OHM_PER_KM.cu[35].r, COMPANY_RX_OHM_PER_KM.cu[35].x]);
  });
  it('a size that is not in the company table → no R / X invented', () => {
    const f = fillMissingSpanDefaults(P({ material: 'al', crossSectionMm2: 50 }), ['A', 'B'])!;
    expect([f.rOhmPerKm, f.xOhmPerKm]).toEqual([undefined, undefined]);
  });
  it('a given neutral is never changed: alloy neutral without Rn stays without Rn; a typed Rn stays', () => {
    const alloy = fillMissingSpanDefaults(P({ neutralMaterial: 'alloy', neutralCrossSectionMm2: 70 }), ['A', 'B'])!;
    expect([alloy.neutralMaterial, alloy.neutralCrossSectionMm2, alloy.rNeutralOhmPerKm]).toEqual(['alloy', 70, undefined]);
    expect(fillMissingSpanDefaults(P({ neutralMaterial: 'al', neutralCrossSectionMm2: 35, rNeutralOhmPerKm: 0.9 }), ['A', 'B'])!).toMatchObject({ neutralMaterial: 'al', neutralCrossSectionMm2: 35, rNeutralOhmPerKm: 0.9 });
  });
  it('a complete span gets nothing (null), a feature/vd span is left for its own review, an existing review mark is kept', () => {
    expect(fillMissingSpanDefaults({ ...MODERN_PROPS, poles: ['A', 'B'] }, ['A', 'B'])).toBeNull();
    expect(fillMissingSpanDefaults(P({ legacyV2: { x: 1 }, review: ['v2'] }), ['A', 'B'])).toBeNull();
    expect(fillMissingSpanDefaults(P({ system: '3ph4w', review: ['split'] }), ['A', 'B'])!.review).toEqual(['split', 'defaults']);
  });
  it('a drawing mixing empty, partial and complete spans: counts per kind; complete spans untouched', () => {
    const els: DrawingElement[] = [pole('T', 0, 'transformer'), pole('A', 300), pole('B', 600), pole('C', 900), cable('m', ['T', 'A', 'B', 'C'])];
    S().loadProject({ elements: els, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: {}, connectionLabelOffsets: {} });
    const c = cableOf('m');
    let next = withSpanProps(c, c.spanIds![0], { ...MODERN_PROPS, poles: ['T', 'A'] });
    next = withSpanProps(next, next.spanIds![1], { poles: ['A', 'B'], material: 'al', crossSectionMm2: 95, system: '1ph2w' });
    S().updateElement('m', next); S().commitHistory(); historyGestureEnd();
    const complete = JSON.stringify(propsAt('m', 0));
    const plan = applyDefaults();
    expect([plan.empty, plan.partial]).toEqual([1, 1]);
    expect(JSON.stringify(propsAt('m', 0))).toBe(complete);
    expect(propsAt('m', 1)).toMatchObject({ material: 'al', crossSectionMm2: 95, system: '1ph2w', review: ['defaults'] });
    expect(propsAt('m', 2)).toEqual({ poles: ['B', 'C'], ...FULL });
  });
});

describe('cos φ 0.9 and three phases when missing', () => {
  it('no power factor stored → 0.9 for the calculation only; the stored settings stay without it', () => {
    const { settings } = readElectricalSettings({ conductorTempC: 70 });
    expect(settings.powerFactor).toBeUndefined();
    expect(isPowerFactorDefault(settings)).toBe(true);
    expect(effectiveSettings(settings)).toEqual({ ...settings, powerFactor: DEFAULT_POWER_FACTOR });
    expect(settings.powerFactor).toBeUndefined(); // not mutated
    expect(DEFAULT_POWER_FACTOR).toBe(0.9);
  });
  it('a stored power factor (also 1 or 0.8) is never replaced', () => {
    for (const pf of [1, 0.8, 0.95]) expect(effectiveSettings({ ...DEFAULT_ELECTRICAL, powerFactor: pf }).powerFactor).toBe(pf);
  });
  it('missing system → 3 phases + N; a stored system is kept', () => {
    expect(fillMissingSpanDefaults(undefined, ['A', 'B'])!.system).toBe('3ph4w');
    expect(fillMissingSpanDefaults({ poles: ['A', 'B'], material: 'al' }, ['A', 'B'])!.system).toBe('3ph4w');
    expect(fillMissingSpanDefaults({ poles: ['A', 'B'], system: '1ph2w' }, ['A', 'B'])!.system).toBe('1ph2w');
  });
});

describe('imported drawing, save / export / import, autosave, undo / redo of the review mark', () => {
  it('an imported old file: the imported data carries no defaults; filling is still a separate step', () => {
    const data = open(OLD());
    expect((data.elements.find((e) => e.id === 'main') as CableElement).spanProps).toBeUndefined();
    expect(planMissingDefaults(S().elements).empty).toBe(2);
  });
  it('the «defaults» mark survives export → import, the autosave draft, and undo / redo; the file stays version 1', () => {
    open(OLD());
    applyDefaults();
    const st = S(); const d1 = doc();
    const j = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    expect(JSON.parse(j).version).toBe(1);
    expect(JSON.parse(j).electrical.powerFactor).toBeUndefined(); // the default is not written into the file
    useDrawingStore.setState({ ...initial }, true);
    open(j);
    expect(doc()).toBe(d1);
    expect(propsAt('main', 0)?.review).toEqual(['defaults']);
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    if (!v.ok) throw new Error('draft rejected');
    S().loadProject(v.draft.data); historyGestureEnd();
    expect(doc()).toBe(d1);
    // saving the span (the user checked it) clears the mark; undo brings it back, redo removes it
    const c = cableOf('main'); const { review: _r, ...checked } = propsAt('main', 0)!;
    S().saveHistory(); S().updateElement('main', withSpanProps(c, c.spanIds![0], checked)); S().saveHistory();
    expect(propsAt('main', 0)?.review).toBeUndefined();
    S().undo(); expect(propsAt('main', 0)?.review).toEqual(['defaults']);
    S().redo(); expect(propsAt('main', 0)?.review).toBeUndefined();
  });
  it('the mark is kept when the span is split or merged (like the other review marks)', () => {
    open(OLD());
    applyDefaults();
    S().saveHistory(); S().addElement(pole('M', 450)); S().updateElement('main', { poleIds: ['T', 'A', 'M', 'B'] }); S().commitHistory();
    expect(propsAt('main', 1)?.review).toEqual(expect.arrayContaining(['defaults', 'split']));
    expect(propsAt('main', 2)?.review).toEqual(expect.arrayContaining(['defaults', 'split']));
    S().deleteElement('M'); S().commitHistory();
    expect(propsAt('main', 1)?.review).toContain('defaults');
  });
});
