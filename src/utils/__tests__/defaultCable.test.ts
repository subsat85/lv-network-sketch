import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The projects' IndexedDB (idb-keyval default store), in memory.
const idb = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    data,
    api: {
      get: async (k: string) => clone(data.get(k)),
      set: async (k: string, v: unknown) => { data.set(k, clone(v)); },
      del: async (k: string) => { data.delete(k); },
      setMany: async (entries: [string, unknown][]) => { for (const [k, v] of entries) data.set(k, clone(v)); },
      keys: async () => [...data.keys()],
      createStore: () => { throw new Error('no real IndexedDB in tests'); },
    },
  };
});
vi.mock('idb-keyval', () => idb.api);

import type { CableTypeData, CableTypeRevision } from '../../types/cableType';
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';
import type { CableLibraryBackend } from '../cableLibraryStorage';
import { openCableLibrary } from '../cableLibraryStorage';
import { createCableLibraryController } from '../../store/cableLibraryStore';
import { useDrawingStore } from '../../store/drawingStore';
import {
  defaultCableState, importKind, linkDefaultCable, planDefaultFill, prepareImportedCables, spansWithoutLibraryCable, usableDefault, withDefaultCableSpan, type DefaultCable,
} from '../defaultCable';
import { applyImport, planImport } from '../projectImport';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { loadProject, saveProject } from '../projectStorage';
import { computeVoltageDrop } from '../voltageDrop';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';

// The default cable of the library replaces the old default values and the company / IEC tables.
// ALL VALUES ARE SYNTHETIC.

const memoryBackend = () => {
  const data = new Map<string, unknown>();
  const b: CableLibraryBackend = {
    get: async <T,>(k: string) => (data.has(k) ? (structuredClone(data.get(k)) as T) : undefined),
    set: async (k, v) => { data.set(k, structuredClone(v)); },
    keys: async () => [...data.keys()],
  };
  return { data, b };
};
let ids = 0;
const v = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz') =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km' as const, basis, verification: { status: 'checked' as const } }) as never;
const cableData = (name: string, o: Partial<CableTypeData> = {}): CableTypeData => ({
  name, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 95 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: v(0.32, 'ac'), x: v(0.075, 'ac-50hz'), rn: v(0.63, 'dc'), xn: v(undefined, 'ac-50hz'), source: { name: 'synthetic sheet' }, ...o,
});
const asDefault = (r: CableTypeRevision): DefaultCable => ({ typeId: r.id, revision: r.revision, snapshot: r, selectedAt: 1 });

// ---- drawings ----
const pole = (id: string, x: number, y: number, symbolId = 'lv-pole'): SymbolElement => ({ id, type: 'symbol', symbolId, x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 } as SymbolElement);
const cableEl = (id: string, poleIds: string[]): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: '#f00', fillColor: 'none', strokeWidth: 2 } as CableElement);
const consumer = (id: string, poleId: string, o: Partial<ConsumerElement> = {}): ConsumerElement =>
  ({ id, type: 'consumer', x: 11, y: 22, poleId, color: '#f00', count: 2, variant: 'square', label: '63', strokeColor: '#f00', fillColor: '#f00', strokeWidth: 2, ...o } as ConsumerElement);
const text = { id: 'txt', type: 'text', x: 5, y: 6, text: 'note (synthetic)', strokeColor: '#000', fillColor: 'none', strokeWidth: 1 } as unknown as DrawingElement;
/** an old drawing: company-table values («كتالوج», review «defaults»), a section without R (it relied on IEC), an empty span */
const OLD_RECORDS: (Omit<SpanProps, 'poles'> | undefined)[] = [
  { system: '3ph4w', cableKind: 'abc', material: 'al', crossSectionMm2: 120, neutralMaterial: 'al', neutralCrossSectionMm2: 70, parallel: 1, rOhmPerKm: 0.2415, xOhmPerKm: 0.0716, rNeutralOhmPerKm: 0.4126, dataSource: 'كتالوج', review: ['defaults'] },
  { system: '1ph2w', cableKind: 'underground', material: 'cu', crossSectionMm2: 50, xOhmPerKm: 0.08, parallel: 2, inherited: true },
  undefined,
];
const drawingWith = (records: (Omit<SpanProps, 'poles'> | undefined)[]) => {
  const els = normalizeElements([pole('T', 0, 0, 'transformer'), pole('A', 100, 0), pole('B', 200, 50), pole('C', 300, 50), cableEl('k', ['T', 'A', 'B', 'C']), consumer('u1', 'B'), consumer('u2', 'C', { hasManualPosition: true, x: 310, y: 90, variant: 'circle', label: '' }), text], (() => { let n = 0; return () => `s${n++}`; })());
  let k = els.find((e) => e.id === 'k') as CableElement;
  records.forEach((r, i) => { if (r) k = withSpanProps(k, k.spanIds![i], { ...r, poles: [k.poleIds[i], k.poleIds[i + 1]] }); });
  return els.map((e) => (e.id === 'k' ? k : e));
};
const fileOf = (els: DrawingElement[], id = 'P-old') => serializeProject(els, { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, 1.2, 'circle', { A_T: '40', A_B: '35', B_C: '30' }, { A_T: { x: 2, y: 3 } }, id, 'Old (synthetic)', 1, 1, DEFAULT_ELECTRICAL, {});
/** everything but the span records */
const geometry = (els: DrawingElement[]) => JSON.stringify(els.map((e) => { const { spanProps: _s, ...r } = e as CableElement; return r; }));
const spanRecords = (els: DrawingElement[]) => { const k = els.find((e) => e.id === 'k') as CableElement; return k.spanIds!.map((_, i) => spanAt(k, i).props); };

let lib: ReturnType<typeof memoryBackend>;
let rev1: CableTypeRevision;
beforeEach(async () => {
  idb.data.clear();
  lib = memoryBackend();
  rev1 = await openCableLibrary({ backend: lib.b, newId: () => `ct_dc_${++ids}` }).create(cableData('ABC 3x95 (synthetic)'));
  useDrawingStore.setState({ ...useDrawingStore.getInitialState?.() ?? {} });
});

describe('choosing the default cable', () => {
  it('is kept in the library (its exact revision and a full snapshot) and read back after a restart', async () => {
    const c1 = createCableLibraryController({ backend: lib.b, now: () => 77 });
    await c1.load();
    expect(c1.store.getState().defaultCable).toEqual({ kind: 'none' });
    const d = await c1.setDefault(rev1.id, 1);
    expect(d).toEqual({ typeId: rev1.id, revision: 1, snapshot: rev1, selectedAt: 77 });
    expect(c1.store.getState().defaultCable).toEqual({ kind: 'ok', cable: d });
    // another session (a new controller on the same database)
    const c2 = createCableLibraryController({ backend: lib.b });
    await c2.load();
    expect(c2.store.getState().defaultCable).toEqual({ kind: 'ok', cable: d });
    // the cable types themselves were not changed, and it is not listed as a cable type
    expect(c2.store.getState().types).toEqual([rev1]);
  });
  it('a revision that does not exist cannot be chosen (nothing stored)', async () => {
    const c = createCableLibraryController({ backend: lib.b });
    await expect(c.setDefault(rev1.id, 9)).rejects.toMatchObject({ kind: 'not-found' });
    await expect(c.setDefault('ct_nowhere', 1)).rejects.toMatchObject({ kind: 'not-found' });
    expect(lib.data.has('default-cable')).toBe(false);
  });
  it('a newer revision in the library is reported, never applied; a missing record is not used and nothing replaces it', async () => {
    const c = createCableLibraryController({ backend: lib.b });
    await c.setDefault(rev1.id, 1);
    await c.edit(rev1.id, 1, { r: v(0.5, 'ac') });
    expect(c.store.getState().defaultCable).toMatchObject({ kind: 'newer', latest: 2, cable: { revision: 1, snapshot: rev1 } });
    expect(usableDefault(c.store.getState().defaultCable)!.snapshot.r.value).toBe(0.32); // the chosen revision's values
    // the record is not on this device (another library)
    const d = asDefault(rev1);
    expect(defaultCableState(d, [])).toEqual({ kind: 'missing', cable: d });
    expect(usableDefault(defaultCableState(d, []))).toBeUndefined();
    expect(usableDefault({ kind: 'unreadable' })).toBeUndefined();
    // a stored record that cannot be read: reported, the list still loads
    lib.data.set('default-cable', { typeId: 1 });
    const c2 = createCableLibraryController({ backend: lib.b });
    await c2.load();
    expect(c2.store.getState()).toMatchObject({ status: 'ready', defaultCable: { kind: 'unreadable' } });
  });
});

describe('applying the default', () => {
  const D = () => asDefault(rev1);
  it('a newly drawn span with no properties is linked to it (snapshot, circuit defaults); nothing copied into the old fields', () => {
    const k = normalizeElements([cableEl('k', ['A', 'B'])])[0] as CableElement;
    const out = withDefaultCableSpan(k, 0, D(), 5);
    expect(spanAt(out, 0).props).toEqual({ poles: ['A', 'B'], system: '3ph4w', parallel: 1, cableType: { typeId: rev1.id, revision: 1, snapshot: rev1, assignedAt: 5 } });
    // no default: nothing (no table values any more)
    expect(withDefaultCableSpan(k, 0, undefined)).toBe(k);
    // a span with a record (a copy of its neighbour) is left as it is
    const withRec = withSpanProps(k, k.spanIds![0], { poles: ['A', 'B'], system: '1ph2w' });
    expect(withDefaultCableSpan(withRec, 0, D())).toBe(withRec);
  });
  it('a new drawing in the store: drawing the span and linking it is one undo step', () => {
    const s = () => useDrawingStore.getState();
    useDrawingStore.setState({ elements: [], history: [], redoStack: [], pendingStep: null });
    s().addElement(pole('A', 0, 0)); s().commitHistory();
    s().addElement(pole('B', 100, 0)); s().commitHistory();
    const h0 = s().history.length;
    s().addElement(cableEl('k', ['A', 'B']));
    const drawn = s().elements.find((e) => e.id === 'k') as CableElement;
    const linked = withDefaultCableSpan(drawn, 0, D(), 5);
    s().updateElement('k', { spanProps: linked.spanProps });
    s().commitHistory();
    expect(s().history.length).toBe(h0 + 1);
    expect(spanAt(s().elements.find((e) => e.id === 'k') as CableElement, 0).props!.cableType!.snapshot).toEqual(rev1);
    s().undo();
    expect(s().elements.find((e) => e.id === 'k')).toBeUndefined();
  });
  it('«link the default cable» on an existing drawing: every span without a library cable, in one undo step; linked spans untouched', () => {
    const els = drawingWith(OLD_RECORDS);
    const k = els.find((e) => e.id === 'k') as CableElement;
    const other = { ...rev1, id: 'ct_other' };
    const alreadyLinked = withSpanProps(k, k.spanIds![2], linkDefaultCable(undefined, ['B', 'C'], asDefault(other), 1));
    const drawing = els.map((e) => (e.id === 'k' ? alreadyLinked : e));
    expect(spansWithoutLibraryCable(drawing)).toBe(2);
    const plan = planDefaultFill(drawing, D(), 9);
    expect(plan.spans).toBe(2);
    const after = { ...alreadyLinked, ...plan.updates[0].changes } as CableElement;
    expect(spanAt(after, 0).props).toMatchObject({ rOhmPerKm: 0.2415, cableType: { typeId: rev1.id, revision: 1 } }); // its own (E1) fields stay
    expect(spanAt(after, 1).props).toMatchObject({ system: '1ph2w', parallel: 2, cableType: { typeId: rev1.id } }); // its system / parallel stay
    expect(spanAt(after, 2).props).toEqual(spanAt(alreadyLinked, 2).props); // the linked span: unchanged
    // through the store: one undo step
    const s = () => useDrawingStore.getState();
    useDrawingStore.setState({ elements: drawing, history: [], redoStack: [], pendingStep: null });
    s().saveHistory(); s().updateElements(plan.updates); s().saveHistory();
    expect(s().history.length).toBe(1);
    s().undo();
    expect(spanRecords(s().elements)).toEqual(spanRecords(drawing));
  });
  it('a later change of the default never changes a span already linked', async () => {
    const c = createCableLibraryController({ backend: lib.b });
    await c.setDefault(rev1.id, 1);
    const span = linkDefaultCable(undefined, ['A', 'B'], usableDefault(c.store.getState().defaultCable)!, 1);
    const before = JSON.stringify(span);
    const other = await c.create(cableData('UG 4x150 (synthetic)', { construction: 'underground' }));
    await c.setDefault(other.id, 1);
    await c.edit(rev1.id, 1, { r: v(0.9, 'ac') });
    expect(JSON.stringify(span)).toBe(before);
    expect(planDefaultFill([withSpanProps(normalizeElements([cableEl('k', ['A', 'B'])])[0] as CableElement, 's', span)], usableDefault(c.store.getState().defaultCable)).spans).toBe(1);
  });
});

describe('importing a drawing file (planImport only)', () => {
  const plan = async (json: string, def?: DefaultCable) => {
    const p = await planImport(json, { getMeta: async () => [], defaultCable: async () => def });
    expect(p.ok).toBe(true);
    return (p as { plan: Awaited<ReturnType<typeof planImport>> extends infer R ? R extends { plan: infer P } ? P : never : never }).plan;
  };
  it('an old drawing with a default cable: its cable data cleared, every span linked — geometry, topology, ids, consumers, labels kept', async () => {
    const els = drawingWith(OLD_RECORDS);
    const json = fileOf(els);
    const original = parseProjectFile(json) as { data: { elements: DrawingElement[] } };
    const p = await plan(json, asDefault(rev1));
    expect(p.cables).toEqual({ kind: 'old', cleared: 2, linked: 3, needDefault: false });
    expect(geometry(p.data.elements)).toBe(geometry(original.data.elements));
    expect(p.data.connectionDistances).toEqual({ A_T: '40', A_B: '35', B_C: '30' });
    expect(p.data.connectionLabelOffsets).toEqual({ A_T: { x: 2, y: 3 } });
    const recs = spanRecords(p.data.elements);
    expect(recs[0]).toEqual({ poles: ['T', 'A'], system: '3ph4w', parallel: 1, cableType: { typeId: rev1.id, revision: 1, snapshot: rev1, assignedAt: expect.any(Number) } });
    expect(recs[1]).toEqual({ poles: ['A', 'B'], system: '1ph2w', parallel: 2, cableType: expect.objectContaining({ typeId: rev1.id }) }); // system / parallel kept
    expect(recs[2]).toMatchObject({ poles: ['B', 'C'], system: '3ph4w', parallel: 1, cableType: { typeId: rev1.id } });
    for (const r of recs) for (const k of ['rOhmPerKm', 'xOhmPerKm', 'rNeutralOhmPerKm', 'material', 'crossSectionMm2', 'dataSource', 'review', 'inherited', 'cableKind']) expect(r, k).not.toHaveProperty(k);
    // the snapshot's missing Xn stays missing (no table, nothing invented)
    expect('value' in recs[0]!.cableType!.snapshot.xn).toBe(false);
  });
  it('an old drawing without a default cable: cable data cleared, nothing invented, the user is told to choose one', async () => {
    const p = await plan(fileOf(drawingWith(OLD_RECORDS)), undefined);
    expect(p.cables).toEqual({ kind: 'old', cleared: 2, linked: 0, needDefault: true });
    expect(spanRecords(p.data.elements)).toEqual([{ poles: ['T', 'A'], system: '3ph4w', parallel: 1 }, { poles: ['A', 'B'], system: '1ph2w', parallel: 2 }, undefined]);
    // E1 has nothing to compute them with (no table): R missing, nothing derived
    const r = computeVoltageDrop(p.data.elements, p.data.connectionDistances, { ...DEFAULT_ELECTRICAL, powerFactor: 0.9 });
    for (const s of r.bySpan.values()) expect(s.computable).toBe(false);
    expect([...r.bySpan.values()][0].missing).toContain('resistance');
  });
  it('a version-2 (feature/vd) file is an old drawing too', async () => {
    const els = drawingWith([]);
    const raw = JSON.parse(fileOf(els));
    raw.version = 2;
    const k = raw.elements.find((e: { id: string }) => e.id === 'k');
    raw.spanProps = { [k.spanIds[0]]: { system: '3ph4w', rOhmPerKm: 0.5 } };
    const p = await plan(JSON.stringify(raw), asDefault(rev1));
    expect(p.cables.kind).toBe('old');
    expect(spanRecords(p.data.elements)[0]).not.toHaveProperty('legacyV2');
    expect(spanRecords(p.data.elements)[0]!.cableType!.typeId).toBe(rev1.id);
  });
  it('a file with library snapshots is imported exactly as it is (also its old values, and whatever the default is)', async () => {
    const other = { ...rev1, id: 'ct_from_other_device', name: 'Other (synthetic)' };
    const mixed = drawingWith([OLD_RECORDS[0], (({ poles: _p, ...rest }) => rest)(linkDefaultCable(undefined, ['A', 'B'], asDefault(other), 3)), undefined]);
    const json = fileOf(mixed);
    const before = JSON.stringify((parseProjectFile(json) as { data: { elements: DrawingElement[] } }).data.elements);
    const p = await plan(json, asDefault(rev1));
    expect(p.cables).toEqual({ kind: 'new', cleared: 0, linked: 0, needDefault: false });
    expect(JSON.stringify(p.data.elements)).toBe(before);
  });
  it('a file with no cable data at all is imported as it is (nothing linked by itself)', async () => {
    const json = fileOf(drawingWith([undefined, { system: '3ph4w' }, undefined]));
    const p = await plan(json, asDefault(rev1));
    expect(p.cables.kind).toBe('none');
    expect(spanRecords(p.data.elements)).toEqual([undefined, { poles: ['A', 'B'], system: '3ph4w' }, undefined]);
  });
  it('the default is read only for an old drawing, and a library that cannot be read means «no default»', async () => {
    const reads: string[] = [];
    await planImport(fileOf(drawingWith([undefined])), { getMeta: async () => [], defaultCable: async () => { reads.push('x'); return asDefault(rev1); } });
    expect(reads).toEqual([]);
    const p = await planImport(fileOf(drawingWith(OLD_RECORDS)), { getMeta: async () => [], defaultCable: async () => { throw new Error('IDB'); } });
    expect((p as { plan: { cables: unknown } }).plan.cables).toMatchObject({ kind: 'old', needDefault: true });
  });
  it('saved projects and the autosaved draft are never prepared: opening an old saved project changes nothing', async () => {
    const els = drawingWith(OLD_RECORDS);
    const data = { elements: els, style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle' as const, connectionDistances: { A_T: '40' } };
    await saveProject({ id: 'saved-old', name: 'saved (synthetic)', createdAt: 1, updatedAt: 1, data });
    const stored = JSON.stringify(idb.data.get('project_saved-old'));
    const opened = await loadProject('saved-old');
    useDrawingStore.getState().loadProject(opened!.data);
    expect(spanRecords(useDrawingStore.getState().elements)).toEqual(spanRecords(els));
    expect(JSON.stringify(idb.data.get('project_saved-old'))).toBe(stored);
  });
  it('the imported drawing saved and opened again keeps its snapshots; exported and imported again it is a «new» file, unchanged', async () => {
    const p = await plan(fileOf(drawingWith(OLD_RECORDS)), asDefault(rev1));
    const res = await applyImport(p, 'copy', { getMeta: async () => [], now: () => 50, newId: () => 'P-copy', save: saveProject });
    expect(res).toMatchObject({ ok: true, status: 'copied', cables: { kind: 'old', linked: 3 } });
    const reopened = await loadProject('P-copy');
    expect(spanRecords(reopened!.data.elements)).toEqual(spanRecords(p.data.elements));
    const again = await plan(fileOf(reopened!.data.elements, 'P-copy'), undefined);
    expect(again.cables.kind).toBe('new');
    expect(spanRecords(again.data.elements)).toEqual(spanRecords(p.data.elements));
  });
  it('the decision is for the whole file (prepareImportedCables): only span records change', () => {
    const els = drawingWith(OLD_RECORDS);
    expect(importKind(els)).toBe('old');
    const { elements } = prepareImportedCables(els, asDefault(rev1), 1);
    expect(geometry(elements)).toBe(geometry(els));
    expect(elements.filter((e) => e.type === 'consumer')).toEqual(els.filter((e) => e.type === 'consumer'));
  });
});

describe('no old table anywhere in the app', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? (f === '__tests__' ? [] : files(p)) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  it('no conductor table, company table or default-values module is imported or defined', () => {
    const src = join(__dirname, '..', '..');
    for (const f of files(src)) {
      // code only (the comments that say a table is NOT used are not code)
      const c = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const bad of ['data/conductors', 'spanDefaults', 'COMPANY_RX_OHM_PER_KM', 'R20_OHM_PER_KM', 'tableResistance', 'companyRX', 'defaultSpanValues', 'fillMissingSpanDefaults']) expect(c, `${f}: ${bad}`).not.toContain(bad);
    }
  });
});
