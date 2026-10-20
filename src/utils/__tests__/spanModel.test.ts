import { beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import { isCableConsistent, normalizeCable, orphanSpanIds, reconcileCable, splitSpanInCables, withSpanProps } from '../spanModel';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import type { CableElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';

const S = () => useDrawingStore.getState();
const initial = S();
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });

let n = 0;
const gen = () => `n${++n}`;
beforeEach(() => { n = 0; });

const pole = (id: string, x = 0, y = 0): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2, ...extra });
const props = (a: string, b: string, p: Partial<SpanProps> = {}): SpanProps => ({ poles: [a, b], material: 'al', crossSectionMm2: 95, parallel: 1, system: '3ph4w', ...p });
const action = (fn: () => void) => { fn(); S().commitHistory(); };
const cableOf = (id: string) => S().elements.find((e) => e.id === id) as CableElement;
const propsAt = (c: CableElement, i: number) => c.spanProps?.[c.spanIds![i]];
const errs = (r: unknown) => (r as { errors: string[] }).errors;
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('span ids', () => {
  it('a cable without span ids (older project) gets one id per span; normalizing again changes nothing', () => {
    const c = normalizeCable(cable('c', ['A', 'B', 'C']), gen);
    expect(c.spanIds).toEqual(['n1', 'n2']);
    expect(isCableConsistent(c)).toBe(true);
    expect(normalizeCable(c, gen)).toBe(c);
  });

  it('drawing: every new span gets a new id, earlier spans keep theirs', () => {
    action(() => { ['A', 'B', 'C'].forEach((p, i) => S().addElement(pole(p, i * 100))); });
    action(() => { S().addElement(cable('c', ['A'])); });
    action(() => { S().updateElement('c', { poleIds: ['A', 'B'] }); });
    const first = cableOf('c').spanIds![0];
    action(() => { S().updateElement('c', { poleIds: ['A', 'B', 'C'] }); });
    expect(cableOf('c').spanIds).toHaveLength(2);
    expect(cableOf('c').spanIds![0]).toBe(first);
    expect(new Set(cableOf('c').spanIds).size).toBe(2);
  });
});

describe('suggesting the previous span while drawing', () => {
  const start = () => {
    const c0 = normalizeCable(cable('c', ['A', 'B']), gen);
    return withSpanProps(c0, c0.spanIds![0], props('A', 'B', { xOhmPerKm: 0.08, dataSource: 'report X', review: ['split'] }));
  };
  it('a span added at the end gets a copy of the previous span (marked inherited, without its review marks)', () => {
    const prev = start();
    const next = reconcileCable(prev, { ...prev, poleIds: ['A', 'B', 'C'] }, gen);
    expect(propsAt(next, 1)).toEqual({ ...props('B', 'C', { xOhmPerKm: 0.08, dataSource: 'report X' }), inherited: true });
    expect(propsAt(next, 0)).toEqual(propsAt(prev, 0));
  });
  it('the copy is not a link: changing the new span leaves the previous one as it was', () => {
    const prev = start();
    const next = reconcileCable(prev, { ...prev, poleIds: ['A', 'B', 'C'] }, gen);
    const edited = withSpanProps(next, next.spanIds![1], { ...propsAt(next, 1)!, crossSectionMm2: 50, inherited: false });
    expect(propsAt(edited, 0)!.crossSectionMm2).toBe(95);
    expect(propsAt(edited, 1)!.crossSectionMm2).toBe(50);
  });
  it('nothing is suggested when the previous span has no properties', () => {
    const prev = normalizeCable(cable('c', ['A', 'B']), gen);
    const next = reconcileCable(prev, { ...prev, poleIds: ['A', 'B', 'C'] }, gen);
    expect(next.spanProps).toBeUndefined();
  });
});

describe('placing a pole on a span (split)', () => {
  const three = () => {
    let c = normalizeCable(cable('c', ['A', 'B', 'C']), gen);
    c = withSpanProps(c, c.spanIds![0], props('A', 'B', { crossSectionMm2: 120 }));
    c = withSpanProps(c, c.spanIds![1], props('B', 'C', { crossSectionMm2: 70 }));
    return c;
  };
  it('the other spans keep id and properties; both parts of the split span get a copy marked for review', () => {
    const prev = three();
    const next = reconcileCable(prev, { ...prev, poleIds: ['A', 'M', 'B', 'C'] }, gen);
    expect(next.spanIds![2]).toBe(prev.spanIds![1]);
    expect(propsAt(next, 2)).toEqual(propsAt(prev, 1));
    expect(next.spanIds![0]).not.toBe(prev.spanIds![0]);
    expect(next.spanIds![1]).not.toBe(prev.spanIds![0]);
    expect(propsAt(next, 0)).toEqual({ ...props('A', 'M', { crossSectionMm2: 120 }), review: ['split'] });
    expect(propsAt(next, 1)).toEqual({ ...props('M', 'B', { crossSectionMm2: 120 }), review: ['split'] });
    expect(isCableConsistent(next)).toBe(true);
  });
  it('works for a cable drawn in the other direction and for several new poles at once', () => {
    let prev = normalizeCable(cable('c', ['C', 'B', 'A']), gen);
    prev = withSpanProps(prev, prev.spanIds![1], props('B', 'A', { crossSectionMm2: 35 }));
    const next = reconcileCable(prev, { ...prev, poleIds: ['C', 'B', 'X', 'Y', 'A'] }, gen);
    expect(next.spanIds![0]).toBe(prev.spanIds![0]);
    for (const i of [1, 2, 3]) expect(propsAt(next, i)).toMatchObject({ crossSectionMm2: 35, review: ['split'] });
  });
  it('every parallel cable on the span gets the pole, each in its own direction; other cables are untouched', () => {
    const els: DrawingElement[] = [cable('p1', ['A', 'B']), cable('p2', ['B', 'A', 'D']), cable('o', ['A', 'D'])];
    expect(splitSpanInCables(els, 'A', 'B', 'M')).toEqual([
      { id: 'p1', changes: { poleIds: ['A', 'M', 'B'] } },
      { id: 'p2', changes: { poleIds: ['B', 'M', 'A', 'D'] } },
    ]);
  });
  it('in the store: parallel cables are split together and keep their own (different) properties', () => {
    action(() => { ['A', 'B', 'M'].forEach((p, i) => S().addElement(pole(p, i * 100))); });
    action(() => { S().addElement(cable('p1', ['A', 'B'])); S().addElement(cable('p2', ['A', 'B'], { strokeColor: '#0000ff' })); });
    const p1 = cableOf('p1'), p2 = cableOf('p2');
    action(() => {
      S().updateElement('p1', withSpanProps(p1, p1.spanIds![0], props('A', 'B', { crossSectionMm2: 95 })));
      S().updateElement('p2', withSpanProps(p2, p2.spanIds![0], props('A', 'B', { crossSectionMm2: 50 })));
    });
    const before = plain(S().elements);
    action(() => { S().updateElements(splitSpanInCables(S().elements, 'A', 'B', 'M')); });
    expect(cableOf('p1').poleIds).toEqual(['A', 'M', 'B']);
    expect(cableOf('p2').poleIds).toEqual(['A', 'M', 'B']);
    expect([propsAt(cableOf('p1'), 0)!.crossSectionMm2, propsAt(cableOf('p1'), 1)!.crossSectionMm2]).toEqual([95, 95]);
    expect([propsAt(cableOf('p2'), 0)!.crossSectionMm2, propsAt(cableOf('p2'), 1)!.crossSectionMm2]).toEqual([50, 50]);
    // one undo step restores the span data exactly
    S().undo();
    expect(plain(S().elements)).toEqual(before);
    S().redo();
    expect(cableOf('p1').poleIds).toEqual(['A', 'M', 'B']);
  });
});

describe('deleting a pole (merge / trim)', () => {
  const setup = (second: Partial<SpanProps>) => {
    action(() => { ['A', 'B', 'C'].forEach((p, i) => S().addElement(pole(p, i * 100))); });
    action(() => { S().addElement(cable('c', ['A', 'B', 'C'])); });
    const c = cableOf('c');
    let next = withSpanProps(c, c.spanIds![0], props('A', 'B'));
    next = withSpanProps(next, c.spanIds![1], props('B', 'C', second));
    action(() => { S().updateElement('c', next); });
    action(() => { S().updateConnectionDistance('A_B', '30'); S().updateConnectionDistance('B_C', '40'); });
  };
  it('same properties on both sides: one span with those properties, no review mark; distances summed (as before)', () => {
    setup({});
    action(() => { S().deleteElement('B'); });
    const c = cableOf('c');
    expect(c.poleIds).toEqual(['A', 'C']);
    expect(propsAt(c, 0)).toEqual(props('A', 'C'));
    expect(S().connectionDistances.A_C).toBe('70');
  });
  it('different properties: the first span\'s properties, marked "merge-different", and BOTH original records kept (7.8)', () => {
    setup({ crossSectionMm2: 50 });
    action(() => { S().deleteElement('B'); });
    const { poles: _a, ...first } = props('A', 'B');
    const { poles: _b, ...second } = props('B', 'C', { crossSectionMm2: 50 });
    expect(propsAt(cableOf('c'), 0)).toEqual({ ...props('A', 'C'), review: ['merge-different'], mergedFrom: [first, second] });
  });
  it('deleting an end pole removes that span and its properties; undo brings them back', () => {
    setup({ crossSectionMm2: 50 });
    const before = plain(S().elements);
    action(() => { S().deleteElement('C'); });
    expect(cableOf('c').spanIds).toHaveLength(1);
    expect(Object.keys(cableOf('c').spanProps!)).toEqual([cableOf('c').spanIds![0]]);
    S().undo();
    expect(plain(S().elements)).toEqual(before);
  });
});

describe('editing a span', () => {
  it('changes only that span of that cable', () => {
    action(() => { ['A', 'B', 'C'].forEach((p, i) => S().addElement(pole(p, i * 100))); });
    action(() => { S().addElement(cable('c', ['A', 'B', 'C'])); S().addElement(cable('d', ['A', 'B'])); });
    const before = plain(S().elements);
    const c = cableOf('c');
    action(() => { S().updateElement('c', withSpanProps(c, c.spanIds![1], props('B', 'C'))); });
    const after = plain(S().elements) as DrawingElement[];
    after.forEach((el, i) => {
      if (el.id !== 'c') expect(el).toEqual(before[i]);
    });
    expect(propsAt(cableOf('c'), 0)).toBeUndefined();
    expect(propsAt(cableOf('c'), 1)).toEqual(props('B', 'C'));
    S().undo();
    expect(plain(S().elements)).toEqual(before);
  });
});

describe('a pole list changed elsewhere (e.g. by an older version of the app)', () => {
  it('records are re-attached by pole pair (marked "moved"); records that fit no span are kept, not dropped', () => {
    const c = cable('c', ['A', 'M', 'B', 'C'], {
      spanIds: ['s1', 's2'],
      spanProps: { s1: props('A', 'B'), s2: props('B', 'C', { crossSectionMm2: 70 }) },
    });
    const r = normalizeCable(c, gen);
    expect(isCableConsistent(r)).toBe(true);
    expect(r.spanIds).toHaveLength(3);
    expect(r.spanIds![2]).toBe('s2');
    expect(propsAt(r, 2)).toEqual({ ...props('B', 'C', { crossSectionMm2: 70 }), review: ['moved'] });
    expect(propsAt(r, 0)).toBeUndefined();
    expect(orphanSpanIds(r)).toEqual(['s1']);
    expect(r.spanProps!.s1).toEqual(props('A', 'B'));
  });
});

describe('saving, export / import, autosave', () => {
  const build = () => {
    action(() => { ['A', 'B', 'C'].forEach((p, i) => S().addElement(pole(p, i * 100))); });
    action(() => { S().addElement(cable('c', ['A', 'B', 'C'])); });
    const c = cableOf('c');
    action(() => { S().updateElement('c', withSpanProps(c, c.spanIds![0], props('A', 'B', { rOhmPerKm: 0.32, xOhmPerKm: 0.08, dataSource: 'manual' }))); });
    action(() => { S().updateElectricalSettings({ powerFactor: 0.9, conductorTempC: 70 }); });
  };
  it('export → import keeps span ids, span properties and the settings exactly', () => {
    build();
    const st = S();
    const json = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'T', 1, 1, st.electrical);
    const r = parseProjectFile(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.version).toBe(1);
    expect(plain(r.data.elements)).toEqual(plain(st.elements));
    expect(r.data.electrical).toEqual({ ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 });
    // load it back: identical document
    S().loadProject(r.data as Parameters<typeof initial.loadProject>[0]);
    expect(plain(S().elements)).toEqual(plain(st.elements));
    expect(S().electrical).toEqual(st.electrical);
  });
  it('autosave draft keeps them too', () => {
    build();
    const st = S();
    const v = validateDraft(plain(buildDraft(st)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    S().loadProject(v.draft.data);
    expect(plain(S().elements)).toEqual(plain(st.elements));
    expect(S().electrical).toEqual(st.electrical);
  });
  it('a settings change is one undo step', () => {
    build();
    S().undo();
    expect(S().electrical).toEqual(DEFAULT_ELECTRICAL);
    S().redo();
    expect(S().electrical.powerFactor).toBe(0.9);
  });
  it('invalid settings or span properties in a file are rejected with a message', () => {
    const base = { version: 1, elements: [pole('A'), pole('B'), cable('c', ['A', 'B'])] };
    const bad1 = parseProjectFile(JSON.stringify({ ...base, electrical: { powerFactor: 1.7 } }));
    expect(bad1.ok).toBe(false);
    if (!bad1.ok) expect(errs(bad1).join(' ')).toContain('powerFactor');
    const bad2 = parseProjectFile(JSON.stringify({ ...base, elements: [pole('A'), pole('B'), cable('c', ['A', 'B'], { spanIds: ['s'], spanProps: { s: { poles: ['A', 'B'], crossSectionMm2: -3 } } as never })] }));
    expect(bad2.ok).toBe(false);
    if (!bad2.ok) expect(errs(bad2).join(' ')).toContain('crossSectionMm2');
  });
  it('a version 1 file from before Stage 7 opens unchanged (span ids added, default settings)', () => {
    const old = { version: 1, elements: [pole('A'), pole('B'), cable('c', ['A', 'B'])], connectionDistances: { A_B: '35' } };
    const r = parseProjectFile(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { spanIds, ...rest } = r.data.elements[2] as CableElement;
    expect(rest).toEqual(old.elements[2]);
    expect(spanIds).toHaveLength(1);
    expect(r.data.connectionDistances).toEqual({ A_B: '35' });
    expect(r.data.electrical).toEqual(DEFAULT_ELECTRICAL);
  });
});

describe('version 2 files (branch feature/vd)', () => {
  // the shape feature/vd wrote (serializeProject v2 + ensureSpanIds)
  const v2 = (extra: Record<string, unknown> = {}) => ({
    version: 2,
    elements: [
      pole('A'), pole('B'), pole('C'),
      cable('c', ['A', 'B', 'C'], { spanIds: ['u1', 'u2'] }),
      { id: 'j', type: 'jumper', x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2, fromPoleId: 'A', toPoleId: 'C' },
    ],
    style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 },
    poleSizeScale: 1, consumerVariant: 'circle',
    connectionDistances: { A_B: '40', B_C: '?' },
    connectionLabelOffsets: {},
    spanProps: { u1: { cableTypeId: 'al_overhead_95', temperature: 70, tempStatus: 'confirmed' } },
    metadata: { id: 'v2p', name: 'from vd', exportedAt: 1 },
    ...extra,
  });
  it('is accepted, not rejected for its version number', () => {
    const r = parseProjectFile(JSON.stringify(v2()));
    expect(r.ok).toBe(true);
  });
  it('keeps the span ids, keeps every v2 span record (unused, marked for review), keeps the jumper; "?" distances become unset', () => {
    const r = parseProjectFile(JSON.stringify(v2()));
    if (!r.ok) throw new Error(errs(r).join());
    const c = r.data.elements.find((e) => e.id === 'c') as CableElement;
    expect(c.spanIds).toEqual(['u1', 'u2']);
    expect(c.spanProps).toEqual({ u1: { poles: ['A', 'B'], legacyV2: { cableTypeId: 'al_overhead_95', temperature: 70, tempStatus: 'confirmed' }, review: ['v2'] } });
    expect(r.data.elements.find((e) => e.id === 'j')).toMatchObject({ type: 'jumper', fromPoleId: 'A', toPoleId: 'C' });
    expect(r.data.connectionDistances).toEqual({ A_B: '40' });
    expect(r.data.version).toBe(1); // written back as the current format
  });
  it('a v2 span record that belongs to no span is not dropped: the file is refused with a message', () => {
    const r = parseProjectFile(JSON.stringify(v2({ spanProps: { zz: { tempStatus: 'unknown' } } })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(errs(r).join(' ')).toContain('zz');
  });
  it('a v2 project saved in the browser (IndexedDB) loads with its span data too', () => {
    const f = v2();
    S().loadProject({ ...(f as object), spanProps: f.spanProps } as Parameters<typeof initial.loadProject>[0]);
    const c = cableOf('c');
    expect(c.spanProps?.u1?.legacyV2).toEqual(f.spanProps.u1);
    expect(S().connectionDistances).toEqual({ A_B: '40' });
  });
  it('a jumper pointing to a missing pole is rejected with a message', () => {
    const f = v2();
    (f.elements[4] as { toPoleId: string }).toPoleId = 'ZZ';
    const r = parseProjectFile(JSON.stringify(f));
    expect(r.ok).toBe(false);
  });
});

describe('7.8 protecting saved projects', () => {
  const v2saved = () => ({
    elements: [pole('A'), pole('B'), pole('C'), cable('c', ['A', 'B', 'C'], { spanIds: ['w1'] })], // span list does not fit the poles
    style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle' as const,
    connectionDistances: { A_B: '30' }, spanProps: { w1: { tempStatus: 'confirmed', temperature: 70 } },
  });
  it('audit case: a saved v2 project whose span records cannot be placed is NOT opened (no silent drop); the canvas is unchanged', () => {
    action(() => { S().addElement(pole('X')); });
    const before = JSON.stringify(S().elements);
    const saved = v2saved();
    const copy = JSON.stringify(saved);
    expect(() => S().loadProject(saved as Parameters<typeof initial.loadProject>[0])).toThrow(/الإصدار 2/);
    expect(JSON.stringify(S().elements)).toBe(before);   // current drawing kept
    expect(JSON.stringify(saved)).toBe(copy);             // the saved data object is not modified
  });
  it('the same data in a file is refused by the import check, also without changing anything', () => {
    const r = parseProjectFile(JSON.stringify({ version: 2, ...v2saved() }));
    expect(r.ok).toBe(false);
  });
  it('documented behaviour (unchanged): unknown fields inside elements are kept; unknown top-level fields of a file are not', () => {
    const r = parseProjectFile(JSON.stringify({ version: 1, elements: [pole('A'), { ...pole('B'), extra: { a: 1 } }], somethingNew: 5 }));
    if (!r.ok) throw new Error('rejected');
    expect((r.data.elements[1] as unknown as { extra: unknown }).extra).toEqual({ a: 1 });
    expect('somethingNew' in r.data).toBe(false);
  });
});

describe('7.9 cable end links: kept with the cable, cleared when the end moves', () => {
  const setup = () => {
    action(() => { ['A', 'B', 'C', 'D'].forEach((p, i) => S().addElement(pole(p, i * 100))); S().addElement(cable('c', ['A', 'B', 'C'])); });
    action(() => { S().updateElement('c', { endLinks: { start: 'isolated', end: 'connected' } }); });
  };
  it('placing a pole in the middle keeps both settings', () => {
    setup();
    action(() => { S().updateElements(splitSpanInCables(S().elements, 'A', 'B', 'D')); });
    expect(cableOf('c').poleIds).toEqual(['A', 'D', 'B', 'C']);
    expect(cableOf('c').endLinks).toEqual({ start: 'isolated', end: 'connected' });
  });
  it('extending the cable at its end clears only that end\'s setting', () => {
    setup();
    action(() => { S().updateElement('c', { poleIds: ['A', 'B', 'C', 'D'] }); });
    expect(cableOf('c').endLinks).toEqual({ start: 'isolated' });
  });
  it('deleting the end pole clears that end\'s setting; deleting the other end too removes the field', () => {
    setup();
    action(() => { S().deleteElement('C'); });
    expect(cableOf('c').endLinks).toEqual({ start: 'isolated' });
    action(() => { S().addElement(pole('E', 500)); S().updateElement('c', { poleIds: ['E', ...cableOf('c').poleIds] }); });
    expect(cableOf('c').endLinks).toBeUndefined();
  });
  it('undo / redo, export → import (twice) and the autosave draft keep the settings exactly', () => {
    setup();
    const before = plain(S().elements);
    action(() => { S().updateElement('c', { endLinks: { end: 'isolated' } }); });
    const after = plain(S().elements);
    S().undo(); expect(plain(S().elements)).toEqual(before);
    S().redo(); expect(plain(S().elements)).toEqual(after);
    const st = S();
    const j = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    const r = parseProjectFile(j);
    if (!r.ok) throw new Error('rejected');
    expect(r.data.version).toBe(1);
    expect((r.data.elements.find((e) => e.id === 'c') as CableElement).endLinks).toEqual({ end: 'isolated' });
    S().loadProject(r.data as Parameters<typeof initial.loadProject>[0]);
    const j2 = serializeProject(S().elements, S().style, S().poleSizeScale, S().consumerVariant, S().connectionDistances, S().connectionLabelOffsets, null, 'x', 1, 1, S().electrical, S().distanceFlags);
    expect(j2.replace(/"exportedAt": \d+/, '')).toBe(j.replace(/"exportedAt": \d+/, ''));
    const v = validateDraft(plain(buildDraft(S())));
    if (!v.ok) throw new Error('draft');
    S().loadProject(v.draft.data);
    expect(cableOf('c').endLinks).toEqual({ end: 'isolated' });
  });
  it('a file with an unknown end setting is refused with a message', () => {
    const r = parseProjectFile(JSON.stringify({ version: 1, elements: [pole('A'), pole('B'), cable('c', ['A', 'B'], { endLinks: { start: 'maybe' } as never })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(errs(r).join(' ')).toContain('endLinks');
  });
});

describe('7.9 load model setting is saved with the project', () => {
  it('an older project (no setting) opens with constant current — never switched automatically', () => {
    const r = parseProjectFile(JSON.stringify({ version: 1, elements: [], electrical: { powerFactor: 0.9 } }));
    if (!r.ok) throw new Error('rejected');
    expect(r.data.electrical!.loadModel).toBe('constant-current');
  });
  it('constant power: one undo step, kept through export / import and the autosave draft', () => {
    action(() => { S().updateElectricalSettings({ loadModel: 'constant-power' }); });
    expect(S().electrical.loadModel).toBe('constant-power');
    S().undo(); expect(S().electrical.loadModel).toBe('constant-current');
    S().redo(); expect(S().electrical.loadModel).toBe('constant-power');
    const st = S();
    const r = parseProjectFile(serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags));
    if (!r.ok) throw new Error('rejected');
    expect(r.data.electrical!.loadModel).toBe('constant-power');
    const v = validateDraft(plain(buildDraft(st)));
    if (!v.ok) throw new Error('draft');
    expect(v.draft.data.electrical.loadModel).toBe('constant-power');
  });
  it('an unknown load model in a file is refused with a message', () => {
    const r = parseProjectFile(JSON.stringify({ version: 1, elements: [], electrical: { loadModel: 'constant-impedance' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(errs(r).join(' ')).toContain('loadModel');
  });
});
