import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore, historyGestureEnd } from '../drawingStore';
import { createCableLibraryController, type CableLibraryController } from '../cableLibraryStore';
import { applyLibraryRevisions, installCableLibrarySync } from '../cableLibrarySync';
import type { CableLibraryBackend } from '../../utils/cableLibraryStorage';
import type { CableTypeData, CableTypeRevision } from '../../types/cableType';
import type { CableElement, ConsumerElement, DrawingElement, SymbolElement } from '../../types/drawing';
import { linkSpanCable, syncSpansToRevision } from '../../utils/spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../../utils/spanModel';
import { setCableTypeOverride, effectiveCableType } from '../../utils/cableTypeModel';
import { pairKey } from '../../utils/cableSegments';
import { voltageView, type E2DocumentInput } from '../../utils/e2Presentation';
import { ampacityWarnings } from '../../utils/ampacity';
import { buildDraft, validateDraft } from '../../utils/autosave';
import { parseProjectFile, serializeProject, DEFAULT_STYLE } from '../../utils/projectSerialization';
import { saveCableForm } from '../../components/cables/CableTypeEditor';
import { cableFormFrom, readCableForm } from '../../utils/cableTypeForm';

// Automatic synchronization of the open project with the cable library. ALL VALUES SYNTHETIC.

const S = () => useDrawingStore.getState();
const initial = S();
let stop: (() => void) | undefined;
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
afterEach(() => { stop?.(); stop = undefined; });

/** an in-memory library backend; `fail` makes the next writes fail */
const memory = () => {
  const data = new Map<string, unknown>();
  const fail: { set?: Error } = {};
  const b: CableLibraryBackend = {
    get: async <T,>(k: string) => (data.has(k) ? (structuredClone(data.get(k)) as T) : undefined),
    set: async (k, v) => { if (fail.set) throw fail.set; data.set(k, structuredClone(v)); },
    keys: async () => [...data.keys()],
  };
  return { b, fail };
};
let ids = 0;
const controller = (b: CableLibraryBackend) => createCableLibraryController({ backend: b, now: () => 1000 + ids, newId: () => `ct_s${++ids}` });
const val = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'checked' } }) as never;
const data = (name: string, section: number, r = 0.32): CableTypeData => ({
  name, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: section }, neutral: { material: 'al', sectionMm2: 70 },
  r: val(r, 'ac'), x: val(0.08, 'ac-50hz'), rn: val(0.45, 'ac'), xn: val(0.08, 'ac-50hz'), source: { name: 'synthetic' },
});

const pole = (id: string, x: number, y: number, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x, y, width: 40, height: 40, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 }) as SymbolElement;
const sub = (id: string, poleId: string, color: string, amps: number) => ({ id, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: String(amps), strokeColor: color, fillColor: color, strokeWidth: 2 }) as ConsumerElement;
const RED = '#e11d48', BLUE = '#2563eb';

/** T–A–B in red (both spans linked to `red`), T–A in blue (linked to `blue`), loads at A and B */
const project = (red: CableTypeRevision, blue: CableTypeRevision, redProps: Record<string, unknown> = {}) => {
  let els = normalizeElements([pole('T', 0, 0, 'transformer'), pole('A', 0, 200), pole('B', 0, 400),
    { id: 'k', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A', 'B'], cableIndex: 0, offset: 0, strokeColor: RED, fillColor: 'none', strokeWidth: 2 } as CableElement,
    { id: 'm', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 1, offset: 6, strokeColor: BLUE, fillColor: 'none', strokeWidth: 2 } as CableElement]) as DrawingElement[];
  const link = (cid: string, i: number, r: CableTypeRevision, extra: Record<string, unknown> = {}) => {
    els = els.map((e) => {
      if (e.id !== cid) return e;
      const c = e as CableElement; const { id, props } = spanAt(c, i);
      return withSpanProps(c, id!, linkSpanCable({ ...(props ?? { poles: [c.poleIds[i], c.poleIds[i + 1]] }), system: '3ph4w', ...extra } as never, [c.poleIds[i], c.poleIds[i + 1]], r, 1));
    });
  };
  link('k', 0, red, redProps); link('k', 1, red, redProps); link('m', 0, blue);
  els = [...els, sub('uA', 'A', RED, 100), sub('uB', 'B', RED, 90), sub('uM', 'A', BLUE, 40)];
  const dist: Record<string, string> = { [pairKey('T', 'A')]: '100', [pairKey('A', 'B')]: '120' };
  useDrawingStore.getState().loadProject({ elements: els, style: DEFAULT_STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: dist });
};
const doc = (): E2DocumentInput => ({ elements: S().elements, connectionDistances: S().connectionDistances, distanceFlags: S().distanceFlags, electrical: S().electrical });
const linkOf = (cid: string, i: number) => spanAt(S().elements.find((e) => e.id === cid) as CableElement, i).props!.cableType!;
const revs = () => [linkOf('k', 0).revision, linkOf('k', 1).revision, linkOf('m', 0).revision];

/** a library with two cable types and the project linked to their first revisions; the sync on */
const setup = async () => {
  const mem = memory();
  const c = controller(mem.b);
  const red = await c.create(data('ABC 3x120+70 (synthetic)', 120));
  const blue = await c.create(data('ABC 3x95+70 (synthetic)', 95));
  project(red, blue);
  stop = installCableLibrarySync(c, () => useDrawingStore.getState());
  return { c, red, blue, mem };
};
const editVia = (c: CableLibraryController, prev: CableTypeRevision, change: (f: ReturnType<typeof cableFormFrom>) => void) => {
  const f = cableFormFrom(prev); change(f);
  return saveCableForm(c, prev, readCableForm(f).data!, '');
};

describe('automatic synchronization of the open project with the cable library', () => {
  it('1. adding a maximum allowable current: every linked span on the new revision; the warning appears / goes at once', async () => {
    const { c, red } = await setup();
    expect(revs()).toEqual([1, 1, 1]);
    expect(ampacityWarnings(S().elements, voltageView(doc()))).toEqual([]);
    const out = await editVia(c, red, (f) => { f.maxCurrentA = '150'; });
    expect(out).toMatchObject({ ok: true, revision: 2 });
    expect(revs()).toEqual([2, 2, 1]);
    expect(linkOf('k', 0).snapshot.maxCurrentA).toBe(150);
    // the trunk span carries 190 A (100 + 90), the second 90 A
    expect(ampacityWarnings(S().elements, voltageView(doc())).map((w) => w.key)).toEqual(['k#0']);
    const r2 = (await c.history(red.id)).revisions[1];
    await editVia(c, r2, (f) => { f.maxCurrentA = '400'; });
    expect(revs()).toEqual([3, 3, 1]);
    expect(ampacityWarnings(S().elements, voltageView(doc()))).toEqual([]);
  });
  it('2. a new R in the library: E2 and the voltage drop use it at once', async () => {
    const { c, red } = await setup();
    const v0 = voltageView(doc());
    const before = v0.bySpan.get('k#0')!.dropV!, blueBefore = v0.bySpan.get('m#0')!.dropV;
    await editVia(c, red, (f) => { f.r = { ...f.r, value: '0.64' }; });
    expect(linkOf('k', 0).snapshot.r.value).toBe(0.64);
    const v1 = voltageView(doc());
    expect(v1.bySpan.get('k#0')!.dropV!).toBeGreaterThan(before * 1.5);
    // the blue circuit (another cable type) is calculated as before
    expect(v1.bySpan.get('m#0')!.dropV!).toBeCloseTo(blueBefore!, 9); // the solver's last digits only
  });
  it('2b. a new X: the voltage drop changes with it', async () => {
    const { c, red } = await setup();
    const before = voltageView(doc()).bySpan.get('k#0')!.dropV!;
    await editVia(c, red, (f) => { f.x = { ...f.x, value: '0.30' }; });
    expect(linkOf('k', 1).snapshot.x.value).toBe(0.3);
    expect(voltageView(doc()).bySpan.get('k#0')!.dropV!).not.toBe(before);
  });
  it('3. a new conductor section / material / construction: in the spans\' cable data', async () => {
    const { c, red } = await setup();
    await editVia(c, red, (f) => { f.phaseSection = '150'; f.neutralSection = '95'; f.neutralMaterial = 'alloy'; });
    expect(linkOf('k', 0).snapshot.phase.sectionMm2).toBe(150);
    expect(linkOf('k', 1).snapshot.neutral).toEqual({ material: 'alloy', sectionMm2: 95 });
    expect(linkOf('k', 0).snapshot.name).toBe('ABC 3x120+70 (synthetic)');
  });
  it('4. several spans of one cable type move together (one store update, the same revision)', async () => {
    const { c, red } = await setup();
    let updates = 0;
    const unsub = useDrawingStore.subscribe((s, p) => { if (s.elements !== p.elements) updates++; });
    await editVia(c, red, (f) => { f.maxCurrentA = '200'; });
    unsub();
    expect(updates).toBe(1);
    expect(linkOf('k', 0).revision).toBe(2);
    expect(linkOf('k', 1).revision).toBe(2);
    expect(linkOf('k', 0).snapshot).toEqual(linkOf('k', 1).snapshot);
  });
  it('5. other cable types are left as they are (the parallel blue circuit)', async () => {
    const { c, red } = await setup();
    const blueBefore = JSON.stringify(S().elements.find((e) => e.id === 'm'));
    await editVia(c, red, (f) => { f.maxCurrentA = '200'; });
    expect(JSON.stringify(S().elements.find((e) => e.id === 'm'))).toBe(blueBefore);
    // and an edit of the blue type moves only the blue span
    const redBefore = JSON.stringify(S().elements.find((e) => e.id === 'k'));
    const { blue } = { blue: (await c.history(linkOf('m', 0).typeId)).revisions[0] };
    await editVia(c, blue, (f) => { f.maxCurrentA = '300'; });
    expect(revs()).toEqual([2, 2, 2]);
    expect(JSON.stringify(S().elements.find((e) => e.id === 'k'))).toBe(redBefore);
  });
  it('6. the project\'s overrides stay; the values not overridden follow the library', async () => {
    const { c, red } = await setup();
    // the first red span has its own R for this project
    const k = S().elements.find((e) => e.id === 'k') as CableElement;
    const { id, props } = spanAt(k, 0);
    const own = { value: 0.5, unit: 'ohm/km', basis: 'ac', verification: { status: 'checked' }, source: { name: 'site measurement (synthetic)' } } as never;
    S().updateElement('k', { spanProps: withSpanProps(k, id!, setCableTypeOverride(props!, 'r', own)).spanProps });
    S().saveHistory();
    await editVia(c, red, (f) => { f.r = { ...f.r, value: '0.64' }; f.x = { ...f.x, value: '0.30' }; f.maxCurrentA = '210'; });
    const ct0 = linkOf('k', 0), ct1 = linkOf('k', 1);
    // the data, then the verifications the form keeps: the spans are on the library's last revision
    const last = (await c.history(red.id)).revisions.at(-1)!.revision;
    expect(last).toBeGreaterThan(1);
    expect([ct0.revision, ct1.revision]).toEqual([last, last]);
    expect(ct0.overrides).toEqual({ r: own });
    expect(effectiveCableType(ct0).data.r.value).toBe(0.5);   // overridden: kept
    expect(effectiveCableType(ct0).data.x.value).toBe(0.3);   // not overridden: the library's
    expect(ct0.snapshot.r.value).toBe(0.64);                  // the snapshot is the library's
    expect(effectiveCableType(ct0).data.maxCurrentA).toBe(210); // the new field
    expect(effectiveCableType(ct1).data.r.value).toBe(0.64);
  });
  it('7. nothing else of the drawing changes: poles, geometry, colours, lengths, parallel, loads, ids, settings, other span fields', async () => {
    const mem = memory();
    const c = controller(mem.b);
    const red = await c.create(data('ABC 3x120+70 (synthetic)', 120));
    const blue = await c.create(data('ABC 3x95+70 (synthetic)', 95));
    project(red, blue, { parallel: 2, note: 'kept (synthetic)' });
    stop = installCableLibrarySync(c, () => useDrawingStore.getState());
    const strip = (e: DrawingElement) => {
      if (e.type !== 'cable') return e;
      const sp = Object.fromEntries(Object.entries((e as CableElement).spanProps ?? {}).map(([k, p]) => { const { cableType: _ct, ...rest } = p as unknown as Record<string, unknown>; return [k, rest]; }));
      return { ...e, spanProps: sp };
    };
    const before = { els: JSON.stringify(S().elements.map(strip)), d: JSON.stringify(S().connectionDistances), el: JSON.stringify(S().electrical), f: JSON.stringify(S().distanceFlags) };
    await editVia(c, red, (f) => { f.phaseSection = '150'; f.maxCurrentA = '200'; });
    expect(revs()).toEqual([2, 2, 1]);
    expect(JSON.stringify(S().elements.map(strip))).toBe(before.els);
    expect(JSON.stringify(S().connectionDistances)).toBe(before.d);
    expect(JSON.stringify(S().electrical)).toBe(before.el);
    expect(JSON.stringify(S().distanceFlags)).toBe(before.f);
    expect(linkOf('k', 0).typeId).toBe(red.id); // the identity is never changed
  });
  it('8 / 9. one save = one undo step: undo gives back the previous revision, redo the new one', async () => {
    const { c, red } = await setup();
    const steps = S().history.length;
    // the editor saves the data, then a verification: two revisions, one save for the person
    await editVia(c, red, (f) => { f.maxCurrentA = '150'; f.r = { ...f.r, status: 'unverified' }; });
    expect(revs()).toEqual([3, 3, 1]);
    expect(S().history.length).toBe(steps + 1);
    S().undo();
    expect(revs()).toEqual([1, 1, 1]);
    expect(linkOf('k', 0).snapshot.maxCurrentA).toBeUndefined();
    expect(ampacityWarnings(S().elements, voltageView(doc()))).toEqual([]);
    S().redo();
    expect(revs()).toEqual([3, 3, 1]);
    expect(ampacityWarnings(S().elements, voltageView(doc())).map((w) => w.key)).toEqual(['k#0']);
  });
  it('10. autosave and reopening keep the new revision', async () => {
    const { c, red } = await setup();
    await editVia(c, red, (f) => { f.maxCurrentA = '150'; });
    // the draft autosave writes, read back
    const draft = JSON.parse(JSON.stringify(buildDraft(S(), 5)));
    const v = validateDraft(draft);
    expect(v.ok).toBe(true);
    const k = (draft.data.elements as DrawingElement[]).find((e) => e.id === 'k') as CableElement;
    expect(spanAt(k, 0).props!.cableType!.revision).toBe(2);
    // the project file, saved and opened again
    const parsed = parseProjectFile(serializeProject(S().elements, S().style, 1, 'circle', S().connectionDistances, {}, null, 'synthetic'));
    expect(parsed.ok).toBe(true);
    const els = (parsed as { data: { elements: DrawingElement[] } }).data.elements;
    useDrawingStore.getState().loadProject({ elements: els, style: DEFAULT_STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: S().connectionDistances });
    expect(revs()).toEqual([2, 2, 1]);
    expect(linkOf('k', 1).snapshot.maxCurrentA).toBe(150);
  });
  it('11. an imported project linked to a cable type this library does not have keeps its own snapshots', async () => {
    const mem = memory();
    const c = controller(mem.b);
    const other = controller(memory().b); // another device's library
    const foreign = await other.create(data('ABC 3x120+70 elsewhere (synthetic)', 120));
    const local = await c.create(data('ABC 3x95+70 (synthetic)', 95));
    project(foreign, local);
    stop = installCableLibrarySync(c, () => useDrawingStore.getState());
    const kBefore = JSON.stringify(S().elements.find((e) => e.id === 'k'));
    await editVia(c, local, (f) => { f.maxCurrentA = '100'; });
    expect(JSON.stringify(S().elements.find((e) => e.id === 'k'))).toBe(kBefore);
    expect(revs()).toEqual([1, 1, 2]);
    expect(voltageView(doc()).bySpan.get('k#0')!.computable).toBe(true);
  });
  it('12. a failed save changes nothing in the project; a sync that cannot be worked out writes nothing', async () => {
    const { c, red, mem } = await setup();
    const before = JSON.stringify(S().elements), steps = S().history.length;
    mem.fail.set = new Error('disk full (synthetic)');
    const out = await editVia(c, red, (f) => { f.maxCurrentA = '150'; });
    expect(out.ok).toBe(false);
    expect(JSON.stringify(S().elements)).toBe(before);
    expect(S().history.length).toBe(steps);
    // all or nothing: a revision that is not valid moves no span at all
    const bad = { ...red, revision: 9, maxCurrentA: -1 } as CableTypeRevision;
    expect(syncSpansToRevision(S().elements, bad).updates).toEqual([]);
    expect(applyLibraryRevisions(() => S(), [bad])).toEqual([]);
    expect(JSON.stringify(S().elements)).toBe(before);
    // never backwards: an older revision moves nothing
    const r2 = { ...red, revision: 2 } as CableTypeRevision;
    applyLibraryRevisions(() => S(), [r2]);
    expect(revs()).toEqual([2, 2, 1]);
    expect(applyLibraryRevisions(() => S(), [red])).toEqual([]);
    expect(revs()).toEqual([2, 2, 1]);
  });
  it('13. older projects: spans with their own values (no library link) and spans with an unreadable link are left as they are', async () => {
    const mem = memory();
    const c = controller(mem.b);
    const red = await c.create(data('ABC 3x120+70 (synthetic)', 120));
    const blue = await c.create(data('ABC 3x95+70 (synthetic)', 95));
    project(red, blue);
    // span k#1: an old record with its own values only (no cableType); span m#0: a link whose snapshot is broken
    const k = S().elements.find((e) => e.id === 'k') as CableElement;
    const { id: s1, props: p1 } = spanAt(k, 1);
    const { cableType: _ct, ...own } = p1!;
    const m = S().elements.find((e) => e.id === 'm') as CableElement;
    const { id: sm, props: pm } = spanAt(m, 0);
    const broken = { ...pm!, cableType: { ...pm!.cableType!, typeId: red.id, snapshot: { ...pm!.cableType!.snapshot, id: 'other' } } };
    S().updateElements([{ id: 'k', changes: { spanProps: withSpanProps(k, s1!, { ...own, r: 0.4 } as never).spanProps } }, { id: 'm', changes: { spanProps: withSpanProps(m, sm!, broken as never).spanProps } }]);
    S().saveHistory();
    stop = installCableLibrarySync(c, () => useDrawingStore.getState());
    const kSpan1 = JSON.stringify(spanAt(S().elements.find((e) => e.id === 'k') as CableElement, 1).props);
    const mSpan = JSON.stringify(spanAt(S().elements.find((e) => e.id === 'm') as CableElement, 0).props);
    await editVia(c, red, (f) => { f.maxCurrentA = '150'; });
    expect(linkOf('k', 0).revision).toBe(2);
    expect(JSON.stringify(spanAt(S().elements.find((e) => e.id === 'k') as CableElement, 1).props)).toBe(kSpan1);
    expect(JSON.stringify(spanAt(S().elements.find((e) => e.id === 'm') as CableElement, 0).props)).toBe(mSpan);
  });
  it('a listener that fails never fails the library save; after unsubscribe nothing is moved', async () => {
    const { c, red } = await setup();
    const off = c.subscribe(() => { throw new Error('listener (synthetic)'); });
    stop?.(); stop = undefined;
    const out = await editVia(c, red, (f) => { f.maxCurrentA = '150'; });
    off();
    expect(out.ok).toBe(true);
    expect(revs()).toEqual([1, 1, 1]);
  });
});

// ---------- opening a project: moved to the latest revisions of the library before it is loaded ----------
import { withLatestLibraryRevisions } from '../cableLibrarySync';
import { restoreDraft, type DraftStorage, type RestoreGuard } from '../../utils/autosave';
import { applyImport, type ImportPlan } from '../../utils/projectImport';

describe('opening a project: the latest revisions of the library', () => {
  /** a library where the red type has 3 revisions (the last: 250 A) and the blue one 1; a project saved on revision 1 of both */
  const savedOnOld = async () => {
    const mem = memory();
    const c = controller(mem.b);
    const red = await c.create(data('ABC 3x120+70 (synthetic)', 120));
    const blue = await c.create(data('ABC 3x95+70 (synthetic)', 95));
    project(red, blue, { parallel: 2 });
    // project-specific R on the first red span
    const k = S().elements.find((e) => e.id === 'k') as CableElement;
    const { id, props } = spanAt(k, 0);
    const own = { value: 0.5, unit: 'ohm/km', basis: 'ac', verification: { status: 'checked' }, source: { name: 'site (synthetic)' } } as never;
    S().updateElement('k', { spanProps: withSpanProps(k, id!, setCableTypeOverride(props!, 'r', own)).spanProps });
    S().saveHistory();
    const saved = JSON.parse(JSON.stringify(S().elements)) as DrawingElement[];
    // the library moves on while the project is closed
    await c.edit(red.id, 1, { x: val(0.3, 'ac-50hz') });
    await c.edit(red.id, 2, { maxCurrentA: 250 });
    return { c, red, blue, saved, own, mem };
  };
  const rev = (els: DrawingElement[], cid: string, i: number) => spanAt(els.find((e) => e.id === cid) as CableElement, i).props?.cableType;

  it('O1. an older revision in the project: every span of that type moves to the latest; overrides, parallel, geometry and span ids kept', async () => {
    const { c, saved, own } = await savedOnOld();
    const { elements, spans } = await withLatestLibraryRevisions(saved, c, 7);
    expect(spans.map((s) => `${s.cableId}#${s.index} ${s.from}→${s.to}`)).toEqual(['k#0 1→3', 'k#1 1→3']);
    expect([rev(elements, 'k', 0)!.revision, rev(elements, 'k', 1)!.revision, rev(elements, 'm', 0)!.revision]).toEqual([3, 3, 1]);
    expect(rev(elements, 'k', 0)!.overrides).toEqual({ r: own });
    expect(effectiveCableType(rev(elements, 'k', 0)!).data.r.value).toBe(0.5);
    expect(effectiveCableType(rev(elements, 'k', 0)!).data.x.value).toBe(0.3);
    expect(rev(elements, 'k', 1)!.snapshot.maxCurrentA).toBe(250);
    const k0 = saved.find((e) => e.id === 'k') as CableElement, k1 = elements.find((e) => e.id === 'k') as CableElement;
    expect(k1.spanIds).toEqual(k0.spanIds);
    expect(k1.poleIds).toEqual(k0.poleIds);
    expect([k1.strokeColor, k1.offset, k1.x, k1.y]).toEqual([k0.strokeColor, k0.offset, k0.x, k0.y]);
    for (const sid of k0.spanIds!) {
      const { cableType: _a, ...before } = k0.spanProps![sid]; const { cableType: _b, ...after } = k1.spanProps![sid];
      expect(after).toEqual(before); // parallel: 2, system, poles… all kept
    }
    for (const id of ['T', 'A', 'B', 'uA', 'uB', 'uM', 'm']) expect(JSON.stringify(elements.find((e) => e.id === id))).toBe(JSON.stringify(saved.find((e) => e.id === id)));
  });
  it('O2. the same revision as the library: nothing changes (the same array is returned)', async () => {
    const { c, saved } = await savedOnOld();
    const once = await withLatestLibraryRevisions(saved, c);
    const twice = await withLatestLibraryRevisions(once.elements, c);
    expect(twice.spans).toEqual([]);
    expect(twice.elements).toBe(once.elements); // idempotent
  });
  it('O3. a newer revision in the project than in this library (another device): never moved back', async () => {
    const { c, saved, red } = await savedOnOld();
    const newer = { ...(await c.history(red.id)).revisions[2], revision: 9, maxCurrentA: 999 } as CableTypeRevision;
    const els = syncSpansToRevision(saved, newer).updates.length ? saved.map((e) => (e.id === 'k' ? { ...e, ...syncSpansToRevision(saved, newer).updates[0].changes } : e)) as DrawingElement[] : saved;
    expect(rev(els, 'k', 0)!.revision).toBe(9);
    const out = await withLatestLibraryRevisions(els, c);
    expect(out.spans.filter((s) => s.cableId === 'k')).toEqual([]);
    expect(rev(out.elements, 'k', 0)!.revision).toBe(9);
    expect(rev(out.elements, 'k', 0)!.snapshot.maxCurrentA).toBe(999);
  });
  it('O4. a cable type this library does not have: the project keeps its own snapshot', async () => {
    const { saved } = await savedOnOld();
    const elsewhere = controller(memory().b);
    await elsewhere.create(data('another cable (synthetic)', 50));
    const out = await withLatestLibraryRevisions(saved, elsewhere);
    expect(out.spans).toEqual([]);
    expect(out.elements).toBe(saved);
  });
  it('O5. several cable types in one project: each moved to its own latest, independently', async () => {
    const { c, saved, blue } = await savedOnOld();
    await c.edit(blue.id, 1, { maxCurrentA: 120 });
    const out = await withLatestLibraryRevisions(saved, c);
    expect([rev(out.elements, 'k', 0)!.revision, rev(out.elements, 'k', 1)!.revision, rev(out.elements, 'm', 0)!.revision]).toEqual([3, 3, 2]);
    expect(rev(out.elements, 'k', 0)!.typeId).not.toBe(rev(out.elements, 'm', 0)!.typeId);
  });
  it('O6. the library cannot be read: the project opens exactly as stored', async () => {
    const { saved } = await savedOnOld();
    const broken = controller({ get: async () => { throw new Error('read (synthetic)'); }, set: async () => {}, keys: async () => { throw new Error('read (synthetic)'); } });
    const out = await withLatestLibraryRevisions(saved, broken);
    expect(out.elements).toBe(saved);
    // a project with no library link never reads the library at all
    let reads = 0;
    const counting = controller({ get: async () => { reads++; return undefined; }, set: async () => {}, keys: async () => { reads++; return []; } });
    const plain = saved.map((e) => (e.type === 'cable' ? { ...e, spanProps: {} } : e)) as DrawingElement[];
    expect((await withLatestLibraryRevisions(plain, counting)).elements).toBe(plain);
    expect(reads).toBe(0);
  });
  it('O7. the autosaved draft is restored on the latest revisions, before it is shown, with no undo step', async () => {
    const { c, saved } = await savedOnOld();
    useDrawingStore.setState({ ...initial }, true);
    const store = new Map<string, unknown>();
    store.set('autosave_draft_v1', { version: 1, savedAt: 1, projectId: null, projectName: 'synthetic', data: { elements: saved, style: DEFAULT_STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: { [pairKey('T', 'A')]: '100', [pairKey('A', 'B')]: '120' } } });
    const storage: DraftStorage = { get: async (k) => store.get(k) as never, set: async (k, v) => { store.set(k, v); }, del: async (k) => { store.delete(k); } };
    const guard: RestoreGuard = { get: () => null, set: () => {}, clear: () => {} };
    const r = await restoreDraft({ storage, guard, rendered: async () => true, latestCables: async (els) => (await withLatestLibraryRevisions(els, c)).elements });
    expect(r.status).toBe('restored');
    expect(revs()).toEqual([3, 3, 1]);
    expect(S().history).toEqual([]);
    // the restored spans carry the library's latest data (250 A) and are calculated with it: the trunk's
    // 190 A is under 250 A, so no warning — and the per-cable current E2 compares is the same as before
    expect(linkOf('k', 0).snapshot.maxCurrentA).toBe(250);
    expect(ampacityWarnings(S().elements, voltageView(doc()))).toEqual([]);
    expect(voltageView(doc()).bySpan.get('k#0')!.perSetCurrentA.a!).toBeCloseTo(95, 0); // 190 A over 2 cables in parallel
  });
  it('O8. an imported file is opened (and saved) on the latest revisions; when that fails it opens as it is', async () => {
    const { c, saved } = await savedOnOld();
    const plan: ImportPlan = { data: { version: 3, elements: saved, style: DEFAULT_STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: {} }, fileId: null, name: 'synthetic', conflict: null, cables: { kind: 'kept' } as never };
    const written: unknown[] = [];
    const deps = { getMeta: async () => [], save: async (p: unknown) => { written.push(p); }, now: () => 5, newId: () => 'p1', defaultCable: async () => undefined, latestCables: async (els: DrawingElement[]) => (await withLatestLibraryRevisions(els, c)).elements };
    const out = await applyImport(plan, 'copy', deps);
    expect(out.ok).toBe(true);
    expect(revs()).toEqual([3, 3, 1]);
    const savedEls = (written[0] as { data: { elements: DrawingElement[] } }).data.elements;
    expect(rev(savedEls, 'k', 0)!.revision).toBe(3);
    // the sync throws: the file is opened exactly as it is (nothing half-done)
    const out2 = await applyImport(plan, 'open', { ...deps, latestCables: async () => { throw new Error('sync (synthetic)'); } });
    expect(out2.ok).toBe(true);
    expect(revs()).toEqual([1, 1, 1]);
  });
  it('O9. saved, closed and opened again: the latest revision stays; opening again changes nothing', async () => {
    const { c, saved } = await savedOnOld();
    const first = await withLatestLibraryRevisions(saved, c);
    const file = serializeProject(first.elements, DEFAULT_STYLE, 1, 'circle', {}, {}, null, 'synthetic');
    const parsed = parseProjectFile(file);
    expect(parsed.ok).toBe(true);
    const reopened = (parsed as { data: { elements: DrawingElement[] } }).data.elements;
    const again = await withLatestLibraryRevisions(reopened, c);
    expect(again.spans).toEqual([]);
    expect(again.elements).toBe(reopened);
    expect(rev(reopened, 'k', 1)!.revision).toBe(3);
  });
});
