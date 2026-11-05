import { beforeEach, describe, expect, it } from 'vitest';
import { historyGestureEnd, useDrawingStore } from '../../store/drawingStore';
import { documentWithEdit } from '../../store/spanEditStore';
import { fromForm, toForm, type Form } from '../../components/SpanPropertiesSheet';
import { createCableType, latestRevision } from '../cableTypeModel';
import { linkSpanCable } from '../spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';
import { applySpanEdit, lengthToSave, spanRecordToSave } from '../spanEdit';
import { voltageView, type E2DocumentInput, type VoltageView } from '../e2Presentation';
import { DEFAULT_ELECTRICAL, readElectricalSettings } from '../electricalSettings';
import { DEFAULT_SUPPLY_SYSTEM } from '../supplySystem';
import { parseProjectFile, serializeProject, DEFAULT_STYLE } from '../projectSerialization';
import { AR_TR } from '../vdLabels';
import type { CableElement, DrawingElement, ElectricalSettings } from '../../types/drawing';
import type { CableTypeData } from '../../types/cableType';

// The span sheet's unsaved values are calculated at once (drawing, panel, sheet), exactly as «حفظ»
// writes them; the default settings (cos φ 0.9, 8 %) and supply system (3ph+N). ALL VALUES SYNTHETIC.

const v = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'unverified' } }) as never;
const REV = latestRevision(createCableType('ct_syn', {
  name: 'ABC 3x120+70 (synthetic)', construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 120 }, neutral: { material: 'al', sectionMm2: 70 },
  r: v(0.2145, 'unspecified'), x: v(0.0716, 'ac-50hz'), rn: v(0.4126, 'unspecified'), xn: v(0.0754, 'ac-50hz'), source: { name: 'synthetic' },
} as CableTypeData, { now: 1 }));
const pole = (id: string, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
const drawing = (): DrawingElement[] => normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'),
  { id: 'k', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A', 'B'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as CableElement,
  { id: 's', type: 'consumer', x: 0, y: 0, poleId: 'A', color: '#ff0000', count: 4, variant: 'circle', label: '', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 } as DrawingElement,
  { id: 't', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#ff0000', count: 1, variant: 'square', label: '30', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 } as DrawingElement]);

const S = () => useDrawingStore.getState();
const doc = (): E2DocumentInput => ({ elements: S().elements, connectionDistances: S().connectionDistances, distanceFlags: S().distanceFlags, electrical: S().electrical });
const cableK = () => S().elements.find((e) => e.id === 'k') as CableElement;
/** the results the drawing shows (per pole and per span), as plain data */
const shown = (r: VoltageView) => JSON.stringify({ poles: [...r.byPole.entries()], spans: [...r.bySpan.entries()], max: r.circuits.map((c) => [c.maxPercent, c.worstPoleId]) });
/** the sheet's «حفظ» on the drawing store (SpanPropertiesSheet.save, step by step) */
const save = (index: number, form: Form, confirmMeasured = false) => {
  const cable = cableK();
  const { id: spanId, props: stored } = spanAt(cable, index);
  const a = cable.poleIds[index], b = cable.poleIds[index + 1];
  const key = [a, b].sort().join('_');
  const draft = fromForm(form, [a, b], stored, AR_TR);
  S().saveHistory();
  const next = spanRecordToSave(draft.props);
  if (next || stored) S().updateElement(cable.id, withSpanProps(cable, spanId!, next));
  const len = lengthToSave(form.length, S().connectionDistances[key], !!S().distanceFlags[key]?.estimated, confirmMeasured);
  if (len !== undefined) S().updateConnectionDistance(key, len);
  S().saveHistory();
};
/** what the sheet shows (and shares with the drawing) for a form, before saving */
const before = (index: number, form: Form, confirmMeasured = false) => {
  const cable = cableK();
  const { props: stored } = spanAt(cable, index);
  const draft = fromForm(form, [cable.poleIds[index], cable.poleIds[index + 1]], stored, AR_TR);
  return applySpanEdit(doc(), { cableId: 'k', index, props: draft.props, length: form.length, confirmMeasured });
};
const formOf = (index: number, change: Partial<Form> = {}): Form => {
  const cable = cableK();
  const key = [cable.poleIds[index], cable.poleIds[index + 1]].sort().join('_');
  return { ...toForm(spanAt(cable, index).props, S().connectionDistances[key] ?? ''), ...change };
};

const initial = S();
beforeEach(() => {
  useDrawingStore.setState({ ...initial }, true);
  S().loadProject({ elements: drawing(), style: DEFAULT_STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: { A_T: '120', A_B: '80' }, connectionLabelOffsets: {} } as Parameters<typeof initial.loadProject>[0]);
  // the library cable linked on both spans as the sheet links it (written at once), no supply system stored
  for (const i of [0, 1]) {
    const c = cableK();
    const { id, props } = spanAt(c, i);
    S().updateElement('k', withSpanProps(c, id!, linkSpanCable(props, [c.poleIds[i], c.poleIds[i + 1]], REV, 1)));
  }
  historyGestureEnd();
});

describe('defaults: cos φ 0.9, limit 8 %, supply system 3ph+N', () => {
  it('a new project: cos φ 0.9 and 8 % are project settings (shown, not empty, not marked default)', () => {
    expect(DEFAULT_ELECTRICAL.powerFactor).toBe(0.9);
    expect(DEFAULT_ELECTRICAL.limitPercent).toBe(8);
    expect(S().electrical).toMatchObject({ powerFactor: 0.9, limitPercent: 8 });
    const r = voltageView(doc());
    expect(r.study.settingsProvenance.powerFactor).toBe('project');
    expect(JSON.stringify(r.study)).not.toContain('power-factor-default');
  });
  it('a project saved without them gets them; saved values are kept as they are', () => {
    const { powerFactor: _p, limitPercent: _l, ...none } = { ...DEFAULT_ELECTRICAL };
    expect(readElectricalSettings(none).settings).toMatchObject({ powerFactor: 0.9, limitPercent: 8 });
    expect(readElectricalSettings({ ...DEFAULT_ELECTRICAL, powerFactor: 0.85, limitPercent: 5 }).settings).toMatchObject({ powerFactor: 0.85, limitPercent: 5 });
    // through a project file
    const file = serializeProject(drawing(), DEFAULT_STYLE, 1, 'circle', {}, {}, 'p', 'old', undefined, undefined, { ...DEFAULT_ELECTRICAL, powerFactor: 0.95, limitPercent: 5 } as ElectricalSettings, {});
    const back = parseProjectFile(file);
    expect(back.ok && back.data.electrical).toMatchObject({ powerFactor: 0.95, limitPercent: 5 });
  });
  it('a span without a stored supply system: the form shows 3ph+N, E2 calculates it as 3ph+N', () => {
    expect(spanAt(cableK(), 0).props!.system).toBeUndefined();
    expect(DEFAULT_SUPPLY_SYSTEM).toBe('3ph4w');
    expect(formOf(0).system).toBe('3ph4w');
    const r = voltageView(doc());
    expect(r.bySpan.get('k#0')!.computable).toBe(true);
    expect(r.bySpan.get('k#0')!.reasons).toEqual([]);
    // the same as 3ph+N stored on the spans
    const explicit = before(0, formOf(0, { system: '1ph2w' })); // (a different system: a different result)
    expect(shown(voltageView(explicit))).not.toBe(shown(r));
  });
  it('saving the form does not add the default system to a span saved without one; 1ph+N is stored when chosen', () => {
    const c = cableK();
    const stored = spanAt(c, 0).props!;
    expect(fromForm(formOf(0), ['T', 'A'], stored, AR_TR).props.system).toBeUndefined();
    expect(fromForm(formOf(0, { system: '1ph2w' }), ['T', 'A'], stored, AR_TR).props.system).toBe('1ph2w');
    const withSys = { ...stored, system: '1ph2w' as const };
    expect(toForm(withSys, '').system).toBe('1ph2w'); // a stored system is kept
    expect(fromForm(toForm(withSys, ''), ['T', 'A'], withSys, AR_TR).props.system).toBe('1ph2w');
  });
});

describe('the result before «حفظ» is the result after it', () => {
  const cases: [string, number, Partial<Form>, boolean?][] = [
    ['the linked cable as it is (system shown as the default)', 0, {}],
    ['supply system changed to 1ph+N', 1, { system: '1ph2w' }],
    ['length changed', 0, { length: '175' }],
    ['length and supply system changed together', 1, { length: '60', system: '1ph2w' }],
    ['empty length field (the distance stays as it is)', 0, { length: '' }],
    ['own values typed on the span (with the link kept)', 1, { r: '0.5', x: '0.1', rn: '0.5' }],
  ];
  it.each(cases)('%s', (_n, index, change, confirm = false) => {
    const form = formOf(index, change);
    const live = shown(voltageView(before(index, form, confirm)));
    expect(live).not.toBe(''); // calculated before saving
    save(index, form, confirm);
    expect(shown(voltageView(doc()))).toBe(live);
  });
  it('the live result changes at once with the form (length, system) — before any save', () => {
    const r0 = voltageView(doc()).bySpan.get('k#0')!;
    const longer = voltageView(before(0, formOf(0, { length: '240' }))).bySpan.get('k#0')!;
    expect(longer.dropV!).toBeGreaterThan(r0.dropV! * 1.9);
    const single = voltageView(before(1, formOf(1, { system: '1ph2w' }))).bySpan.get('k#1')!;
    expect(single).not.toEqual(voltageView(doc()).bySpan.get('k#1'));
    // nothing was written
    expect(S().connectionDistances.A_T).toBe('120');
    expect(spanAt(cableK(), 1).props!.system).toBeUndefined();
  });
  it('an estimated length confirmed as measured: the same before and after saving', () => {
    useDrawingStore.setState({ distanceFlags: { A_T: { estimated: true } } as never });
    const form = formOf(0);
    const live = shown(voltageView(before(0, form, true)));
    save(0, form, true);
    expect(S().distanceFlags.A_T).toBeUndefined();
    expect(shown(voltageView(doc()))).toBe(live);
  });
});

describe('the drawing uses the open sheet\'s edit only for the document it was made from', () => {
  it('same document: the edit; any other document (saved, undone, changed): the drawing as it is', () => {
    const base = doc();
    const edited = before(0, formOf(0, { length: '300' }));
    expect(documentWithEdit(base, { base, doc: edited })).toBe(edited);
    expect(documentWithEdit({ ...base, connectionDistances: { ...base.connectionDistances } }, { base, doc: edited })).not.toBe(edited);
    expect(documentWithEdit(base, null)).toBe(base);
  });
});
