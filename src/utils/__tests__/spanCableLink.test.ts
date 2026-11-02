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
import type { CableElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';
import type { CableLibraryBackend } from '../cableLibraryStorage';
import { createCableLibraryController, type CableLibraryController } from '../../store/cableLibraryStore';
import { useDrawingStore } from '../../store/drawingStore';
import { cableTypeUpdateAvailable } from '../cableTypeModel';
import { checkPick, dcResistances, linkRecordState, linkSpanCable, unlinkSpanCable, writeSpanProps } from '../spanCableLink';
import { spanAt } from '../spanModel';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { loadProject, saveProject } from '../projectStorage';
import { calculateCablePath } from '../cableLayout';

// Stage C4: a library cable linked to a span (store, project file, library). ALL VALUES ARE SYNTHETIC.

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
const library = (b: CableLibraryBackend): CableLibraryController => createCableLibraryController({ backend: b, now: () => 1000 + ids, newId: () => `ct_c4_${++ids}` });
const val = (value: number | undefined, basis: 'ac' | 'dc' | 'unspecified' | 'ac-50hz') =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km' as const, basis, verification: { status: 'checked' as const } }) as never;
const abc = (name = 'ABC 3x70 (synthetic)'): CableTypeData => ({
  name, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: val(0.443, 'dc'), x: val(0, 'ac-50hz'), rn: val(0.63, 'unspecified'), xn: val(undefined, 'ac-50hz'), source: { name: 'synthetic maker sheet' },
});

const pole = (id: string, x: number, y: number): SymbolElement =>
  ({ id, type: 'symbol', symbolId: 'lv_pole', width: 40, height: 40, x, y, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 });
const cableEl = (id: string, poleIds: string[]): CableElement =>
  ({ id, type: 'cable', poleIds, x: 0, y: 0, strokeColor: '#f00', fillColor: 'transparent', strokeWidth: 2 } as unknown as CableElement);

const initial = useDrawingStore.getState();
const st = () => useDrawingStore.getState();
const draw = () => {
  useDrawingStore.setState({ ...initial }, true);
  const s = () => { const x = st(); x.commitHistory(); return x; };
  s().addElement(pole('A', 0, 0));
  s().addElement(pole('B', 200, 0));
  s().addElement(pole('C', 380, 40));
  s().addElement(cableEl('c1', ['A', 'B', 'C']));
  s().updateConnectionDistance('A_B', '35');
  s().updateConnectionDistance('B_C', '42');
  // span 0 has the person's own (legacy) values: they are never touched by a link
  const c = st().elements.find((e) => e.id === 'c1') as CableElement;
  const legacy: SpanProps = { poles: ['A', 'B'], system: '3ph4w', material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.5, xOhmPerKm: 0.07, rNeutralOhmPerKm: 0.6, dataSource: 'own (synthetic)' };
  s().updateElement('c1', { spanProps: { [c.spanIds![0]]: legacy } });
  s();
};
const cab = () => st().elements.find((e) => e.id === 'c1') as CableElement;
const span = (i: number) => spanAt(cab(), i).props;
const link = (i: number, rev: CableTypeRevision, now = 7) => writeSpanProps(st(), 'c1', i, (p, poles) => linkSpanCable(p, poles, rev, now));
const unlink = (i: number) => writeSpanProps(st(), 'c1', i, (p) => (p ? unlinkSpanCable(p) : p));
/** everything of the drawing except the span records */
const drawing = () => JSON.parse(JSON.stringify({
  els: st().elements.map((e) => { const { spanProps: _s, ...rest } = e as CableElement; return rest; }),
  d: st().connectionDistances, flags: st().distanceFlags, o: st().connectionLabelOffsets,
  paths: st().elements.filter((e): e is CableElement => e.type === 'cable').map((c) => calculateCablePath(c, st().elements as DrawingElement[])),
}));
const exported = () => {
  const s = st();
  return serializeProject(s.elements, s.style, s.poleSizeScale, s.consumerVariant, s.connectionDistances, s.connectionLabelOffsets, 'P-C4', 'C4 (synthetic)', s.distanceTextScale, s.consumerSizeScale, s.electrical, s.distanceFlags);
};

let lib: ReturnType<typeof memoryBackend>;
let c: CableLibraryController;
let rev1: CableTypeRevision;
beforeEach(async () => {
  idb.data.clear();
  lib = memoryBackend();
  c = library(lib.b);
  rev1 = await c.create(abc());
  await c.load();
  draw();
});

describe('C4 1–2: choosing a cable and linking it', () => {
  it('1. a cable chosen from the library is linked to the span (read again from the library first)', async () => {
    const shown = c.store.getState().types.find((t) => t.id === rev1.id)!;
    const pick = await checkPick((id) => c.history(id), shown);
    expect(pick.ok).toBe(true);
    expect(link(1, (pick as { revision: CableTypeRevision }).revision)).toBe(true);
    expect(span(1)!.cableType!.typeId).toBe(rev1.id);
  });
  it('2. typeId, revision and a full snapshot are kept; the span\'s own fields are not changed or filled', () => {
    const before = structuredClone(span(0)!);
    link(0, rev1, 99);
    const p = span(0)!;
    expect(p.cableType).toEqual({ typeId: rev1.id, revision: 1, snapshot: rev1, assignedAt: 99 });
    expect(p.cableType!.snapshot).not.toBe(rev1); // a copy, not the library's object
    const { cableType: _c, ...rest } = p;
    expect(rest).toEqual(before); // R / X / Rn, material, source: exactly as they were
    // a span without a record gets the link only: nothing copied from the snapshot into the old fields
    link(1, rev1);
    const q = span(1)!;
    expect(Object.keys(q).sort()).toEqual(['cableType', 'poles']);
    // missing stays missing, X = 0 stays 0, DC stays DC (as entered)
    expect('value' in q.cableType!.snapshot.xn).toBe(false);
    expect(q.cableType!.snapshot.x.value).toBe(0);
    expect(dcResistances(q.cableType!.snapshot)).toEqual(['r']);
  });
  it('a deleted record or a missing revision cannot be linked; a newer revision is shown first', async () => {
    const shown = c.store.getState().types[0];
    const gone = await checkPick(async () => { throw Object.assign(new Error('x'), { kind: 'not-found' }); }, shown);
    expect(gone).toEqual({ ok: false, reason: 'gone' });
    const failed = await checkPick(async () => { throw new Error('read'); }, shown);
    expect(failed).toEqual({ ok: false, reason: 'failed' });
    expect(await checkPick(async () => ({ id: shown.id, revisions: [] }), shown)).toEqual({ ok: false, reason: 'gone' });
    await c.edit(rev1.id, 1, { description: 'changed meanwhile' });
    const changed = await checkPick((id) => c.history(id), shown);
    expect(changed).toMatchObject({ ok: false, reason: 'changed', latest: { revision: 2 } });
    // an id that is not in the library at all
    expect(await checkPick((id) => c.history(id), { ...shown, id: 'ct_nowhere' })).toEqual({ ok: false, reason: 'gone' });
  });
  it('a merge conflict on the cable type is resolved by the choice (originals and merge marks dropped)', async () => {
    const other = await c.create(abc('Other (synthetic)'));
    const a = linkSpanCable(undefined, ['A', 'B'], rev1), b = linkSpanCable(undefined, ['A', 'B'], other);
    const merged: SpanProps = { ...a, review: ['merge-different', 'inherited' as never], mergedFrom: [a, b] };
    const out = linkSpanCable(merged, ['A', 'B'], other, 3);
    expect(out.mergedFrom).toBeUndefined();
    expect(out.review).toEqual(['inherited']);
    expect(out.cableType).toMatchObject({ typeId: other.id, revision: 1 });
    // no conflict: the marks of the person's own values are kept as they are
    const plain: SpanProps = { poles: ['A', 'B'], rOhmPerKm: 0.5, review: ['merge-different'], mergedFrom: [{ rOhmPerKm: 0.5 } as never, null] };
    expect(linkSpanCable(plain, ['A', 'B'], rev1)).toMatchObject({ review: ['merge-different'], mergedFrom: plain.mergedFrom });
  });
});

describe('C4 3–5: the link is kept', () => {
  it('3. the span record read again (as the sheet does when reopened) gives the linked cable', () => {
    link(1, rev1);
    const again = spanAt(cab(), 1).props!;
    expect(again.cableType).toMatchObject({ typeId: rev1.id, revision: 1 });
    expect(again.cableType!.snapshot).toEqual(rev1);
  });
  it('4. save, close and open the project: the snapshot is kept exactly', async () => {
    link(0, rev1);
    const s = st();
    const before = structuredClone(span(0));
    await saveProject({ id: 'P-C4', name: 'C4 (synthetic)', createdAt: 1, updatedAt: 2, data: {
      elements: s.elements, style: s.style, poleSizeScale: s.poleSizeScale, consumerVariant: s.consumerVariant,
      connectionDistances: s.connectionDistances, connectionLabelOffsets: s.connectionLabelOffsets, electrical: s.electrical, distanceFlags: s.distanceFlags,
    } });
    useDrawingStore.setState({ ...initial }, true); // closed
    const p = await loadProject('P-C4');
    st().loadProject(p!.data);
    expect(span(0)).toEqual(before);
  });
  it('5. export and import: the snapshot is kept exactly', () => {
    link(0, rev1);
    link(1, rev1);
    const before = [structuredClone(span(0)), structuredClone(span(1))];
    const parsed = parseProjectFile(exported());
    expect(parsed.ok).toBe(true);
    useDrawingStore.setState({ ...initial }, true);
    st().loadProject((parsed as Extract<typeof parsed, { ok: true }>).data);
    expect([span(0), span(1)]).toEqual(before);
  });
});

describe('C4 6–9: the library and the link', () => {
  it('6. an edit of the cable in the library does not change the linked snapshot', async () => {
    link(1, rev1);
    const before = JSON.stringify(span(1));
    await c.edit(rev1.id, 1, { r: { value: 0.3, unit: 'ohm/km', basis: 'ac' } as never, name: 'renamed (synthetic)' });
    await c.setVerification(rev1.id, 2, 'x', { status: 'approved', by: 'eng' });
    expect(JSON.stringify(span(1))).toBe(before);
  });
  it('7. a newer revision is detected and NOT applied', async () => {
    link(1, rev1);
    await c.edit(rev1.id, 1, { description: 'rev 2' });
    const ct = span(1)!.cableType!;
    const h = await c.history(rev1.id);
    expect(cableTypeUpdateAvailable(ct, h)!.revision).toBe(2);
    expect(linkRecordState(ct, h)).toEqual({ kind: 'newer', latest: 2 });
    expect(span(1)!.cableType!.revision).toBe(1);
    expect(span(1)!.cableType!.snapshot).toEqual(rev1);
    // the library is not changed by the check either
    expect((await c.history(rev1.id)).revisions.map((r) => r.revision)).toEqual([1, 2]);
    // the current revision: nothing to say
    expect(linkRecordState(ct, { id: rev1.id, revisions: [rev1] })).toEqual({ kind: 'current' });
  });
  it('8. an imported project whose cable is not in this device\'s library keeps its snapshot', async () => {
    link(0, rev1);
    const file = exported();
    // another device: an empty library
    const other = library(memoryBackend().b);
    useDrawingStore.setState({ ...initial }, true);
    const parsed = parseProjectFile(file);
    st().loadProject((parsed as Extract<typeof parsed, { ok: true }>).data);
    const ct = span(0)!.cableType!;
    expect(ct.snapshot).toEqual(rev1);
    const read = await other.history(ct.typeId).then((h) => linkRecordState(ct, h), (e: { kind?: string }) => (e.kind === 'not-found' ? { kind: 'missing' } : { kind: 'unknown' }));
    expect(read).toEqual({ kind: 'missing' });
    expect(linkRecordState(ct, undefined)).toEqual({ kind: 'missing' });
    // a revision newer than this device has (another device's library had more revisions)
    expect(linkRecordState({ ...ct, revision: 3 }, { id: ct.typeId, revisions: [rev1] })).toEqual({ kind: 'ahead', latest: 1 });
    // nothing was written to the library by reading the project
    expect((await other.history(ct.typeId).catch(() => undefined))).toBeUndefined();
  });
  it('9. unlink: the cable stays in the library; the span keeps its own fields', async () => {
    link(0, rev1);
    link(1, rev1);
    const libraryBefore = JSON.stringify([...lib.data.entries()]);
    unlink(0);
    unlink(1);
    expect(span(0)).toEqual({ poles: ['A', 'B'], system: '3ph4w', material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.5, xOhmPerKm: 0.07, rNeutralOhmPerKm: 0.6, dataSource: 'own (synthetic)' });
    expect(span(1)).toBeUndefined(); // a record that held only the link is removed
    expect(JSON.stringify([...lib.data.entries()])).toBe(libraryBefore);
    expect((await c.history(rev1.id)).revisions).toHaveLength(1);
    await c.reload();
    expect(c.store.getState().types.map((t) => t.id)).toEqual([rev1.id]);
  });
});

describe('C4 10–11: undo / redo, and the drawing', () => {
  it('10. link and unlink are one undo step each; undo / redo keep the snapshot exactly', () => {
    const h0 = st().history.length;
    const before = structuredClone(span(0));
    link(0, rev1);
    expect(st().history.length).toBe(h0 + 1);
    const linked = structuredClone(span(0));
    unlink(0);
    expect(st().history.length).toBe(h0 + 2);
    expect(span(0)!.cableType).toBeUndefined();
    st().undo(); // the unlink undone
    expect(span(0)).toEqual(linked);
    st().undo(); // the link undone
    expect(span(0)).toEqual(before);
    st().redo();
    expect(span(0)).toEqual(linked);
    expect(span(0)!.cableType!.snapshot).toEqual(rev1);
    st().redo();
    expect(span(0)!.cableType).toBeUndefined();
    st().undo();
    expect(span(0)).toEqual(linked);
  });
  it('11. the drawing, the span lengths and directions are not changed', () => {
    const before = drawing();
    const poles = cab().poleIds.slice();
    const spanIds = cab().spanIds!.slice();
    link(0, rev1);
    link(1, rev1);
    unlink(0);
    expect(drawing()).toEqual(before);
    expect(cab().poleIds).toEqual(poles); // same direction A → B → C
    expect(cab().spanIds).toEqual(spanIds);
    expect(st().connectionDistances).toEqual({ A_B: '35', B_C: '42' });
    st().undo(); st().undo(); st().undo();
    expect(drawing()).toEqual(before);
  });
  it('a span that is gone is not written', () => {
    expect(writeSpanProps(st(), 'c1', 5, () => ({ poles: ['A', 'B'] }))).toBe(false);
    expect(writeSpanProps(st(), 'nope', 0, () => ({ poles: ['A', 'B'] }))).toBe(false);
  });
});
