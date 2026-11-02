import { describe, expect, it, vi } from 'vitest';

// In-memory IndexedDB stand-in for the projects (idb-keyval API), as in projectImport.test.ts.
const db = vi.hoisted(() => {
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
      createStore: () => { throw new Error('the tests use an in-memory library backend'); },
    },
  };
});
vi.mock('idb-keyval', () => db.api);

import type { CableTypeData, ElectricalValue } from '../../types/cableType';
import type { CableElement, DrawingElement, SpanProps } from '../../types/drawing';
import { openCableLibrary, CableLibraryError, CABLE_LIBRARY_FORMAT, type CableLibraryBackend } from '../cableLibraryStorage';
import {
  assignCableType, cableTypeCompleteness, cableTypeUpdateAvailable, diffCableTypes, effectiveCableType,
  setCableTypeOverride, spanCableTypeProblem, upgradeSpanCableType,
} from '../cableTypeModel';
import { loadProject, saveProject } from '../projectStorage';
import { serializeProject, validateProjectFile } from '../projectSerialization';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { useDrawingStore } from '../../store/drawingStore';

// ALL VALUES ARE SYNTHETIC test values, not manufacturer data.

/** an in-memory backend; a "reload" is a new library opened on the same map */
const memory = () => {
  const data = new Map<string, unknown>();
  const backend: CableLibraryBackend = {
    get: async <T,>(k: string) => (data.has(k) ? structuredClone(data.get(k)) as T : undefined),
    set: async (k, v) => { data.set(k, structuredClone(v)); },
    keys: async () => [...data.keys()],
  };
  return { data, backend };
};
let clock = 1000;
let ids = 0;
const open = (backend: CableLibraryBackend) => openCableLibrary({ backend, now: () => ++clock, newId: () => `ct_test_${++ids}` });

const checked = { status: 'checked' as const, by: 'synthetic test fixture' };
const val = <B extends 'ac' | 'dc' | 'unspecified' | 'ac-50hz'>(value: number | undefined, basis: B, verification: ElectricalValue['verification'] = checked): ElectricalValue<B> =>
  ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km', basis, verification: { ...verification } });
const complete = (o: Partial<CableTypeData> = {}): CableTypeData => ({
  name: 'synthetic ABC 3x70 + 54.6', description: 'test', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: { ...val(0.5, 'ac'), referenceTempC: 70 }, x: val(0.08, 'ac-50hz'), rn: { ...val(0.6, 'ac'), referenceTempC: 70 }, xn: val(0.09, 'ac-50hz'),
  source: { name: 'synthetic', reference: 'synthetic test data', page: '1' }, ...o,
});
const draft = (): CableTypeData => ({
  name: 'draft ABC', construction: 'abc', phaseConductors: 3, neutralConductors: 1,
  phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy' },
  r: val(0.5, 'ac', { status: 'unverified' }), x: val(undefined, 'ac-50hz', { status: 'unverified' }),
  rn: val(undefined, 'ac', { status: 'unverified' }), xn: val(undefined, 'ac-50hz', { status: 'unverified' }),
  source: {},
});

const pole = (id: string, x: number) => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as DrawingElement;
/** a two-span cable; the first span gets `props` */
const elementsWith = (props?: Omit<SpanProps, 'poles'>): DrawingElement[] => {
  const cab = { id: 'k1', type: 'cable', x: 0, y: 0, poleIds: ['A', 'B', 'C'], cableIndex: 0, offset: 0, strokeColor: '#f00', fillColor: 'none', strokeWidth: 2 } as CableElement;
  const els = normalizeElements([pole('A', 0), pole('B', 100), pole('C', 200), cab]);
  const k = els[3] as CableElement;
  return props ? [...els.slice(0, 3), withSpanProps(k, k.spanIds![0], { poles: ['A', 'B'], ...props })] : els;
};
const spanOf = (els: DrawingElement[]) => { const k = els.find((e): e is CableElement => e.type === 'cable')!; return k.spanProps?.[k.spanIds![0]]; };
const projectOf = (id: string, elements: DrawingElement[]) => ({
  id, name: id, createdAt: 1, updatedAt: 2,
  data: { elements, style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle' as const, connectionDistances: { 'A_B': '30' }, electrical: DEFAULT_ELECTRICAL },
});
const fileOf = (els: DrawingElement[]) => serializeProject(els, { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, 1, 'circle', { A_B: '30' }, {}, 'p1', 'test', undefined, undefined, DEFAULT_ELECTRICAL, {});

describe('the global library (IndexedDB, versioned)', () => {
  it('1. a complete cable type is created and saved as revision 1', async () => {
    const { backend, data } = memory();
    const lib = open(backend);
    const r = await lib.create(complete(), { by: 'tester' });
    expect(r).toMatchObject({ revision: 1, name: 'synthetic ABC 3x70 + 54.6', createdBy: 'tester', r: { value: 0.5 }, x: { value: 0.08 }, rn: { value: 0.6 }, xn: { value: 0.09 } });
    expect(r.typeCreatedAt).toBe(r.revisionCreatedAt);
    expect(cableTypeCompleteness(r)).toEqual({ complete: true, missing: [] });
    expect(data.get('meta')).toEqual({ format: CABLE_LIBRARY_FORMAT, version: 1 });
    expect(data.has(`type:${r.id}`)).toBe(true);
  });
  it('2. an incomplete draft is saved as it is; what is missing stays missing and is listed', async () => {
    const lib = open(memory().backend);
    const r = await lib.create(draft());
    expect(r.x.value).toBeUndefined();
    expect(r.rn.value).toBeUndefined();
    expect(r.xn.value).toBeUndefined();
    expect(cableTypeCompleteness(r)).toEqual({ complete: false, missing: ['neutral-section', 'x', 'rn', 'xn', 'source'] });
  });
  it('3. after a reload (a new library on the same store) everything reads back the same', async () => {
    const { backend } = memory();
    const a = await open(backend).create(complete());
    const b = await open(backend).create(draft());
    const again = open(backend);
    expect(await again.current(a.id)).toEqual(a);
    expect(await again.current(b.id)).toEqual(b);
    expect((await again.list()).types.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });
  it('a newer library format is not read and not written over; a broken record is reported, not deleted', async () => {
    const { backend, data } = memory();
    const r = await open(backend).create(complete());
    data.set('type:ct_broken', { id: 'ct_broken', revisions: [{ id: 'other' }] });
    const listed = await open(backend).list();
    expect(listed.types.map((t) => t.id)).toEqual([r.id]);
    expect(listed.problems).toEqual([{ key: 'type:ct_broken', problem: 'revisions[0].revision' }]);
    expect(data.has('type:ct_broken')).toBe(true);
    data.set('meta', { format: CABLE_LIBRARY_FORMAT, version: 2 });
    await expect(open(backend).create(complete())).rejects.toMatchObject({ kind: 'format' });
    expect(data.get('meta')).toEqual({ format: CABLE_LIBRARY_FORMAT, version: 2 });
  });
});

describe('revisions and verification', () => {
  it('6. an edit writes revision 2; revision 1 is kept unchanged; an edit on a stale revision is a conflict', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    const { revision: r2, changes } = await lib.edit(r1.id, 1, { name: 'renamed', r: { value: 0.55, unit: 'ohm/km', basis: 'ac' } });
    expect(r2.revision).toBe(2);
    expect(changes).toEqual(['name', 'r', 'r.verification']);
    expect(await lib.revision(r1.id, 1)).toEqual(r1);
    expect((await lib.history(r1.id)).revisions).toHaveLength(2);
    await expect(lib.edit(r1.id, 1, { name: 'again' })).rejects.toBeInstanceOf(CableLibraryError);
    await expect(lib.edit(r1.id, 1, { name: 'again' })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await lib.history(r1.id)).revisions).toHaveLength(2);
  });
  it('9. changing one value resets only its verification; the others keep theirs', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete({ x: val(0.08, 'ac-50hz', { status: 'approved', by: 'eng' }) }));
    const { revision: r2 } = await lib.edit(r1.id, 1, { rn: { value: 0.65, unit: 'ohm/km', basis: 'ac' } });
    expect(r2.rn.verification).toEqual({ status: 'unverified' });
    expect(r2.r.verification).toEqual(r1.r.verification);
    expect(r2.x.verification).toEqual({ status: 'approved', by: 'eng' });
    expect(r2.xn.verification).toEqual(r1.xn.verification);
    // the same value written again changes nothing: no revision
    const same = await lib.edit(r1.id, 2, { x: { value: 0.08, unit: 'ohm/km', basis: 'ac-50hz' } });
    expect([same.revision.revision, same.changes]).toEqual([2, []]);
    // a new source is a change of that value
    const src = await lib.edit(r1.id, 2, { x: { value: 0.08, unit: 'ohm/km', basis: 'ac-50hz', source: { name: 'another sheet', page: '4' } } });
    expect(src.revision.x.verification).toEqual({ status: 'unverified' });
    expect(src.revision.r.verification).toEqual(r1.r.verification);
  });
  it('a new reference temperature of a value is a change of that value only (nothing is converted)', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    const { revision, changes } = await lib.edit(r1.id, 1, { r: { value: 0.5, unit: 'ohm/km', basis: 'ac', referenceTempC: 90 } });
    expect(changes).toEqual(['r', 'r.verification']);
    expect([revision.r.value, revision.r.referenceTempC, revision.r.verification.status]).toEqual([0.5, 90, 'unverified']);
    expect([revision.rn.referenceTempC, revision.rn.verification.status, revision.x.verification.status]).toEqual([70, 'checked', 'checked']);
  });
  it('verification is metadata: setting it is a revision, and a verified value stays editable', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    const v = await lib.setVerification(r1.id, 1, 'r', { status: 'approved', by: 'eng', on: '2026-10-31' });
    expect([v.revision.revision, v.changes]).toEqual([2, ['r.verification']]);
    const e = await lib.edit(r1.id, 2, { r: { value: 0.51, unit: 'ohm/km', basis: 'ac' }, phase: { material: 'cu', sectionMm2: 50 }, construction: 'underground' });
    expect(e.revision).toMatchObject({ revision: 3, r: { value: 0.51, verification: { status: 'unverified' } }, phase: { material: 'cu', sectionMm2: 50 }, construction: 'underground' });
  });
  it('10 / 11. removing or changing one value never fills another: RN is never R, XN is never X', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    const { revision } = await lib.edit(r1.id, 1, { rn: null, xn: null });
    expect([revision.rn.value, revision.xn.value]).toEqual([undefined, undefined]);
    expect([revision.r.value, revision.x.value]).toEqual([0.5, 0.08]);
    expect(cableTypeCompleteness(revision).missing).toEqual(['rn', 'xn']);
    const created = await lib.create(complete({ rn: val(undefined, 'ac'), xn: val(undefined, 'ac-50hz') }));
    expect([created.rn.value, created.xn.value]).toEqual([undefined, undefined]);
  });
});

describe('projects: reference, exact snapshot, overrides', () => {
  it('4. one cable type used by spans of two projects; both keep the same exact snapshot', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    const p1 = projectOf('p1', elementsWith(assignCableType({ poles: ['A', 'B'], system: '3ph4w' }, r1, 5)));
    const p2 = projectOf('p2', elementsWith(assignCableType({ poles: ['A', 'B'], parallel: 2 }, r1, 6)));
    await saveProject(p1);
    await saveProject(p2);
    const l1 = spanOf((await loadProject('p1'))!.data.elements)!;
    const l2 = spanOf((await loadProject('p2'))!.data.elements)!;
    expect(l1.cableType).toMatchObject({ typeId: r1.id, revision: 1, assignedAt: 5 });
    expect(l2.cableType).toMatchObject({ typeId: r1.id, revision: 1, assignedAt: 6 });
    expect(l1.cableType!.snapshot).toEqual(r1);
    expect(l2.cableType!.snapshot).toEqual(r1);
    expect(l2.parallel).toBe(2);
  });
  it('5 / 7. the project keeps the revision it used; a library edit changes no saved project', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    await saveProject(projectOf('p3', elementsWith(assignCableType({ poles: ['A', 'B'] }, r1))));
    const before = JSON.stringify(await loadProject('p3'));
    await lib.edit(r1.id, 1, { r: { value: 0.7, unit: 'ohm/km', basis: 'ac' }, name: 'changed' });
    const after = await loadProject('p3');
    expect(JSON.stringify(after)).toBe(before);
    const ct = spanOf(after!.data.elements)!.cableType!;
    expect([ct.revision, ct.snapshot.r.value, ct.snapshot.name]).toEqual([1, 0.5, 'synthetic ABC 3x70 + 54.6']);
    // a newer revision is only reported; applying it is an explicit call, with the changes listed first
    const h = await lib.history(r1.id);
    expect(cableTypeUpdateAvailable(ct, h)?.revision).toBe(2);
    const up = upgradeSpanCableType(spanOf(after!.data.elements)!, h.revisions[1], 9);
    expect(up.changes).toEqual(['name', 'r', 'r.verification']);
    expect(up.props.cableType).toMatchObject({ revision: 2, snapshot: { revision: 2, r: { value: 0.7 } }, assignedAt: 9 });
    expect(diffCableTypes(h.revisions[0], h.revisions[1])).toEqual(up.changes);
  });
  it('8. a project override keeps its own source and verification and does not touch the library or the snapshot', async () => {
    const { backend, data } = memory();
    const lib = open(backend);
    const r1 = await lib.create(complete());
    const libBefore = JSON.stringify([...data.entries()]);
    const span = assignCableType({ poles: ['A', 'B'] }, r1);
    const override: ElectricalValue<'ac'> = { value: 0.9, unit: 'ohm/km', basis: 'ac', source: { name: 'site measurement', reference: 'report 12', page: '3' }, verification: { status: 'checked', by: 'site engineer' } };
    const withOverride = setCableTypeOverride(span, 'rn', override);
    expect(withOverride.cableType!.overrides).toEqual({ rn: override });
    expect(withOverride.cableType!.snapshot).toEqual(r1);
    const eff = effectiveCableType(withOverride.cableType!);
    expect([eff.overridden, eff.data.rn.value, eff.data.r.value, eff.data.xn.value]).toEqual([['rn'], 0.9, 0.5, 0.09]);
    expect(JSON.stringify([...data.entries()])).toBe(libBefore);
    expect(await lib.current(r1.id)).toEqual(r1);
    // saved and read back with the project; removing the override leaves no empty record
    await saveProject(projectOf('p4', elementsWith(withOverride)));
    expect(spanOf((await loadProject('p4'))!.data.elements)!.cableType!.overrides).toEqual({ rn: override });
    expect(setCableTypeOverride(withOverride, 'rn', undefined).cableType!.overrides).toBeUndefined();
  });
  it('a project file keeps the reference, the revision, the snapshot and the overrides (export → import → store)', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    const span = setCableTypeOverride(assignCableType({ poles: ['A', 'B'], system: '3ph4w' }, r1, 7), 'xn', { value: 0.1, unit: 'ohm/km', basis: 'ac-50hz', verification: { status: 'unverified' } });
    const els = elementsWith(span);
    const v = validateProjectFile(JSON.parse(fileOf(els)));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(spanOf(v.data.elements)!.cableType).toEqual(span.cableType);
    useDrawingStore.getState().loadProject({ ...v.data });
    expect(spanOf(useDrawingStore.getState().elements)!.cableType).toEqual(span.cableType);
  });
  it('a malformed cable type reference is reported, never repaired', async () => {
    const lib = open(memory().backend);
    const r1 = await lib.create(complete());
    const good = assignCableType({ poles: ['A', 'B'] }, r1).cableType!;
    expect(spanCableTypeProblem(good)).toBeNull();
    expect(spanCableTypeProblem({ ...good, revision: 2 })).toBe('cableType.snapshot');
    expect(spanCableTypeProblem({ ...good, overrides: { rn: { value: 0, unit: 'ohm/km', basis: 'ac', verification: { status: 'unverified' } } } })).toBe('cableType.overrides.rn.value');
    expect(spanCableTypeProblem({ ...good, overrides: { z: {} } })).toBe('cableType.overrides.z');
    const broken = elementsWith({ cableType: { ...good, snapshot: { ...good.snapshot, xn: { ...good.snapshot.xn, basis: 'dc' } } } as never });
    expect(validateProjectFile(JSON.parse(fileOf(broken))).ok).toBe(false);
  });
});

describe('C10. values, basis and reference temperature through library, project save / load and file', () => {
  it('kept exactly: DC with 20 °C and a conversion request, unspecified without a temperature — nothing converted or added', async () => {
    const { backend } = memory();
    const lib = open(backend);
    const r = { value: 0.443, unit: 'ohm/km' as const, basis: 'dc' as const, referenceTempC: 20, conversion: 'dc20-to-conductor-temp' as const, verification: { status: 'checked' as const } };
    const rn = { value: 0.6, unit: 'ohm/km' as const, basis: 'unspecified' as const, verification: { status: 'approved' as const } };
    const r1 = await lib.create(complete({ r, rn }));
    const reread = await open(backend).current(r1.id);
    expect([reread.r, reread.rn]).toEqual([r, rn]);
    const span = assignCableType({ poles: ['A', 'B'] }, reread);
    await saveProject(projectOf('p-thermal', elementsWith(span)));
    const loaded = spanOf((await loadProject('p-thermal'))!.data.elements)!.cableType!;
    expect([loaded.snapshot.r, loaded.snapshot.rn]).toEqual([r, rn]);
    const v = validateProjectFile(JSON.parse(fileOf(elementsWith(span))));
    expect(v.ok && spanOf(v.data.elements)!.cableType!.snapshot.r).toEqual(r);
    useDrawingStore.getState().loadProject({ ...(v.ok ? v.data : ({} as never)) });
    expect(spanOf(useDrawingStore.getState().elements)!.cableType!.snapshot.rn).toEqual(rn);
    // an edit of another field keeps these values and their basis as they are
    const { revision } = await lib.edit(r1.id, 1, { name: 'renamed' });
    expect([revision.r, revision.rn]).toEqual([r, rn]);
  });
});

describe('12. existing projects without a cable type', () => {
  it('open unchanged: the same file before and after reading, and in the store', () => {
    const els = elementsWith({ cableKind: 'abc', material: 'al', crossSectionMm2: 70, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 'old' });
    const file = fileOf(els);
    const v = validateProjectFile(JSON.parse(file));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.data.elements).toEqual(JSON.parse(file).elements);
    expect(spanOf(v.data.elements)!.cableType).toBeUndefined();
    useDrawingStore.getState().loadProject({ ...v.data });
    expect(useDrawingStore.getState().elements).toEqual(JSON.parse(file).elements);
  });
  it('a saved project of the previous version reads back byte for byte', async () => {
    const p = projectOf('old', elementsWith({ parallel: 1, system: '3ph4w' }));
    await saveProject(p);
    expect(JSON.stringify((await loadProject('old'))!.data)).toBe(JSON.stringify(p.data));
  });
});
