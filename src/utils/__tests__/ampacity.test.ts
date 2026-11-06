import { describe, expect, it } from 'vitest';
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';
import type { CableTypeData, CableTypeRevision } from '../../types/cableType';
import { createCableType, editCableType, latestRevision, cableTypeRevisionProblem, spanCableTypeProblem } from '../cableTypeModel';
import { linkSpanCable } from '../spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';
import { pairKey } from '../cableSegments';
import { voltageView, runE2Study, type E2DocumentInput } from '../e2Presentation';
import { ampacityText, ampacityWarnings, spanMaxCurrentA } from '../ampacity';
import { vdOverlayLayout } from '../vdOverlayLayout';
import { cableFormFrom, emptyCableForm, planEdit, readCableForm } from '../cableTypeForm';
import { compareRevisions } from '../cableLibraryView';
import { serializeProject, parseProjectFile, DEFAULT_STYLE } from '../projectSerialization';
import { cableNameLayout } from '../cableNameLayout';
import { addCircle, addPoleTagObstacles, drawingObstacles, ObstacleSet, addRect, addSegment, segmentCost, type LayoutContext } from '../overlayLayout';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';

// The maximum allowable current of a library cable and the warning on spans whose E2 current is above it.
// ALL VALUES SYNTHETIC (R / X / loads / limits are test values, not data of any real cable).

const v = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'checked' } }) as never;
const data = (name: string, s: number, maxCurrentA?: number): CableTypeData => ({
  name, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: s }, neutral: { material: 'al', sectionMm2: 70 },
  r: v(0.32, 'ac'), x: v(0.08, 'ac-50hz'), rn: v(0.45, 'ac'), xn: v(0.08, 'ac-50hz'), source: { name: 'synthetic' },
  ...(maxCurrentA !== undefined ? { maxCurrentA } : {}),
} as CableTypeData);
const rev = (id: string, s: number, maxCurrentA?: number) => latestRevision(createCableType(id, data(`ABC 3x${s}+70 (synthetic)`, s, maxCurrentA), { now: 1 }));

const pole = (id: string, x: number, y: number, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x, y, width: 40, height: 40, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 }) as SymbolElement;
const sub = (id: string, poleId: string, color: string, amps: number) => ({ id, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: String(amps), strokeColor: color, fillColor: color, strokeWidth: 2 }) as ConsumerElement;
type C = { id: string; poles: string[]; color: string; revs: CableTypeRevision[]; props?: Partial<SpanProps> };
const doc = (cables: C[], subs: ConsumerElement[], extraPoles: SymbolElement[] = []): E2DocumentInput => {
  let els = normalizeElements([pole('T', 0, 0, 'transformer'), pole('A', 0, 200), pole('B', 0, 400), ...extraPoles,
    ...cables.map((c, j) => ({ id: c.id, type: 'cable', x: 0, y: 0, poleIds: c.poles, cableIndex: j, offset: 0, strokeColor: c.color, fillColor: 'none', strokeWidth: 2 }) as CableElement)]) as DrawingElement[];
  for (const c of cables) c.revs.forEach((r, i) => {
    els = els.map((e) => {
      if (e.id !== c.id) return e;
      const k = e as CableElement; const { id, props } = spanAt(k, i);
      return withSpanProps(k, id!, linkSpanCable({ ...(props ?? { poles: [k.poleIds[i], k.poleIds[i + 1]] }), system: '3ph4w', ...(c.props ?? {}) } as SpanProps, [k.poleIds[i], k.poleIds[i + 1]], r, 1));
    });
  });
  const dist: Record<string, string> = {};
  for (const c of cables) for (let i = 0; i < c.poles.length - 1; i++) dist[pairKey(c.poles[i], c.poles[i + 1])] = '100';
  return { elements: [...els, ...subs], connectionDistances: dist, distanceFlags: {}, electrical: { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, singlePhaseMode: 'balanced' } };
};
const RED = '#e11d48', BLUE = '#2563eb';
/** the per-cable current E2 gives the first span of `cableId` (highest phase) */
const e2Current = (d: E2DocumentInput, key: string) => {
  const s = voltageView(d).bySpan.get(key)!;
  return Math.max(...(['a', 'b', 'c'] as const).map((k) => s.perSetCurrentA[k]!));
};
/** one red cable T–A–B, the same library cable on both spans, three-phase loads at A and B */
const line = (limit?: number) => doc([{ id: 'k', poles: ['T', 'A', 'B'], color: RED, revs: [rev('ct120', 120, limit), rev('ct120', 120, limit)] }], [sub('uA', 'A', RED, 60), sub('uB', 'B', RED, 60)]);
const warned = (d: E2DocumentInput) => ampacityWarnings(d.elements, voltageView(d)).map((w) => w.key);

describe('maximum allowable current: the warning', () => {
  const I0 = e2Current(line(), 'k#0'); // the trunk span carries both loads
  const I1 = e2Current(line(), 'k#1');
  it('E2 gives a current on the spans (the test network is computed)', () => {
    expect(I0).toBeGreaterThan(0);
    expect(I0).toBeGreaterThan(I1);
  });
  it('1. current below the limit: no warning', () => {
    expect(warned(line(I0 + 1))).toEqual([]);
  });
  it('2. current equal to the limit: no warning', () => {
    const d = line(I0);
    // the limit is exactly E2's value for the trunk span: not over
    expect(warned(d)).toEqual([]);
  });
  it('3. current above the limit: a warning on that span, with the current and the limit', () => {
    const d = line(Math.floor(I0) - 1 > I1 ? Math.floor(I0) - 1 : (I0 + I1) / 2);
    const w = ampacityWarnings(d.elements, voltageView(d));
    expect(w.map((x) => x.key)).toEqual(['k#0']);
    expect(w[0].currentA).toBeCloseTo(I0, 9);
    expect(ampacityText({ currentA: 270.4, limitA: 250, provisional: false })).toBe('⚠ 270 A / 250 A');
  });
  it('4. no limit on the cable: no warning (never 0, never assumed)', () => {
    const d = line(undefined);
    expect(spanMaxCurrentA(d.elements.find((e) => e.id === 'k') as CableElement, 0)).toBeUndefined();
    expect(warned(d)).toEqual([]);
  });
  it('5. two cables with different limits on one network: each span against its own cable', () => {
    const d = doc([{ id: 'k', poles: ['T', 'A', 'B'], color: RED, revs: [rev('ct120', 120, 1000), rev('ct70', 70, 1)] }], [sub('uA', 'A', RED, 60), sub('uB', 'B', RED, 60)]);
    expect(warned(d)).toEqual(['k#1']);
  });
  it('6. a new limit in the library (a new revision): the span keeps its snapshot until it is updated', () => {
    const h1 = createCableType('ct120', data('ABC 3x120+70 (synthetic)', 120, 1000), { now: 1 });
    const { history: h2, changes } = editCableType(h1, { maxCurrentA: 1 }, { now: 2 });
    expect(changes).toEqual(['maxCurrentA']);
    expect(h2.revisions.map((r) => r.maxCurrentA)).toEqual([1000, 1]);
    const old = doc([{ id: 'k', poles: ['T', 'A', 'B'], color: RED, revs: [h2.revisions[0], h2.revisions[0]] }], [sub('uA', 'A', RED, 60), sub('uB', 'B', RED, 60)]);
    const upd = doc([{ id: 'k', poles: ['T', 'A', 'B'], color: RED, revs: [latestRevision(h2), latestRevision(h2)] }], [sub('uA', 'A', RED, 60), sub('uB', 'B', RED, 60)]);
    expect(warned(old)).toEqual([]);
    expect(warned(upd)).toEqual(['k#0', 'k#1']);
    // removing the limit (null): a new revision without it
    const { history: h3 } = editCableType(h2, { maxCurrentA: null }, { now: 3 });
    expect(latestRevision(h3).maxCurrentA).toBeUndefined();
  });
  it('7. kept in the snapshot of the span and read back from a saved project; old records without it stay valid', () => {
    const d = line(123.5);
    const k = d.elements.find((e) => e.id === 'k') as CableElement;
    expect(spanAt(k, 0).props!.cableType!.snapshot.maxCurrentA).toBe(123.5);
    const parsed = parseProjectFile(serializeProject(d.elements as DrawingElement[], DEFAULT_STYLE, 1, 'circle', d.connectionDistances, {}, null, 'synthetic'));
    expect(parsed.ok).toBe(true);
    const k2 = (parsed as { data: { elements: DrawingElement[] } }).data.elements.find((e) => e.id === 'k') as CableElement;
    expect(spanAt(k2, 0).props!.cableType!.snapshot.maxCurrentA).toBe(123.5);
    // a record written before the field existed: valid as it is, nothing added
    const before = rev('ctOld', 120);
    expect('maxCurrentA' in before).toBe(false);
    expect(cableTypeRevisionProblem(before)).toBeNull();
    expect(spanCableTypeProblem({ typeId: 'ctOld', revision: 1, snapshot: before })).toBeNull();
    // an invalid stored value is rejected (never corrected)
    expect(cableTypeRevisionProblem({ ...before, maxCurrentA: 0 })).toBe('maxCurrentA');
    expect(cableTypeRevisionProblem({ ...before, maxCurrentA: -5 })).toBe('maxCurrentA');
    expect(cableTypeRevisionProblem({ ...before, maxCurrentA: '250' })).toBe('maxCurrentA');
  });
  it('8. E2 and the voltage drop are the same with or without a limit on the cables', () => {
    const strip = (r: unknown) => JSON.stringify(r, (k, x) => (k === 'inputs' || k === 'snapshot' ? undefined : x));
    expect(strip(runE2Study(line(undefined)).circuits)).toBe(strip(runE2Study(line(1)).circuits));
    const a = voltageView(line(undefined)), b = voltageView(line(1));
    for (const [key, s] of a.bySpan) {
      const t = b.bySpan.get(key)!;
      expect(t.dropV).toBe(s.dropV); expect(t.currentA).toEqual(s.currentA); expect(t.perSetCurrentA).toEqual(s.perSetCurrentA);
    }
    for (const [pid, list] of a.byPole) expect(b.byPole.get(pid)!.map((p) => p.percent)).toEqual(list.map((p) => p.percent));
  });
  it('9. parallel: E2\'s current per cable assembly (|I| / parallel) is compared, not the span total', () => {
    const one = doc([{ id: 'k', poles: ['T', 'A'], color: RED, revs: [rev('ct120', 120)], props: { parallel: 1 } }], [sub('uA', 'A', RED, 60)]);
    const two = doc([{ id: 'k', poles: ['T', 'A'], color: RED, revs: [rev('ct120', 120)], props: { parallel: 2 } }], [sub('uA', 'A', RED, 60)]);
    const s1 = voltageView(one).bySpan.get('k#0')!, s2 = voltageView(two).bySpan.get('k#0')!;
    expect(s2.perSetCurrentA.a!).toBeCloseTo(s2.currentA.a! / 2, 9);
    const total = s2.currentA.a!, perSet = s2.perSetCurrentA.a!;
    // a limit between the per-cable current and the total: two cables in parallel are each under it
    const lim = (perSet + total) / 2;
    const twoLim = doc([{ id: 'k', poles: ['T', 'A'], color: RED, revs: [rev('ct120', 120, lim)], props: { parallel: 2 } }], [sub('uA', 'A', RED, 60)]);
    const oneLim = doc([{ id: 'k', poles: ['T', 'A'], color: RED, revs: [rev('ct120', 120, lim)], props: { parallel: 1 } }], [sub('uA', 'A', RED, 60)]);
    expect(warned(twoLim)).toEqual([]);
    expect(warned(oneLim)).toEqual(['k#0']);
    expect(s1.perSetCurrentA.a!).toBeCloseTo(s1.currentA.a!, 9);
    // parallel cables of another colour on the same poles: another circuit, its own current and its own cable
    const both = doc([
      { id: 'k', poles: ['T', 'A'], color: RED, revs: [rev('ct120', 120, 1)] },
      { id: 'm', poles: ['T', 'A'], color: BLUE, revs: [rev('ct95', 95, 100000)] },
    ], [sub('uA', 'A', RED, 60), sub('uA2', 'A', BLUE, 10)]);
    const vb = voltageView(both);
    expect(warned(both)).toEqual(['k#0']);
    expect(vb.bySpan.get('m#0')!.perSetCurrentA.a!).toBeLessThan(vb.bySpan.get('k#0')!.perSetCurrentA.a!);
  });
  it('10. drawn by the overlay layout (drawing, preview and PDF draw the same layout): beside its span, covering nothing', () => {
    const d = line((I0 + I1) / 2 > I1 ? Math.min(I0 - 0.5, (I0 + I1) / 2) : I0 - 0.5);
    const view = voltageView(d);
    const ctx: LayoutContext = { poleRadius: 20, consumerScale: 1, connectionDistances: d.connectionDistances, distanceTextScale: 1, showDistances: true, arrowSize: 8 };
    const names = cableNameLayout(d.elements as DrawingElement[], { ctx, fs: 9 });
    const L = vdOverlayLayout(d.elements as DrawingElement[], view, { ctx, fs: 11, texts: names });
    expect(L.currentWarnings.map((c) => c.key)).toEqual(['k#0']);
    const c = L.currentWarnings[0];
    expect(c.text).toMatch(/^⚠ \d+(\.\d+)? A \/ [\d.]+ A$/);
    // nothing under it: the drawing, the names, the pole numbers, the badges, the other marks
    const set = drawingObstacles(d.elements as DrawingElement[], ctx);
    addPoleTagObstacles(d.elements as DrawingElement[], ctx, set);
    for (const n of names) addSegment(set, n.a, n.b, n.half);
    for (const b of L.badges) addRect(set, { x: b.x, y: b.y, w: b.w, h: b.h });
    for (const t of L.tags) addRect(set, { x: t.x - t.fontSize * 2, y: t.y - t.fontSize, w: t.fontSize * 2, h: t.fontSize * 1.4 });
    // the transformer as drawn (two circles and the rectangle on their right), not only a pole circle
    const T = d.elements.find((e) => e.id === 'T')!;
    addCircle(set, T.x, T.y - 16, 21); addCircle(set, T.x, T.y + 16, 21); addRect(set, { x: T.x + 24, y: T.y - 37, w: 20, h: 74 });
    expect(set.cost({ x: c.x, y: c.y, w: c.w, h: c.h })).toBe(0);
    // every other mark is where it is without the warning
    const noLimit = vdOverlayLayout(line(undefined).elements as DrawingElement[], voltageView(line(undefined)), { ctx, fs: 11, texts: cableNameLayout(line(undefined).elements as DrawingElement[], { ctx, fs: 9 }) });
    expect(noLimit.currentWarnings).toEqual([]);
    expect(JSON.stringify({ ...L, currentWarnings: [], cost: 0 })).toBe(JSON.stringify({ ...noLimit, currentWarnings: [], cost: 0 }));
    void ObstacleSet; void segmentCost;
  });
});

describe('maximum allowable current: the library form', () => {
  const base = { ...emptyCableForm(), name: 'ABC 3x120 (synthetic)', construction: 'abc' as const, phaseConductors: '3', neutralConductors: '1' };
  it('empty: not stated (undefined, never 0); a positive number in A is kept; 0, negative and text are errors', () => {
    expect(emptyCableForm().maxCurrentA).toBe('');
    expect(readCableForm(base).data!.maxCurrentA).toBeUndefined();
    expect('maxCurrentA' in readCableForm(base).data!).toBe(false);
    expect(readCableForm({ ...base, maxCurrentA: '250' }).data!.maxCurrentA).toBe(250);
    expect(readCableForm({ ...base, maxCurrentA: '262,5' }).data!.maxCurrentA).toBe(262.5);
    expect(readCableForm({ ...base, maxCurrentA: '0' }).errors).toEqual([{ field: 'maxCurrentA', code: 'positive' }]);
    expect(readCableForm({ ...base, maxCurrentA: '-3' }).errors).toEqual([{ field: 'maxCurrentA', code: 'positive' }]);
    expect(readCableForm({ ...base, maxCurrentA: 'abc' }).errors).toEqual([{ field: 'maxCurrentA', code: 'number' }]);
  });
  it('edit: shown as stored; a change (or clearing it) is one new revision; compared in the history', () => {
    const r1 = rev('ct120', 120, 250);
    expect(cableFormFrom(r1).maxCurrentA).toBe('250');
    expect(cableFormFrom(rev('ct120', 120)).maxCurrentA).toBe('');
    const next = readCableForm({ ...cableFormFrom(r1), maxCurrentA: '270' }).data!;
    expect(planEdit(r1, next)).toMatchObject({ edit: { maxCurrentA: 270 }, revisions: 1 });
    const cleared = readCableForm({ ...cableFormFrom(r1), maxCurrentA: '' }).data!;
    expect(planEdit(r1, cleared)).toMatchObject({ edit: { maxCurrentA: null }, revisions: 1 });
    expect(planEdit(r1, readCableForm(cableFormFrom(r1)).data!).revisions).toBe(0);
    expect(compareRevisions(r1, next).find((x) => x.field === 'maxCurrentA')).toMatchObject({ status: 'changed', before: 250, after: 270 });
  });
});
