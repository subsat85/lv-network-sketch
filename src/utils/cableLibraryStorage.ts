// Stage B: the global cable library, kept in its own IndexedDB database (idb-keyval, like the projects),
// separate from the projects' store. Versioned: a `meta` record names the format and its version.
//
// Records:
//   'meta'          → { format: 'lv-cable-library', version: 1 }
//   'type:<id>'     → CableTypeHistory (every revision, oldest first)
// A revision once written is never changed; an edit appends a new one. Nothing is migrated or deleted
// on read: a record that cannot be read is reported and left as it is.

import { createStore, get, set, keys, type UseStore } from 'idb-keyval';
import type { CableTypeData, CableTypeHistory, CableTypeRevision, ElectricalProperty, Verification } from '../types/cableType';
import {
  cableTypeHistoryProblem, createCableType, editCableType, findRevision, latestRevision, setCableTypeVerification,
  type CableTypeChange, type CableTypeEdit, type RevisionMeta,
} from './cableTypeModel';

export const CABLE_LIBRARY_DB = 'lv-network-sketch-cable-library';
export const CABLE_LIBRARY_STORE = 'cable-types';
export const CABLE_LIBRARY_FORMAT = 'lv-cable-library';
export const CABLE_LIBRARY_VERSION = 1;
const META_KEY = 'meta';
const typeKey = (id: string) => `type:${id}`;

/** the storage the library is written to (IndexedDB in the app; an in-memory one in tests) */
export interface CableLibraryBackend {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  keys(): Promise<string[]>;
}

let idbStore: UseStore | undefined;
/** the app's backend: a separate IndexedDB database, opened on first use */
export const idbCableLibraryBackend = (): CableLibraryBackend => {
  const store = () => (idbStore ??= createStore(CABLE_LIBRARY_DB, CABLE_LIBRARY_STORE));
  return {
    get: <T,>(k: string) => get<T>(k, store()),
    set: (k, v) => set(k, v, store()),
    keys: async () => (await keys(store())).map(String),
  };
};

export class CableLibraryError extends Error {
  constructor(public readonly kind: 'not-found' | 'conflict' | 'format' | 'exists', message: string) { super(message); }
}

export interface LibraryReadProblem { key: string; problem: string }

export interface CableLibraryOptions {
  backend?: CableLibraryBackend;
  /** ms since epoch; the app passes Date.now */
  now?: () => number;
  newId?: () => string;
}

const defaultId = () => 'ct_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const openCableLibrary = (opts: CableLibraryOptions = {}) => {
  const db = opts.backend ?? idbCableLibraryBackend();
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? defaultId;

  /** checks the format record (a newer version is not written over); writes it when the library is new */
  const ready = async (): Promise<void> => {
    const meta = await db.get<{ format?: unknown; version?: unknown }>(META_KEY);
    if (meta === undefined) { await db.set(META_KEY, { format: CABLE_LIBRARY_FORMAT, version: CABLE_LIBRARY_VERSION }); return; }
    if (meta.format !== CABLE_LIBRARY_FORMAT || typeof meta.version !== 'number' || meta.version > CABLE_LIBRARY_VERSION)
      throw new CableLibraryError('format', `cable library format ${String(meta.format)} v${String(meta.version)} is not readable`);
  };

  const read = async (id: string): Promise<CableTypeHistory> => {
    const h = await db.get<CableTypeHistory>(typeKey(id));
    if (h === undefined) throw new CableLibraryError('not-found', `cable type ${id} not found`);
    const bad = cableTypeHistoryProblem(h);
    if (bad) throw new CableLibraryError('format', `cable type ${id}: ${bad}`);
    return h;
  };

  /** a write based on the revision the caller saw: a newer one in the store is a conflict, never overwritten */
  const write = async (id: string, expectedRevision: number, change: (h: CableTypeHistory) => { history: CableTypeHistory; changes: CableTypeChange[] }) => {
    await ready();
    const h = await read(id);
    const last = latestRevision(h);
    if (last.revision !== expectedRevision) throw new CableLibraryError('conflict', `cable type ${id}: revision ${last.revision} in the library, the edit was made on ${expectedRevision}`);
    const r = change(h);
    if (r.history !== h) await db.set(typeKey(id), r.history);
    return { revision: latestRevision(r.history), changes: r.changes, history: r.history };
  };

  return {
    /** a new cable type (revision 1). A draft with missing values is saved as it is */
    async create(data: CableTypeData, meta: Omit<RevisionMeta, 'now'> = {}): Promise<CableTypeRevision> {
      await ready();
      const id = newId();
      if (await db.get(typeKey(id)) !== undefined) throw new CableLibraryError('exists', `cable type ${id} exists`);
      const h = createCableType(id, data, { ...meta, now: now() });
      await db.set(typeKey(id), h);
      return latestRevision(h);
    },
    /** every cable type (its current revision), and the records that could not be read */
    async list(): Promise<{ types: CableTypeRevision[]; problems: LibraryReadProblem[] }> {
      await ready();
      const types: CableTypeRevision[] = [];
      const problems: LibraryReadProblem[] = [];
      for (const k of (await db.keys()).filter((k) => k.startsWith('type:')).sort()) {
        const h = await db.get<CableTypeHistory>(k);
        const bad = cableTypeHistoryProblem(h);
        if (bad) problems.push({ key: k, problem: bad });
        else types.push(latestRevision(h!));
      }
      return { types, problems };
    },
    history: async (id: string) => { await ready(); return read(id); },
    current: async (id: string) => { await ready(); return latestRevision(await read(id)); },
    async revision(id: string, revision: number): Promise<CableTypeRevision | undefined> { await ready(); return findRevision(await read(id), revision); },
    /** a new revision; changed electrical values become 'unverified' */
    edit: (id: string, expectedRevision: number, edit: CableTypeEdit, meta: Omit<RevisionMeta, 'now'> = {}) =>
      write(id, expectedRevision, (h) => editCableType(h, edit, { ...meta, now: now() })),
    /** a new revision with one value's verification changed */
    setVerification: (id: string, expectedRevision: number, property: ElectricalProperty, verification: Verification, meta: Omit<RevisionMeta, 'now'> = {}) =>
      write(id, expectedRevision, (h) => setCableTypeVerification(h, property, verification, { ...meta, now: now() })),
  };
};

export type CableLibrary = ReturnType<typeof openCableLibrary>;
