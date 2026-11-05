import { beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore } from '../../store/drawingStore';
import { historyGestureEnd } from '../../store/drawingStore';
import { DEFAULT_ELECTRICAL, readElectricalSettings, sameSettings } from '../electricalSettings';
import { parseProjectFile, serializeProject, DEFAULT_STYLE } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { normalizeElements, withSpanProps } from '../spanModel';
import { cachedVoltageView, voltageView } from '../e2Presentation';
import type { CableElement, ConsumerElement, DrawingElement, ElectricalSettings, SpanProps } from '../../types/drawing';

// The Default Single-Phase Nominal Load (A) and the Single-Phase Load Allocation Method: stored with
// the project's electrical settings, read back, applied to single-phase subscribers only, and the
// results recalculated by E2. ALL VALUES SYNTHETIC.

const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
const DATA: Omit<SpanProps, 'poles'> = { system: '3ph4w', rOhmPerKm: 0.5, xOhmPerKm: 0.08, rNeutralOhmPerKm: 0.5, parallel: 1, dataSource: 'synthetic' };
const elements = (): DrawingElement[] => {
  const els = normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'),
    { id: 'c', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as CableElement,
    { id: 'd', type: 'cable', x: 0, y: 0, poleIds: ['T', 'B'], cableIndex: 0, offset: 0, strokeColor: '#0000ff', fillColor: 'none', strokeWidth: 2 } as CableElement,
    { id: 's', type: 'consumer', x: 0, y: 0, poleId: 'A', color: '#ff0000', count: 3, variant: 'circle', label: '', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 } as ConsumerElement,
    { id: 't', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#0000ff', count: 1, variant: 'square', label: '40', strokeColor: '#00f', fillColor: '#00f', strokeWidth: 2 } as ConsumerElement]);
  return els.map((e) => (e.type === 'cable' ? withSpanProps(e, e.spanIds![0], { poles: [e.poleIds[0], e.poleIds[1]], ...DATA }) : e));
};
const D = { A_T: '100', B_T: '100' };

describe('storing the settings', () => {
  it('a new project starts at 4 A and Equal Phase Current', () => {
    expect(DEFAULT_ELECTRICAL.singlePhaseNominalA).toBe(4);
    expect(DEFAULT_ELECTRICAL.singlePhaseMode).toBe('balanced');
    expect(readElectricalSettings(undefined).settings.singlePhaseNominalA).toBe(4);
    expect(readElectricalSettings(undefined).settings.singlePhaseMode).toBe('balanced');
  });
  it('old projects: a stored method is kept as it is; no stored method reads as Equal Phase Current', () => {
    for (const m of ['worst', 'balanced'] as const) {
      const stored = { ...DEFAULT_ELECTRICAL, singlePhaseMode: m };
      const r = readElectricalSettings(stored);
      expect(r.invalid).toEqual([]);
      expect(r.settings.singlePhaseMode).toBe(m);
      expect(stored.singlePhaseMode).toBe(m); // the stored object is not changed
    }
    const { singlePhaseMode: _m, ...none } = DEFAULT_ELECTRICAL;
    expect(readElectricalSettings(none).settings.singlePhaseMode).toBe('balanced');
    // a saved file keeps 'worst' through save → open
    const file = serializeProject(elements(), DEFAULT_STYLE, 1, 'circle', D, {}, 'p1', 'old', undefined, undefined, { ...DEFAULT_ELECTRICAL, singlePhaseMode: 'worst' }, {});
    const back = parseProjectFile(file);
    expect(back.ok && back.data.electrical!.singlePhaseMode).toBe('worst');
    const fileNone = serializeProject(elements(), DEFAULT_STYLE, 1, 'circle', D, {}, 'p1', 'old', undefined, undefined, none as ElectricalSettings, {});
    const backNone = parseProjectFile(fileNone);
    expect(backNone.ok && backNone.data.electrical!.singlePhaseMode).toBe('balanced');
  });
  it('a project saved before the setting existed reads as 4 A; nothing else of it changes', () => {
    const { singlePhaseNominalA: _a, ...old } = { ...DEFAULT_ELECTRICAL, limitPercent: 6, singlePhaseMode: 'balanced' as const };
    const r = readElectricalSettings(old);
    expect(r.invalid).toEqual([]);
    expect(r.settings).toEqual({ ...old, singlePhaseNominalA: 4 });
  });
  it('only a number above 0 is accepted (0, negative, text: reported, the default used)', () => {
    expect(readElectricalSettings({ singlePhaseNominalA: 5.5 }).settings.singlePhaseNominalA).toBe(5.5);
    for (const bad of [0, -3, 'x', Number.NaN, Infinity]) {
      const r = readElectricalSettings({ singlePhaseNominalA: bad });
      expect(r.invalid, String(bad)).toContain('singlePhaseNominalA');
      expect(r.settings.singlePhaseNominalA).toBe(4);
    }
    expect(sameSettings({ ...DEFAULT_ELECTRICAL }, { ...DEFAULT_ELECTRICAL, singlePhaseNominalA: 5 })).toBe(false);
  });
  it('save → open keeps the chosen value and method; drawing, cables and subscribers are unchanged', () => {
    const els = elements();
    const electrical: ElectricalSettings = { ...DEFAULT_ELECTRICAL, singlePhaseNominalA: 6, singlePhaseMode: 'balanced' };
    const file = serializeProject(els, DEFAULT_STYLE, 1, 'circle', D, {}, 'p1', 'test', undefined, undefined, electrical, {});
    const back = parseProjectFile(file);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.electrical).toMatchObject({ singlePhaseNominalA: 6, singlePhaseMode: 'balanced' });
    expect(JSON.stringify(back.data.elements)).toBe(JSON.stringify(els));
    expect(back.data.connectionDistances).toEqual(D);
  });
  it('an old project file (no field) opens with 4 A and its subscribers as they were', () => {
    const els = elements();
    const { singlePhaseNominalA: _a, ...old } = DEFAULT_ELECTRICAL;
    const file = serializeProject(els, DEFAULT_STYLE, 1, 'circle', D, {}, 'p1', 'old', undefined, undefined, old as ElectricalSettings, {});
    expect(file).not.toContain('singlePhaseNominalA');
    const back = parseProjectFile(file);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data.electrical!.singlePhaseNominalA).toBe(4);
    expect(JSON.stringify(back.data.elements)).toBe(JSON.stringify(els));
  });
});

describe('in the store: the change is one undo step, kept in the autosave draft, and recalculates', () => {
  const S = () => useDrawingStore.getState();
  const initial = S();
  beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
  it('change, undo, redo; the draft carries it', () => {
    S().loadProject({ elements: elements(), style: DEFAULT_STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: D, connectionLabelOffsets: {} } as Parameters<typeof initial.loadProject>[0]);
    historyGestureEnd();
    expect(S().electrical.singlePhaseNominalA).toBe(4);
    const view = () => cachedVoltageView({ elements: S().elements, connectionDistances: S().connectionDistances, distanceFlags: S().distanceFlags, electrical: S().electrical });
    S().saveHistory(); S().updateElectricalSettings({ singlePhaseMode: 'balanced' }); S().saveHistory();
    const at4 = view();
    S().saveHistory(); S().updateElectricalSettings({ singlePhaseNominalA: 6 }); S().saveHistory();
    const at6 = view();
    expect(at6).not.toBe(at4); // a new calculation for the new settings
    expect(at4.bySpan.get('c#0')!.currentA.a).toBeCloseTo(4, 9);
    expect(at6.bySpan.get('c#0')!.currentA.a).toBeCloseTo(6, 9);
    // the three-phase subscriber's network: exactly the same result
    expect(at6.bySpan.get('d#0')).toEqual(at4.bySpan.get('d#0'));
    expect(JSON.stringify(S().elements.find((e) => e.id === 't'))).toBe(JSON.stringify(elements().find((e) => e.id === 't')));
    const draft = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    expect(draft.ok && draft.draft.data.electrical.singlePhaseNominalA).toBe(6);
    S().undo();
    expect(S().electrical.singlePhaseNominalA).toBe(4);
    S().redo();
    expect(S().electrical.singlePhaseNominalA).toBe(6);
    // the same document state is calculated once (the overlay, the panel and the preview share it)
    expect(view()).toBe(view());
  });
});

describe('the value in E2', () => {
  it('single-phase subscribers only, no other factor; the method is the project\'s', () => {
    const els = elements();
    const r = (s: Partial<ElectricalSettings>) => voltageView({ elements: els, connectionDistances: D, distanceFlags: {}, electrical: { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, singlePhaseMode: 'balanced', ...s } });
    const a = r({}), b = r({ singlePhaseNominalA: 10 });
    expect(a.bySpan.get('c#0')!.currentA).toMatchObject({ a: expect.closeTo(4, 9), b: expect.closeTo(4, 9), c: expect.closeTo(4, 9) });
    expect(b.bySpan.get('c#0')!.currentA).toMatchObject({ a: expect.closeTo(10, 9), b: expect.closeTo(10, 9), c: expect.closeTo(10, 9) });
    expect(b.bySpan.get('d#0')!.currentA).toEqual(a.bySpan.get('d#0')!.currentA);
    expect(b.bySpan.get('d#0')!.currentA.a).toBeCloseTo(40, 9);
    expect(r({ singlePhaseMode: 'worst' }).method).toBe('worst');
  });
});
