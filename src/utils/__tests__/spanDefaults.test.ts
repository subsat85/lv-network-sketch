import { beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import { COMPANY_RX_OHM_PER_KM, companyRX, companySections } from '../../data/conductors';
import { defaultSpanValues, followNeutralTable, followPhaseTable, neutralTableState, phaseTableState, withDefaultSpan } from '../spanDefaults';
import { spanAt, withSpanProps } from '../spanModel';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { computeVoltageDrop, spanKey } from '../voltageDrop';
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';

// Stage 7.12 — default properties of newly drawn spans and the company cable table.

const S = () => useDrawingStore.getState();
const initial = S();
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
const pole = (id: string, x: number, y = 0, symbolId = 'lv-pole'): SymbolElement => ({ id, type: 'symbol', symbolId, x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color = '#ff0000'): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: color, fillColor: 'none', strokeWidth: 2 });
const consumer = (id: string, poleId: string, count = 4): ConsumerElement => ({ id, type: 'consumer', x: 0, y: 0, poleId, color: '#ff0000', count, variant: 'circle', label: '', strokeColor: '#ff0000', fillColor: '#ff0000', strokeWidth: 2 });
const cableOf = (id: string) => S().elements.find((e) => e.id === id) as CableElement;
const propsAt = (id: string, i: number) => spanAt(cableOf(id), i).props;
const load = (elements: DrawingElement[], connectionDistances: Record<string, string> = {}) => {
  S().loadProject({ elements, style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances, connectionLabelOffsets: {} });
  historyGestureEnd();
};
const doc = () => JSON.stringify({ e: S().elements, d: S().connectionDistances, f: S().distanceFlags, el: S().electrical });

// What the cable tool does (SketchCanvas): a new cable starts at a pole; every tap on a
// pole appends it, and a new span without properties gets the defaults — one undo step.
const startCable = (id: string, first: string, color = '#ff0000') => { S().saveHistory(); S().addElement(cable(id, [first], color)); S().commitHistory(); };
const drawTo = (cableId: string, poleId: string) => {
  S().saveHistory();
  S().updateElement(cableId, { poleIds: [...cableOf(cableId).poleIds, poleId] });
  const drawn = cableOf(cableId);
  const next = withDefaultSpan(drawn, drawn.poleIds.length - 2);
  if (next !== drawn) S().updateElement(cableId, { spanProps: next.spanProps });
  S().commitHistory();
};

const EXPECTED_DEFAULTS: Omit<SpanProps, 'poles'> = {
  cableKind: 'abc', system: '3ph4w', material: 'al', crossSectionMm2: 120, neutralMaterial: 'al', neutralCrossSectionMm2: 70,
  parallel: 1, rOhmPerKm: 0.2415, xOhmPerKm: 0.0716, rNeutralOhmPerKm: 0.4126, dataSource: 'كتالوج',
};

describe('company cable table (values as supplied, Ω/km)', () => {
  const expected: Record<string, [number, number, number][]> = {
    al: [[120, 0.2415, 0.0716], [70, 0.4126, 0.0754], [35, 0.8242, 0.0846], [25, 1.1536, 0.0838], [4, 7.53, 0.107], [2.5, 12.1, 0.11], [1.5, 19.5, 0.115]],
    cu: [[120, 0.253, 0.095], [70, 0.32, 0.095], [35, 0.524, 0.095], [25, 0.727, 0.095], [4, 4.61, 0.107], [2.5, 7.41, 0.11], [1.5, 12.1, 0.115]],
  };
  for (const m of ['al', 'cu'] as const) {
    it(`${m}: every size, exact R and X`, () => {
      for (const [mm2, r, x] of expected[m]) expect([mm2, companyRX(m, mm2)]).toEqual([mm2, { r, x }]);
      expect(companySections(m)).toEqual([1.5, 2.5, 4, 25, 35, 70, 120]);
      expect(Object.keys(COMPANY_RX_OHM_PER_KM[m]).length).toBe(7);
    });
  }
  it('a size or material that is not in the table → null (never interpolated)', () => {
    for (const [m, s] of [['al', 95], ['cu', 50], ['al', 16], ['alloy', 70], ['', 120], ['al', undefined]] as const) expect(companyRX(m, s)).toBeNull();
  });
});

describe('a newly drawn span gets the defaults', () => {
  it('the defaults: ABC, 3φ+N, Al 120 / neutral Al 70, 1 per phase, R / X / Rn from the company table, source «كتالوج»', () => {
    expect(defaultSpanValues()).toEqual(EXPECTED_DEFAULTS);
    expect(defaultSpanValues().rNeutralOhmPerKm).not.toBe(defaultSpanValues().rOhmPerKm); // Rn is the neutral's own conductor, not the phase R
  });
  it('first span of a new cable: the defaults, not marked inherited; one undo step removes span and properties together', () => {
    load([pole('A', 0), pole('B', 300)]);
    startCable('c', 'A');
    const before = doc(); const h = S().history.length;
    drawTo('c', 'B');
    expect(propsAt('c', 0)).toEqual({ poles: ['A', 'B'], ...EXPECTED_DEFAULTS });
    expect(S().history.length).toBe(h + 1);
    S().undo(); expect(doc()).toBe(before);
    S().redo(); expect(propsAt('c', 0)).toEqual({ poles: ['A', 'B'], ...EXPECTED_DEFAULTS });
  });
  it('the next span keeps the existing rule: a copy of the previous span, marked inherited (here: the defaults; after an edit: the edited values)', () => {
    load([pole('A', 0), pole('B', 300), pole('C', 600), pole('D', 900)]);
    startCable('c', 'A'); drawTo('c', 'B'); drawTo('c', 'C');
    expect(propsAt('c', 1)).toEqual({ poles: ['B', 'C'], ...EXPECTED_DEFAULTS, inherited: true });
    S().updateElement('c', withSpanProps(cableOf('c'), cableOf('c').spanIds![1], { poles: ['B', 'C'], ...EXPECTED_DEFAULTS, material: 'cu', crossSectionMm2: 70, rOhmPerKm: 0.32, xOhmPerKm: 0.095 }));
    S().commitHistory();
    drawTo('c', 'D');
    expect(propsAt('c', 2)).toMatchObject({ material: 'cu', crossSectionMm2: 70, rOhmPerKm: 0.32, xOhmPerKm: 0.095, inherited: true });
  });
  it('a second cable on the same poles gets its own defaults (properties are per cable)', () => {
    load([pole('A', 0), pole('B', 300)]);
    startCable('c1', 'A'); drawTo('c1', 'B');
    startCable('c2', 'B', '#0000ff'); drawTo('c2', 'A');
    expect(propsAt('c2', 0)).toEqual({ poles: ['B', 'A'], ...EXPECTED_DEFAULTS });
    expect(cableOf('c1').spanProps).not.toBe(cableOf('c2').spanProps);
  });
  it('the span values are copies: changing a span never changes the defaults or another span', () => {
    load([pole('A', 0), pole('B', 300), pole('C', 600)]);
    startCable('c', 'A'); drawTo('c', 'B');
    startCable('d', 'B', '#00f'); drawTo('d', 'C');
    S().updateElement('c', withSpanProps(cableOf('c'), cableOf('c').spanIds![0], { ...propsAt('c', 0)!, crossSectionMm2: 35, rOhmPerKm: 0.8242, xOhmPerKm: 0.0846 }));
    expect(defaultSpanValues()).toEqual(EXPECTED_DEFAULTS);
    expect(propsAt('d', 0)).toEqual({ poles: ['B', 'C'], ...EXPECTED_DEFAULTS });
  });
  it('withDefaultSpan never touches a span that already has a record, or an index out of range', () => {
    const c = withSpanProps({ ...cable('c', ['A', 'B']), spanIds: ['s1'] }, 's1', { poles: ['A', 'B'], material: 'cu' });
    expect(withDefaultSpan(c, 0)).toBe(c);
    expect(withDefaultSpan(c, 1)).toBe(c);
    expect(withDefaultSpan(c, -1)).toBe(c);
  });
  it('the calculation uses the table values as they are (no temperature correction) and the stated source', () => {
    load([pole('T', 0, 0, 'transformer'), pole('A', 300), consumer('u', 'A', 10)], { A_T: '100' });
    S().updateElectricalSettings({ powerFactor: 0.9, conductorTempC: 70 });
    startCable('c', 'T'); drawTo('c', 'A');
    const r = computeVoltageDrop(S().elements, S().connectionDistances, S().electrical, S().distanceFlags);
    const sp = r.bySpan.get(spanKey('c', 0))!;
    expect([sp.r, sp.x, sp.rn, sp.rSource, sp.rnSource, sp.parallel, sp.computable, sp.provisional]).toEqual([0.2415, 0.0716, 0.4126, 'manual', 'manual', 1, true, []]);
  });
});

describe('span sheet: R / X follow the table, typed values are kept', () => {
  const phase = (material: string, section: string, r = '', x = '') => ({ material, section, r, x });
  it('changing the section (Al 120 → 70) or the material (Al → Cu) updates R and X from the table', () => {
    expect(followPhaseTable(phase('al', '120', '0.2415', '0.0716'), { material: 'al', section: '70' })).toEqual({ r: '0.4126', x: '0.0754', kept: [] });
    expect(followPhaseTable(phase('al', '120', '0.2415', '0.0716'), { material: 'cu', section: '120' })).toEqual({ r: '0.253', x: '0.095', kept: [] });
  });
  it('every size of both materials, reached from another table size', () => {
    for (const m of ['al', 'cu'] as const) for (const s of companySections(m)) {
      const t = followPhaseTable(phase('al', '120', '0.2415', '0.0716'), { material: m, section: String(s) });
      expect([m, s, Number(t.r), Number(t.x)]).toEqual([m, s, COMPANY_RX_OHM_PER_KM[m][s].r, COMPANY_RX_OHM_PER_KM[m][s].x]);
    }
  });
  it('empty R / X are filled from the table; a size not in the table empties the table values (no guess)', () => {
    expect(followPhaseTable(phase('al', '', '', ''), { material: 'al', section: '35' })).toEqual({ r: '0.8242', x: '0.0846', kept: [] });
    expect(followPhaseTable(phase('al', '120', '0.2415', '0.0716'), { material: 'al', section: '95' })).toEqual({ r: '', x: '', kept: [] });
    // typing "70" goes through "7": the table values come back at "70"
    const mid = followPhaseTable(phase('al', '120', '0.2415', '0.0716'), { material: 'al', section: '7' });
    expect(followPhaseTable({ material: 'al', section: '7', ...mid }, { material: 'al', section: '70' })).toEqual({ r: '0.4126', x: '0.0754', kept: [] });
  });
  it('a typed R or X is never replaced silently — each field on its own', () => {
    expect(followPhaseTable(phase('al', '120', '0.25', '0.0716'), { material: 'al', section: '70' })).toEqual({ r: '0.25', x: '0.0754', kept: ['r'] });
    expect(followPhaseTable(phase('al', '120', '0.2415', '0.08'), { material: 'cu', section: '35' })).toEqual({ r: '0.524', x: '0.08', kept: ['x'] });
    expect(followPhaseTable(phase('al', '95', '0.3', '0.08'), { material: 'al', section: '120' })).toEqual({ r: '0.3', x: '0.08', kept: ['r', 'x'] });
  });
  it('the sheet state tells "from the table" from "typed", for the explicit «استخدام قيم جدول الشركة» button', () => {
    expect(phaseTableState(phase('al', '120', '0.2415', '0.0716'))).toEqual({ table: { r: 0.2415, x: 0.0716 }, matches: true });
    expect(phaseTableState(phase('al', '120', '0.25', '0.0716'))).toEqual({ table: { r: 0.2415, x: 0.0716 }, matches: false });
    expect(phaseTableState(phase('al', '95', '0.3', '0.08'))).toEqual({ table: null, matches: false });
  });
  it('neutral: Rn follows the neutral material / section (its own conductor), typed Rn is kept, alloy is not in the table', () => {
    const n = (neutralMaterial: string, neutral: string, rn = '') => ({ neutralMaterial, neutral, rn });
    expect(followNeutralTable(n('al', '70', '0.4126'), { neutralMaterial: 'al', neutral: '35' })).toEqual({ rn: '0.8242', kept: false });
    expect(followNeutralTable(n('al', '70', '0.4126'), { neutralMaterial: 'cu', neutral: '70' })).toEqual({ rn: '0.32', kept: false });
    expect(followNeutralTable(n('al', '70', '0.4126'), { neutralMaterial: 'alloy', neutral: '70' })).toEqual({ rn: '', kept: false });
    expect(followNeutralTable(n('al', '70', '0.5'), { neutralMaterial: 'al', neutral: '35' })).toEqual({ rn: '0.5', kept: true });
    expect(followNeutralTable(n('', '', ''), { neutralMaterial: 'al', neutral: '' })).toEqual({ rn: '', kept: false });
    expect(neutralTableState(n('al', '70', '0.4126')).matches).toBe(true);
    // the phase table never fills Rn, and the neutral table never fills R / X
    expect(followPhaseTable(phase('al', '120', '0.2415', '0.0716'), { material: 'al', section: '70' })).not.toHaveProperty('rn');
  });
});

describe('existing projects and spans are not changed', () => {
  const OLD_V1 = JSON.stringify({
    version: 1, style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle',
    elements: [pole('T', 0, 0, 'transformer'), pole('A', 300), pole('B', 600), cable('main', ['T', 'A', 'B']), consumer('u', 'B')],
    connectionDistances: { A_T: '100', A_B: '80' }, connectionLabelOffsets: {},
  });
  it('an old file without span properties opens without any (no defaults added), and its results stay "not computable"', () => {
    const p = parseProjectFile(OLD_V1);
    if (!p.ok) throw new Error('rejected');
    S().loadProject(p.data as Parameters<typeof initial.loadProject>[0]);
    expect(cableOf('main').spanProps).toBeUndefined();
    const r = computeVoltageDrop(S().elements, S().connectionDistances, S().electrical, S().distanceFlags);
    expect([...r.byPole.values()].flat().every((x) => x.status === 'na')).toBe(true);
    // and the autosave draft of it carries none either
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    if (!v.ok) throw new Error('draft rejected');
    expect((v.draft.data.elements.find((e) => e.id === 'main') as CableElement).spanProps).toBeUndefined();
  });
  it('drawing in an old project: only the new span gets the defaults; existing spans (with or without properties) are untouched', () => {
    const al95: SpanProps = { poles: ['A', 'B'], system: '3ph4w', cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, dataSource: 'تقرير' };
    load([pole('T', 0, 0, 'transformer'), pole('A', 300), pole('B', 600), pole('C', 900), cable('main', ['T', 'A', 'B']), cable('old', ['A', 'C'], '#00f')]);
    S().updateElement('main', withSpanProps(cableOf('main'), cableOf('main').spanIds![1], al95)); S().commitHistory();
    const mainBefore = JSON.stringify(cableOf('main'));
    const oldSpan0 = propsAt('old', 0);
    drawTo('old', 'B');
    expect(JSON.stringify(cableOf('main'))).toBe(mainBefore);
    expect(propsAt('old', 0)).toEqual(oldSpan0); // undefined: still no properties
    expect(propsAt('old', 1)).toEqual({ poles: ['C', 'B'], ...EXPECTED_DEFAULTS });
  });
  it('save → open, export → import and the autosave draft keep a span with the defaults and a typed span exactly', () => {
    load([pole('A', 0), pole('B', 300), pole('C', 600)], { A_B: '40', B_C: '35' });
    startCable('c', 'A'); drawTo('c', 'B'); drawTo('c', 'C');
    S().updateElement('c', withSpanProps(cableOf('c'), cableOf('c').spanIds![1], { poles: ['B', 'C'], ...EXPECTED_DEFAULTS, rOhmPerKm: 0.25 })); S().commitHistory();
    const st = S(); const d0 = doc();
    const j = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    expect(JSON.parse(j).version).toBe(1);
    const p = parseProjectFile(j);
    if (!p.ok) throw new Error('rejected');
    useDrawingStore.setState({ ...initial }, true);
    S().loadProject(p.data as Parameters<typeof initial.loadProject>[0]);
    expect(doc()).toBe(d0);
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    if (!v.ok) throw new Error('draft rejected');
    S().loadProject(v.draft.data);
    expect(doc()).toBe(d0);
    expect(propsAt('c', 0)).toEqual({ poles: ['A', 'B'], ...EXPECTED_DEFAULTS });
    expect(propsAt('c', 1)?.rOhmPerKm).toBe(0.25);
  });
});
