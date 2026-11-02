import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The projects' IndexedDB (idb-keyval default store), in memory; createStore is counted so that
// importing the library layer is shown not to open any database.
const idb = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const calls = { get: 0, set: 0, createStore: 0 };
  const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    data, calls,
    api: {
      get: async (k: string) => { calls.get++; return clone(data.get(k)); },
      set: async (k: string, v: unknown) => { calls.set++; data.set(k, clone(v)); },
      del: async (k: string) => { data.delete(k); },
      setMany: async (entries: [string, unknown][]) => { calls.set++; for (const [k, v] of entries) data.set(k, clone(v)); },
      keys: async () => [...data.keys()],
      createStore: () => { calls.createStore++; throw new Error('no real IndexedDB in tests'); },
    },
  };
});
vi.mock('idb-keyval', () => idb.api);

import type { CableTypeData } from '../../types/cableType';
import type { CableLibraryBackend } from '../../utils/cableLibraryStorage';
import { openCableLibrary } from '../../utils/cableLibraryStorage';
import { createCableLibraryController, INITIAL_CABLE_LIBRARY_STATE, useCableLibrary, type CableLibraryController, type CableLibraryState } from '../cableLibraryStore';
import { saveProject, loadProject } from '../../utils/projectStorage';
import { translate } from '../../i18n';
import { DEFAULT_ELECTRICAL } from '../../utils/electricalSettings';

// ALL VALUES ARE SYNTHETIC.

/** an in-memory library backend: calls counted, failures and delays on demand */
const backend = () => {
  const data = new Map<string, unknown>();
  const calls = { get: 0, set: 0, keys: 0 };
  const fail: { get?: Error; set?: Error; keys?: Error } = {};
  let gate: Promise<void> | undefined;
  const b: CableLibraryBackend = {
    get: async <T,>(k: string) => { calls.get++; if (fail.get) throw fail.get; return data.has(k) ? (structuredClone(data.get(k)) as T) : undefined; },
    set: async (k, v) => { calls.set++; if (fail.set) throw fail.set; data.set(k, structuredClone(v)); },
    keys: async () => { calls.keys++; if (gate) await gate; if (fail.keys) throw fail.keys; return [...data.keys()]; },
  };
  /** the next list waits until the returned function is called */
  const hold = () => { let release!: () => void; gate = new Promise<void>((r) => { release = r; }); return () => { gate = undefined; release(); }; };
  return { data, calls, fail, b, hold };
};
let ids = 0;
const make = (b: CableLibraryBackend) => createCableLibraryController({ backend: b, now: () => 1000 + ids, newId: () => `ct_t${++ids}` });
const direct = (b: CableLibraryBackend) => openCableLibrary({ backend: b, now: () => 5, newId: () => `ct_d${++ids}` });
const val = (value: number | undefined, basis: 'ac' | 'ac-50hz') => ({ ...(value !== undefined ? { value } : {}), unit: 'ohm/km' as const, basis, verification: { status: 'checked' as const } }) as never;
const cable = (name: string): CableTypeData => ({
  name, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: 70 }, neutral: { material: 'alloy', sectionMm2: 54.6 },
  r: val(0.5, 'ac'), x: val(0.08, 'ac-50hz'), rn: val(0.6, 'ac'), xn: val(0.09, 'ac-50hz'), source: { name: 'synthetic' },
});
const typeKeys = (data: Map<string, unknown>) => [...data.keys()].filter((k) => k.startsWith('type:'));
const state = (c: CableLibraryController): CableLibraryState => c.store.getState();

describe('loading', () => {
  it('1. loads the list: idle → loading → ready, with the library\'s own records', async () => {
    const { b } = backend();
    const a = await direct(b).create(cable('A'));
    const z = await direct(b).create(cable('B'));
    const c = make(b);
    expect(state(c)).toEqual(INITIAL_CABLE_LIBRARY_STATE);
    const seen: string[] = [];
    c.store.subscribe((s) => seen.push(s.status));
    const p = c.load();
    expect(state(c).status).toBe('loading');
    await p;
    expect(seen).toEqual(['loading', 'ready']);
    expect(state(c).types.map((t) => t.id).sort()).toEqual([a.id, z.id].sort());
    expect(state(c).types.find((t) => t.id === a.id)).toEqual(a);
    expect(state(c).error).toBeUndefined();
  });
  it('2 / 7. an empty library: status empty — no cable type, no default record or value is created', async () => {
    const { b, data } = backend();
    const c = make(b);
    await c.load();
    expect(state(c)).toMatchObject({ status: 'empty', types: [], problems: [] });
    expect(typeKeys(data)).toEqual([]);
    // only the library's own format record (written by cableLibraryStorage on first use)
    expect([...data.keys()]).toEqual(['meta']);
  });
  it('a record that cannot be read is listed as a problem, kept, and the rest is shown', async () => {
    const { b, data } = backend();
    await direct(b).create(cable('A'));
    data.set('type:broken', { id: 'broken', revisions: [] });
    const c = make(b);
    await c.load();
    expect(state(c).status).toBe('ready');
    expect(state(c).problems).toEqual([{ key: 'type:broken', problem: 'revisions' }]);
    expect(data.has('type:broken')).toBe(true);
  });
  it('4. no needless requests: concurrent loads share one read; a loaded list is not read again unless reloaded', async () => {
    const { b, calls } = backend();
    const c = make(b);
    await Promise.all([c.load(), c.load(), c.load()]);
    expect(calls.keys).toBe(1);
    await c.load();
    expect(calls.keys).toBe(1);
    await c.reload();
    expect(calls.keys).toBe(2);
  });
  it('4. reload sees what was added elsewhere (another tab / instance)', async () => {
    const { b } = backend();
    const c = make(b);
    await c.load();
    expect(state(c).status).toBe('empty');
    const added = await direct(b).create(cable('elsewhere'));
    await c.load();
    expect(state(c).types).toEqual([]); // not read again by itself
    await c.reload();
    expect(state(c)).toMatchObject({ status: 'ready', types: [added] });
  });
});

describe('errors', () => {
  it('3. an IndexedDB read error: status error (kind read), the message kept; retry recovers and clears it', async () => {
    const { b, fail } = backend();
    fail.keys = new Error('QuotaExceededError: IDB unavailable');
    const c = make(b);
    await c.load();
    expect(state(c)).toMatchObject({ status: 'error', error: { operation: 'load', kind: 'read', message: 'QuotaExceededError: IDB unavailable' } });
    fail.keys = undefined;
    await c.reload();
    expect(state(c).status).toBe('empty');
    expect(state(c).error).toBeUndefined();
  });
  it('3. a newer library format: error kind format (nothing written over it)', async () => {
    const { b, data } = backend();
    data.set('meta', { format: 'lv-cable-library', version: 99 });
    const c = make(b);
    await c.load();
    expect(state(c)).toMatchObject({ status: 'error', error: { kind: 'format' } });
    expect(data.get('meta')).toEqual({ format: 'lv-cable-library', version: 99 });
  });
  it('3. a write error: thrown to the caller, recorded (kind write), the list unchanged, not saving any more', async () => {
    const { b, fail, data } = backend();
    const c = make(b);
    await c.load();
    fail.set = new Error('write failed');
    await expect(c.create(cable('X'))).rejects.toThrow('write failed');
    expect(state(c)).toMatchObject({ status: 'empty', types: [], saving: false, error: { operation: 'create', kind: 'write' } });
    expect(typeKeys(data)).toEqual([]);
  });
  it('3. an edit on a stale revision: kind conflict, nothing written', async () => {
    const { b } = backend();
    const c = make(b);
    const t = await c.create(cable('A'));
    await direct(b).edit(t.id, 1, { name: 'changed elsewhere' });
    await expect(c.edit(t.id, 1, { name: 'mine' })).rejects.toMatchObject({ kind: 'conflict' });
    expect(state(c).error).toMatchObject({ operation: 'edit', kind: 'conflict' });
    expect((await c.history(t.id)).revisions.map((r) => r.name)).toEqual(['A', 'changed elsewhere']);
  });
});

describe('changes', () => {
  it('5. the list follows a create, an edit and a verification (read again from the library)', async () => {
    const { b } = backend();
    const c = make(b);
    await c.load();
    const t = await c.create(cable('A'));
    expect(state(c)).toMatchObject({ status: 'ready', types: [t], saving: false });
    const e = await c.edit(t.id, 1, { name: 'A2' });
    expect(e.revision.revision).toBe(2);
    expect(state(c).types).toEqual([e.revision]);
    const v = await c.setVerification(t.id, 2, 'r', { status: 'approved', by: 'eng' });
    expect(state(c).types[0]).toMatchObject({ revision: 3, r: { verification: { status: 'approved', by: 'eng' } } });
    expect(v.changes).toEqual(['r.verification']);
    expect((await c.revision(t.id, 1))!.name).toBe('A');
  });
  it('saving is true while a write runs', async () => {
    const { b } = backend();
    const c = make(b);
    const p = c.create(cable('A'));
    expect(state(c).saving).toBe(true);
    await p;
    expect(state(c).saving).toBe(false);
  });
});

describe('6. no state change after unmount', () => {
  it('a listener that unsubscribed (a component that unmounted) is not called when the load ends', async () => {
    const { b, hold } = backend();
    const c = make(b);
    const release = hold();
    const listener = vi.fn();
    const unsubscribe = c.store.subscribe(listener);
    const p = c.load();
    listener.mockClear();
    unsubscribe();
    release();
    await p;
    expect(listener).not.toHaveBeenCalled();
  });
  it('after dispose, a load that ends changes nothing', async () => {
    const { b, hold } = backend();
    await direct(b).create(cable('A'));
    const c = make(b);
    const release = hold();
    const p = c.load();
    c.dispose();
    release();
    await p;
    expect(state(c)).toMatchObject({ status: 'loading', types: [] });
    await c.load();
    expect(state(c).status).toBe('loading');
  });
  it('a superseded load (reload while loading) never overwrites the newer result', async () => {
    const { b, hold } = backend();
    const c = make(b);
    const release = hold();
    const first = c.load();
    const t = await direct(b).create(cable('newer')); // the held list will run after this, and is dropped
    const second = c.reload();
    release();
    await Promise.all([first, second]);
    expect(state(c).types).toEqual([t]);
  });
  it('the hook renders from the store (with or without a selector) and does nothing by itself when autoLoad is off', async () => {
    const { b } = backend();
    const c = make(b);
    const View: React.FC = () => {
      const s = useCableLibrary({ controller: c, autoLoad: false });
      const n = useCableLibrary((x) => x.types.length, { controller: c, autoLoad: false });
      return React.createElement('p', { 'data-status': s.status }, String(n));
    };
    expect(renderToStaticMarkup(React.createElement(View))).toBe('<p data-status="idle">0</p>');
    // (a server render reads zustand's initial state by design; live updates are the store's, tested above)
    expect(state(c).status).toBe('idle'); // rendering did not load (autoLoad off) nor write anything
  });
});

describe('8. the library is kept apart from project data', () => {
  it('library reads and writes never touch the projects\' store, and saving a project never touches the library', async () => {
    const { b, data } = backend();
    const c = make(b);
    const project = { id: 'p1', name: 'p', createdAt: 1, updatedAt: 2, data: { elements: [], style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle' as const, electrical: DEFAULT_ELECTRICAL } };
    await saveProject(project);
    const projectKeys = [...idb.data.keys()].sort();
    const before = { get: idb.calls.get, set: idb.calls.set };
    await c.load();
    await c.create(cable('A'));
    await c.reload();
    expect({ get: idb.calls.get, set: idb.calls.set }).toEqual(before);
    expect([...idb.data.keys()].sort()).toEqual(projectKeys);
    const libraryBefore = JSON.stringify([...data.entries()]);
    await saveProject({ ...project, updatedAt: 3 });
    expect(JSON.stringify([...data.entries()])).toBe(libraryBefore);
    expect(typeKeys(idb.data)).toEqual([]);
    expect((await loadProject('p1'))!.data).toEqual(project.data);
  });
  it('importing the layer opens no database (the app\'s library is created on first use only)', () => {
    expect(idb.calls.createStore).toBe(0);
  });
});

describe('texts', () => {
  it('the library texts exist in both languages, with the count filled in', () => {
    const keys = ['title', 'loading', 'empty', 'loadFailed', 'saveFailed', 'retry', 'cableStatus.label', 'cableStatus.complete', 'cableStatus.draft', 'revisionHistory', 'add', 'edit',
      'errors.read', 'errors.write', 'errors.conflict', 'errors.format', 'errors.not-found', 'errors.exists', 'unreadable'] as const;
    for (const k of keys) for (const l of ['ar', 'en'] as const) expect(translate(l, `cableLibrary.${k}`).length, `${l} ${k}`).toBeGreaterThan(0);
    expect(translate('ar', 'cableLibrary.count', { n: 3 })).toBe('عدد أنواع الكوابل: 3');
    expect(translate('en', 'cableLibrary.count', { n: 3 })).toBe('Cable types: 3');
    expect(translate('ar', 'cableLibrary.title')).toBe('مكتبة الكوابل');
  });
});
