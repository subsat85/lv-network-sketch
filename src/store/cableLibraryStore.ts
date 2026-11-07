import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CableTypeData, CableTypeHistory, CableTypeRevision, ElectricalProperty, Verification } from '../types/cableType';
import type { CableTypeChange, CableTypeEdit, RevisionMeta } from '../utils/cableTypeModel';
import { CableLibraryError, openCableLibrary, type CableLibrary, type CableLibraryOptions, type LibraryReadProblem } from '../utils/cableLibraryStorage';
import { defaultCableState, type DefaultCable, type DefaultCableState } from '../utils/defaultCable';

// Stage C1: the app's view of the global cable library (IndexedDB, Stage B). This layer keeps only
// what the screens show — the list, its status, the last error — and calls the library's own
// functions (cableLibraryStorage.ts) for every read and write: no storage logic is repeated here,
// nothing is written by reading (apart from the library's own format record), no cable type or
// default value is ever created by it, and it never touches project data. It only tells whoever
// subscribed which revisions were saved (subscribe / batch): the open project is moved to them by
// cableLibrarySync.ts, at the drawing store.

/** loading → ready | empty | error. 'idle': nothing asked yet */
export type CableLibraryStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
export type CableLibraryOperation = 'load' | 'create' | 'edit' | 'verify' | 'default';
/** 'read' / 'write': IndexedDB failed; the others come from the library (CableLibraryError) */
export type CableLibraryErrorKind = 'read' | 'write' | 'conflict' | 'format' | 'not-found' | 'exists';

export interface CableLibraryFailure {
  operation: CableLibraryOperation;
  kind: CableLibraryErrorKind;
  message: string;
}

export interface CableLibraryState {
  status: CableLibraryStatus;
  /** the current revision of every readable cable type, as the library lists them */
  types: readonly CableTypeRevision[];
  /** records the library could not read: shown, never deleted */
  problems: readonly LibraryReadProblem[];
  /** the last failure (a load that failed, or a write); cleared by the next success of that kind */
  error?: CableLibraryFailure;
  /** a write is in progress */
  saving: boolean;
  /** the app's default cable against this list ('none' until it is read) */
  defaultCable: DefaultCableState;
}

export const INITIAL_CABLE_LIBRARY_STATE: CableLibraryState = { status: 'idle', types: [], problems: [], saving: false, defaultCable: { kind: 'none' } };

const failure = (operation: CableLibraryOperation, e: unknown): CableLibraryFailure => {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof CableLibraryError) return { operation, kind: e.kind, message };
  return { operation, kind: operation === 'load' ? 'read' : 'write', message };
};

export interface CableLibraryController {
  store: StoreApi<CableLibraryState>;
  /** Loads the list once. A load already running is shared; a loaded list is not read again
   *  unless `force` (then a running load is superseded: its result is dropped). */
  load(opts?: { force?: boolean }): Promise<void>;
  /** load({ force: true }) */
  reload(): Promise<void>;
  /** A new cable type (a draft may have missing values); the list is read again after it. */
  create(data: CableTypeData, meta?: Omit<RevisionMeta, 'now'>): Promise<CableTypeRevision>;
  /** A new revision of a cable type, on the revision the caller saw (else 'conflict'). */
  edit(id: string, expectedRevision: number, edit: CableTypeEdit, meta?: Omit<RevisionMeta, 'now'>): Promise<{ revision: CableTypeRevision; changes: CableTypeChange[] }>;
  /** A new revision with one value's verification changed. */
  setVerification(id: string, expectedRevision: number, property: ElectricalProperty, verification: Verification, meta?: Omit<RevisionMeta, 'now'>): Promise<{ revision: CableTypeRevision; changes: CableTypeChange[] }>;
  /** Read-only, straight from the library (not kept in this state). */
  history(id: string): Promise<CableTypeHistory>;
  revision(id: string, revision: number): Promise<CableTypeRevision | undefined>;
  /** This exact revision becomes the app's default cable (the list is read again after it). */
  setDefault(id: string, revision: number): Promise<DefaultCable>;
  /**
   * Called with the revisions an edit or a verification saved (after the library has them and the list
   * is read again). Inside batch() they are held and given once, at its end, as the latest revision of
   * each cable type saved in it — also when a later step of it failed (what was saved is saved).
   * A listener that throws never fails the library operation. Returns the unsubscribe function.
   */
  subscribe(listener: (saved: readonly CableTypeRevision[]) => void): () => void;
  /** Several writes that are one save for the person (the editor: the data, then each verification). */
  batch<T>(run: () => Promise<T>): Promise<T>;
  /** No state is changed after this (results still arriving are dropped). */
  dispose(): void;
}

export const createCableLibraryController = (opts: CableLibraryOptions & { library?: CableLibrary } = {}): CableLibraryController => {
  const { library: given, ...libraryOptions } = opts;
  let library = given;
  const lib = () => (library ??= openCableLibrary(libraryOptions));
  const store = createStore<CableLibraryState>(() => ({ ...INITIAL_CABLE_LIBRARY_STATE }));
  let disposed = false;
  let generation = 0;
  let inFlight: Promise<void> | undefined;
  const set = (patch: Partial<CableLibraryState>) => { if (!disposed) store.setState(patch); };

  // saved revisions → subscribers (held during a batch: the latest of each cable type)
  const listeners = new Set<(saved: readonly CableTypeRevision[]) => void>();
  let depth = 0;
  const held = new Map<string, CableTypeRevision>();
  const tell = (saved: readonly CableTypeRevision[]) => {
    if (disposed || !saved.length) return;
    for (const l of [...listeners]) { try { l(saved); } catch { /* a listener never fails the save */ } }
  };
  const saved = (r: CableTypeRevision) => {
    if (depth) { const h = held.get(r.id); if (!h || h.revision < r.revision) held.set(r.id, r); return; }
    tell([r]);
  };

  const load = (o: { force?: boolean } = {}): Promise<void> => {
    if (disposed) return Promise.resolve();
    const s = store.getState();
    if (!o.force) {
      if (inFlight) return inFlight;
      if (s.status === 'ready' || s.status === 'empty') return Promise.resolve();
    }
    const mine = ++generation;
    set({ status: 'loading' });
    const run = (async () => {
      try {
        const { types, problems } = await lib().list();
        // the default cable: a record that cannot be read is shown as such (the list still loads)
        let def: DefaultCableState;
        try { def = defaultCableState(await lib().getDefault(), types); } catch { def = { kind: 'unreadable' }; }
        if (disposed || mine !== generation) return; // unmounted / superseded: dropped
        const error = store.getState().error;
        set({ status: types.length ? 'ready' : 'empty', types, problems, defaultCable: def, ...(error?.operation === 'load' ? { error: undefined } : {}) });
      } catch (e) {
        if (disposed || mine !== generation) return;
        set({ status: 'error', error: failure('load', e) });
      } finally {
        if (mine === generation) inFlight = undefined;
      }
    })();
    inFlight = run;
    return run;
  };

  /** a write, then the list read again (the list is what the library holds, never patched here) */
  const write = async <T,>(operation: CableLibraryOperation, act: () => Promise<T>): Promise<T> => {
    set({ saving: true });
    try {
      const out = await act();
      const error = store.getState().error;
      set({ saving: false, ...(error && error.operation !== 'load' ? { error: undefined } : {}) });
      await load({ force: true });
      return out;
    } catch (e) {
      set({ saving: false, error: failure(operation, e) });
      throw e;
    }
  };

  return {
    store,
    load,
    reload: () => load({ force: true }),
    create: (data, meta) => write('create', () => lib().create(data, meta)),
    edit: (id, expectedRevision, edit, meta) => write('edit', () => lib().edit(id, expectedRevision, edit, meta)).then(({ revision, changes }) => { saved(revision); return { revision, changes }; }),
    setVerification: (id, expectedRevision, property, verification, meta) =>
      write('verify', () => lib().setVerification(id, expectedRevision, property, verification, meta)).then(({ revision, changes }) => { saved(revision); return { revision, changes }; }),
    history: (id) => lib().history(id),
    revision: (id, revision) => lib().revision(id, revision),
    setDefault: (id, revision) => write('default', () => lib().setDefault(id, revision)),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    batch: async (run) => {
      depth++;
      try { return await run(); } finally {
        if (--depth === 0 && held.size) { const out = [...held.values()]; held.clear(); tell(out); }
      }
    },
    dispose: () => { disposed = true; inFlight = undefined; listeners.clear(); },
  };
};

// ---------- the app's library (one, opened on first use) ----------

let appController: CableLibraryController | undefined;
/** The app's cable library (IndexedDB, its own database). Created on first use, never at import. */
export const getCableLibrary = (): CableLibraryController => (appController ??= createCableLibraryController());

/**
 * The library state for a component. On mount it asks for the list (shared and loaded once; see
 * load). The component is never set from a load: the state lives in the store, so a load that
 * ends after the component is gone changes nothing in it.
 */
export function useCableLibrary(opts?: { autoLoad?: boolean; controller?: CableLibraryController }): CableLibraryState & { controller: CableLibraryController };
export function useCableLibrary<T>(selector: (s: CableLibraryState) => T, opts?: { autoLoad?: boolean; controller?: CableLibraryController }): T;
export function useCableLibrary<T>(
  a?: ((s: CableLibraryState) => T) | { autoLoad?: boolean; controller?: CableLibraryController },
  b?: { autoLoad?: boolean; controller?: CableLibraryController },
) {
  const selector = typeof a === 'function' ? a : undefined;
  const opts = (typeof a === 'function' ? b : a) ?? {};
  const controller = opts.controller ?? getCableLibrary();
  const autoLoad = opts.autoLoad ?? true;
  const state = useStore(controller.store, (selector ?? ((s: CableLibraryState) => s)) as (s: CableLibraryState) => T | CableLibraryState);
  useEffect(() => { if (autoLoad) void controller.load(); }, [controller, autoLoad]);
  return selector ? state : { ...(state as CableLibraryState), controller };
}
