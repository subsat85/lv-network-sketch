import { beforeEach, describe, expect, it } from 'vitest';
import { addExact, halveExact, parseDecimal } from '../distances';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import { splitSpanInCables, withSpanProps } from '../spanModel';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { computeVoltageDrop } from '../voltageDrop';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import type { CableElement, ConsumerElement, SpanProps, SymbolElement } from '../../types/drawing';

// Stage 7.8 — placing a pole on a span and deleting it again: distances and span data.

const S = () => useDrawingStore.getState();
const initial = S();
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
const step = (fn: () => void) => { fn(); S().commitHistory(); };
const pole = (id: string, x = 0, symbolId = 'lv-pole'): SymbolElement => ({ id, type: 'symbol', symbolId, x, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color = '#ff0000'): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: color, fillColor: 'none', strokeWidth: 2 });
const cableOf = (id: string) => S().elements.find((e) => e.id === id) as CableElement;
const doc = () => JSON.stringify({ e: S().elements, d: S().connectionDistances, o: S().connectionLabelOffsets, f: S().distanceFlags });
// what the canvas does when a pole is placed on span a–b (SketchCanvas, split branch)
const placeOn = (a: string, b: string, id: string, x: number) => step(() => {
  S().addElement(pole(id, x));
  S().updateElements(splitSpanInCables(S().elements, a, b, id));
  S().splitConnectionDistance(a, b, id);
});
const AB = (dist?: string) => {
  step(() => { S().addElement(pole('A', 0)); S().addElement(pole('B', 400)); S().addElement(cable('r', ['A', 'B'])); S().addElement(cable('b', ['B', 'A'], '#0000ff')); });
  if (dist !== undefined) step(() => S().updateConnectionDistance('A_B', dist));
};

describe('exact decimal halves and sums', () => {
  it('audit cases 33.3 and 25.5: the two halves add up to the original exactly', () => {
    expect(halveExact('33.3')).toEqual(['16.65', '16.65']);
    expect(addExact(['16.65', '16.65'])).toBe('33.3');
    expect(halveExact('25.5')).toEqual(['12.75', '12.75']);
    expect(addExact(['12.75', '12.75'])).toBe('25.5');
    expect(halveExact('35')).toEqual(['17.5', '17.5']);
    expect(halveExact('50')).toEqual(['25', '25']);
    expect(halveExact('12,5')).toEqual(['6.25', '6.25']);
  });
  it('text that is not a plain number is never turned into a distance', () => {
    for (const t of ['abc', '40m', '', ' ', '-5', '1e2']) expect(halveExact(t)).toBeNull();
    expect(parseDecimal('40m')).toBeNull();
    expect(addExact(['18', 'x'])).toBeNull();
  });
});

describe('placing a pole on a span', () => {
  it('33.3 m: both parts get 16.65 m marked ESTIMATED; the old pair key goes into the markers (no stale value left)', () => {
    AB('33.3');
    placeOn('A', 'B', 'M', 100);
    expect(S().connectionDistances).toEqual({ A_M: '16.65', B_M: '16.65' });
    expect(S().distanceFlags.A_M).toEqual({ estimated: true, splitFrom: { key: 'A_B', value: '33.3' } });
    expect(S().distanceFlags.B_M).toEqual({ estimated: true, splitFrom: { key: 'A_B', value: '33.3' } });
    // both parallel cables got the pole
    expect(cableOf('r').poleIds).toEqual(['A', 'M', 'B']);
    expect(cableOf('b').poleIds).toEqual(['B', 'M', 'A']);
  });
  it('the marker is there whether the cables have electrical properties or not (both cables here have none)', () => {
    AB('40');
    placeOn('A', 'B', 'M', 100);
    expect(cableOf('b').spanProps).toBeUndefined();
    expect(S().distanceFlags.A_M?.estimated).toBe(true);
  });
  it('a distance written as text ("abc") is not split into numbers: the parts stay unrecorded, the text is kept for restoring', () => {
    AB('abc');
    placeOn('A', 'B', 'M', 100);
    expect(S().connectionDistances).toEqual({});
    expect(S().distanceFlags.A_M).toEqual({ splitFrom: { key: 'A_B', value: 'abc' } });
    step(() => S().deleteElement('M'));
    expect(S().connectionDistances).toEqual({ A_B: 'abc' });
    expect(S().distanceFlags).toEqual({});
  });
  it('an unrecorded distance stays unrecorded', () => {
    AB();
    placeOn('A', 'B', 'M', 100);
    expect(S().connectionDistances).toEqual({});
    expect(S().distanceFlags).toEqual({});
  });
  it('a pole placed off-centre still only gives estimates (the sketch position is not a measurement) — results are provisional', () => {
    AB('40');
    placeOn('A', 'B', 'M', 50); // a quarter of the way along on the drawing
    expect(S().connectionDistances).toEqual({ A_M: '20', B_M: '20' });
    expect(S().distanceFlags.A_M?.estimated && S().distanceFlags.B_M?.estimated).toBe(true);
    // with complete electrical data on cable r, the drop is computed but provisional
    const r = cableOf('r');
    const p: Omit<SpanProps, 'poles'> = { system: '3ph4w', cableKind: 'abc', material: 'al', crossSectionMm2: 95, xOhmPerKm: 0.08, dataSource: 'test' };
    step(() => S().updateElement('r', [0, 1].reduce((c, i) => withSpanProps(c, c.spanIds![i], { ...p, poles: [c.poleIds[i], c.poleIds[i + 1]] }), r)));
    const sub: ConsumerElement = { id: 'u', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#ff0000', count: 1, variant: 'square', label: '63', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2 };
    step(() => { S().addElement(pole('T', -200, 'transformer')); S().addElement(cable('f', ['T', 'A'])); S().updateConnectionDistance('A_T', '10'); S().addElement(sub); });
    const f = cableOf('f');
    step(() => S().updateElement('f', withSpanProps(f, f.spanIds![0], { ...p, poles: ['T', 'A'] })));
    const vd = () => computeVoltageDrop(S().elements, S().connectionDistances, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 }, S().distanceFlags);
    const atB = () => vd().byPole.get('B')!.find((x) => x.color === '#ff0000')!;
    expect(atB().provisional).toContain('length-estimated');
    // the user measures both parts: no longer provisional
    step(() => { S().updateConnectionDistance('A_M', '10'); S().updateConnectionDistance('B_M', '30'); });
    expect(S().distanceFlags).toEqual({});
    expect(atB().provisional).toEqual([]);
  });
});

describe('deleting the pole again', () => {
  it('no part measured since: the original distance (and label position) comes back exactly, not a sum', () => {
    AB('33.3');
    step(() => S().updateConnectionLabelOffset('A_B', { x: 7, y: -3 }));
    const before = doc();
    placeOn('A', 'B', 'M', 100);
    step(() => S().deleteElement('M'));
    expect(S().connectionDistances).toEqual({ A_B: '33.3' });
    expect(S().connectionLabelOffsets).toEqual({ A_B: { x: 7, y: -3 } });
    expect(doc().replace(/"spanIds":\[[^\]]*\]/g, '')).toBe(before.replace(/"spanIds":\[[^\]]*\]/g, ''));
  });
  it('audit case: both parts measured (18 + 27) → A–B = 45, the measured sum — never the old 40', () => {
    AB('40');
    placeOn('A', 'B', 'M', 100);
    step(() => { S().updateConnectionDistance('A_M', '18'); S().updateConnectionDistance('B_M', '27'); });
    step(() => S().deleteElement('M'));
    expect(S().connectionDistances).toEqual({ A_B: '45' });
    expect(S().distanceFlags).toEqual({});
  });
  it('one part measured, the other still estimated → the exact sum, marked estimated', () => {
    AB('33.3');
    placeOn('A', 'B', 'M', 100);
    step(() => S().updateConnectionDistance('A_M', '20.4'));
    step(() => S().deleteElement('M'));
    expect(S().connectionDistances).toEqual({ A_B: '37.05' });
    expect(S().distanceFlags).toEqual({ A_B: { estimated: true } });
  });
  it('a drawing from before 7.8 that still has the stale A–B key: measured parts win', () => {
    // as the old canvas left it: parts halved, old key kept, no markers
    step(() => { ['A', 'M', 'B'].forEach((p, i) => S().addElement(pole(p, i * 100))); S().addElement(cable('r', ['A', 'M', 'B'])); });
    step(() => { S().updateConnectionDistance('A_B', '40'); S().updateConnectionDistance('A_M', '18'); S().updateConnectionDistance('B_M', '27'); });
    step(() => S().deleteElement('M'));
    expect(S().connectionDistances).toEqual({ A_B: '45' });
  });
  it('a pole placed on an estimated part, then deleted, gives back the estimate with its marker', () => {
    AB('40');
    placeOn('A', 'B', 'M', 200);
    placeOn('A', 'M', 'N', 100);
    expect(S().connectionDistances).toEqual({ A_N: '10', M_N: '10', B_M: '20' });
    step(() => S().deleteElement('N'));
    expect(S().connectionDistances).toEqual({ A_M: '20', B_M: '20' });
    expect(S().distanceFlags.A_M).toEqual({ estimated: true, splitFrom: { key: 'A_B', value: '40' } });
    step(() => S().deleteElement('M'));
    expect(S().connectionDistances).toEqual({ A_B: '40' });
    expect(S().distanceFlags).toEqual({});
  });
});

describe('span ids, properties and merges', () => {
  it('merge of a span with properties and one without: nothing dropped — both records kept, marked "merge-partial"', () => {
    step(() => { ['A', 'B', 'C'].forEach((p, i) => S().addElement(pole(p, i * 100))); S().addElement(cable('c', ['A', 'B', 'C'])); });
    const c = cableOf('c');
    step(() => S().updateElement('c', withSpanProps(c, c.spanIds![0], { poles: ['A', 'B'], material: 'al', crossSectionMm2: 95 })));
    step(() => S().deleteElement('B'));
    const rec = Object.values(cableOf('c').spanProps!)[0];
    expect(rec.review).toEqual(['merge-partial']);
    expect(rec.mergedFrom).toEqual([{ material: 'al', crossSectionMm2: 95 }, null]);
  });
  it('a split then merge with unchanged values does not leave a "split" review mark behind', () => {
    AB('40');
    const r = cableOf('r');
    step(() => S().updateElement('r', withSpanProps(r, r.spanIds![0], { poles: ['A', 'B'], material: 'al', crossSectionMm2: 95 })));
    placeOn('A', 'B', 'M', 100);
    expect(Object.values(cableOf('r').spanProps!).every((p) => p.review?.includes('split'))).toBe(true);
    step(() => S().deleteElement('M'));
    expect(Object.values(cableOf('r').spanProps!)).toEqual([{ poles: ['A', 'B'], material: 'al', crossSectionMm2: 95 }]);
  });
  it('entering the measured length of a split part removes its "split" review mark (that span only)', () => {
    AB('40');
    const r = cableOf('r');
    step(() => S().updateElement('r', withSpanProps(r, r.spanIds![0], { poles: ['A', 'B'], material: 'al', crossSectionMm2: 95 })));
    placeOn('A', 'B', 'M', 100);
    step(() => S().updateConnectionDistance('A_M', '19'));
    const rr = cableOf('r');
    expect(rr.spanProps![rr.spanIds![0]].review).toBeUndefined();
    expect(rr.spanProps![rr.spanIds![1]].review).toEqual(['split']);
  });
  it('undo / redo of placing and of deleting restore everything exactly; ids unique', () => {
    AB('33.3');
    const s0 = doc();
    placeOn('A', 'B', 'M', 100);
    const s1 = doc();
    const ids = [...cableOf('r').spanIds!, ...cableOf('b').spanIds!];
    expect(new Set(ids).size).toBe(4);
    step(() => S().deleteElement('M'));
    const s2 = doc();
    S().undo(); expect(doc()).toBe(s1);
    S().undo(); expect(doc()).toBe(s0);
    S().redo(); expect(doc()).toBe(s1);
    S().redo(); expect(doc()).toBe(s2);
  });
  it('export → import (twice) and the autosave draft keep the markers and span data', () => {
    AB('33.3');
    placeOn('A', 'B', 'M', 100);
    const st = S();
    const j1 = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    const p1 = parseProjectFile(j1);
    if (!p1.ok) throw new Error('rejected');
    S().loadProject(p1.data as Parameters<typeof initial.loadProject>[0]);
    expect(doc()).toBe(JSON.stringify({ e: st.elements, d: st.connectionDistances, o: st.connectionLabelOffsets, f: st.distanceFlags }));
    const s2 = S();
    const j2 = serializeProject(s2.elements, s2.style, s2.poleSizeScale, s2.consumerVariant, s2.connectionDistances, s2.connectionLabelOffsets, null, 'x', 1, 1, s2.electrical, s2.distanceFlags);
    expect(j2.replace(/"exportedAt": \d+/, '')).toBe(j1.replace(/"exportedAt": \d+/, ''));
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(s2))));
    if (!v.ok) throw new Error('draft rejected');
    S().loadProject(v.draft.data);
    expect(S().distanceFlags).toEqual(st.distanceFlags);
    // a delete after the round trip still restores exactly
    step(() => S().deleteElement('M'));
    expect(S().connectionDistances).toEqual({ A_B: '33.3' });
  });
  it('a file with malformed distance markers is refused with a message', () => {
    const r = parseProjectFile(JSON.stringify({ version: 1, elements: [], distanceFlags: { A_B: { estimated: 'yes' } } }));
    expect(r.ok).toBe(false);
  });
});
