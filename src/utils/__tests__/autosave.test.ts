import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrawingStore } from '../../store/drawingStore';
import {
  DRAFT_KEY, REJECTED_DRAFT_KEY, MESSAGES, DraftStorage, RestoreGuard, AutosaveHandle,
  startAutosave, restoreDraft, initAutosave, useAutosaveStatus, validateDraft, buildDraft,
} from '../autosave';
import { META_KEY } from '../projectStorage';
import { calculateCablePath } from '../cableLayout';
import type { CableElement, ConsumerElement, DrawingElement, SymbolElement } from '../../types/drawing';

// ---- helpers ---------------------------------------------------------------
const memoryStorage = (initial: Record<string, unknown> = {}) => {
  const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  const writes: string[] = [];
  const storage: DraftStorage = {
    get: async (k) => structuredClone(data.get(k)) as never,
    set: async (k, v) => { writes.push(k); data.set(k, structuredClone(v)); },
    del: async (k) => { writes.push(`del:${k}`); data.delete(k); },
  };
  return { storage, data, writes };
};
const memoryGuard = (): RestoreGuard & { value: string | null } => {
  const g = { value: null as string | null, get: () => g.value, set: (v: string) => { g.value = v; }, clear: () => { g.value = null; } };
  return g;
};
const rendered = async () => true;
const lifecycle = () => new EventTarget();

const initialState = useDrawingStore.getState();
// fresh app start: store back to its initial values
const resetStore = () => useDrawingStore.setState({ ...initialState }, true);

const pole = (id: string, x: number, y: number): SymbolElement =>
  ({ id, type: 'symbol', symbolId: 'lv_pole', width: 40, height: 40, x, y, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color = '#ff0000', offset?: number): CableElement =>
  ({ id, type: 'cable', poleIds, x: 0, y: 0, strokeColor: color, fillColor: 'transparent', strokeWidth: 2, ...(offset !== undefined ? { offset } : {}) } as unknown as CableElement);
const consumer = (id: string, poleId: string): ConsumerElement =>
  ({ id, type: 'consumer', poleId, x: 10, y: 10, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 } as unknown as ConsumerElement);

// Builds a drawing through the store's own actions (as the UI does).
const drawNetwork = () => {
  const s = () => useDrawingStore.getState();
  s().addElement(pole('A', 0, 0));
  s().addElement(pole('B', 200, 0));
  s().addElement(pole('C', 400, 0));
  s().addElement(cable('c1', ['A', 'B', 'C'], '#ff0000'));
  s().addElement(cable('c2', ['C', 'B', 'A'], '#0000ff')); // reverse-drawn, shares A–B–C
  s().addElement(consumer('k1', 'B'));
  s().updateConnectionDistance('A_B', '25');
  s().updateConnectionDistance('B_C', '30');
  s().updateConnectionLabelOffset('A_B', { x: 4, y: -6 });
  s().updateSymbolModifiers('B', { isTilted: true, note: { text: 'B-7', x: 3, y: 4 } });
  s().setPoleSizeScale(1.4);
  s().setConsumerVariant('square');
  s().setStyle({ strokeColor: '#123456' });
};

const persisted = () => {
  const s = useDrawingStore.getState();
  return {
    elements: s.elements, style: s.style, poleSizeScale: s.poleSizeScale, distanceTextScale: s.distanceTextScale,
    consumerSizeScale: s.consumerSizeScale, consumerVariant: s.consumerVariant,
    connectionDistances: s.connectionDistances, connectionLabelOffsets: s.connectionLabelOffsets,
    currentProjectId: s.currentProjectId, currentProjectName: s.currentProjectName,
  };
};
const geometry = (els: DrawingElement[]) =>
  els.filter((e): e is CableElement => e.type === 'cable').map((c) => calculateCablePath(c, els));

let handle: AutosaveHandle | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  useAutosaveStatus.setState({ message: null, kind: null, lastSavedAt: null });
});
afterEach(() => {
  handle?.stop();
  handle = null;
  vi.useRealTimers();
});

// Simulates closing the tab and opening the app again with the same storage.
const reload = async (storage: DraftStorage, guard = memoryGuard()) => {
  handle?.stop();
  resetStore();
  handle = await initAutosave({ storage, guard, rendered, lifecycle: lifecycle(), debounceMs: 500 });
  return handle;
};

// ---- 1 + 2: restore after reload, everything included -----------------------
describe('restore after reloading the app', () => {
  it('restores the drawing after a reload', async () => {
    const { storage } = memoryStorage();
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    useDrawingStore.getState().addElement(pole('A', 10, 20));
    await vi.advanceTimersByTimeAsync(600);
    await reload(storage);
    expect(useDrawingStore.getState().elements.map((e) => e.id)).toEqual(['A']);
  });

  it('restores elements, cables (order and poleIds), consumers, distances, label offsets, properties and project info', async () => {
    const { storage } = memoryStorage({ [META_KEY]: [{ id: 'P1', name: 'Line 4', createdAt: 1, updatedAt: 1 }] });
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    useDrawingStore.getState().setProjectInfo('P1', 'Line 4');
    drawNetwork();
    const before = structuredClone(persisted());
    const geoBefore = geometry(useDrawingStore.getState().elements);
    await vi.advanceTimersByTimeAsync(600);
    await reload(storage);
    expect(persisted()).toEqual(before);
    expect(geometry(useDrawingStore.getState().elements)).toEqual(geoBefore);
    expect((useDrawingStore.getState().elements.find((e) => e.id === 'B') as SymbolElement).modifiers).toEqual({ isTilted: true, note: { text: 'B-7', x: 3, y: 4 } });
  });

  it('a drag (many updates) is written once after it settles, not on every move', async () => {
    const { storage, writes } = memoryStorage();
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    useDrawingStore.getState().addElement(pole('A', 0, 0));
    for (let i = 1; i <= 60; i++) { useDrawingStore.getState().updateElement('A', { x: i }); await vi.advanceTimersByTimeAsync(16); }
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toEqual([DRAFT_KEY]);
    await reload(storage);
    expect(useDrawingStore.getState().elements[0].x).toBe(60);
  });
});

// ---- 3: saved projects are never replaced ----------------------------------
describe('manually saved projects are not replaced', () => {
  const savedProjects = {
    [META_KEY]: [{ id: 'P1', name: 'Saved', createdAt: 1, updatedAt: 1000 }],
    project_P1: { elements: [pole('X', 1, 1)], style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle' },
  };

  it('autosave only ever writes its own draft key', async () => {
    const { storage, data, writes } = memoryStorage(savedProjects);
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500, now: () => 2000 });
    useDrawingStore.getState().setProjectInfo('P1', 'Saved');
    drawNetwork();
    await vi.advanceTimersByTimeAsync(600);
    useDrawingStore.getState().clearCanvas();
    await vi.advanceTimersByTimeAsync(600);
    expect(new Set(writes)).toEqual(new Set([DRAFT_KEY]));
    expect(data.get(META_KEY)).toEqual(savedProjects[META_KEY]);
    expect(data.get('project_P1')).toEqual(savedProjects.project_P1);
  });

  it('keeps the project link when the saved project is not newer than the draft', async () => {
    const { storage } = memoryStorage({ ...savedProjects, [DRAFT_KEY]: buildDraft({ ...initialState, elements: [pole('A', 0, 0)], currentProjectId: 'P1', currentProjectName: 'Saved' }, 2000) });
    await reload(storage);
    expect(useDrawingStore.getState().currentProjectId).toBe('P1');
  });

  it('restores unlinked when the saved project was saved after the draft (a later Save cannot overwrite it)', async () => {
    const { storage, data } = memoryStorage({ ...savedProjects, [DRAFT_KEY]: buildDraft({ ...initialState, elements: [pole('A', 0, 0)], currentProjectId: 'P1', currentProjectName: 'Saved' }, 500) });
    await reload(storage);
    const s = useDrawingStore.getState();
    expect(s.elements.map((e) => e.id)).toEqual(['A']);
    expect(s.currentProjectId).toBeNull();
    expect(s.currentProjectName).toBe('Saved');
    expect(useAutosaveStatus.getState().message).toBe(MESSAGES.detached);
    expect(data.get('project_P1')).toEqual(savedProjects.project_P1);
  });

  it('restores unlinked when the linked id is not a saved project (e.g. an id taken from an imported file)', async () => {
    const { storage } = memoryStorage({ ...savedProjects, [DRAFT_KEY]: buildDraft({ ...initialState, elements: [pole('A', 0, 0)], currentProjectId: 'FROM-FILE', currentProjectName: 'Imported' }, 5000) });
    await reload(storage);
    expect(useDrawingStore.getState().currentProjectId).toBeNull();
    expect(useDrawingStore.getState().currentProjectName).toBe('Imported');
  });
});

// ---- 4: New Project ----------------------------------------------------------
describe('New Project does not mix with the previous draft', () => {
  it('after New Project (clear + unlink) the draft is removed, and new work is saved alone', async () => {
    const { storage, data } = memoryStorage({ [META_KEY]: [{ id: 'P1', name: 'Old', createdAt: 1, updatedAt: 1 }] });
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    useDrawingStore.getState().setProjectInfo('P1', 'Old');
    drawNetwork();
    await vi.advanceTimersByTimeAsync(600);
    // what ProjectManager.handleNewProject does
    useDrawingStore.getState().clearCanvas();
    useDrawingStore.getState().setProjectInfo(null, null);
    await vi.advanceTimersByTimeAsync(600);
    expect(data.has(DRAFT_KEY)).toBe(false);
    await reload(storage);
    expect(useDrawingStore.getState().elements).toEqual([]);
    expect(useDrawingStore.getState().currentProjectId).toBeNull();

    useDrawingStore.getState().addElement(pole('N', 5, 5));
    await vi.advanceTimersByTimeAsync(600);
    await reload(storage);
    const s = useDrawingStore.getState();
    expect(s.elements.map((e) => e.id)).toEqual(['N']);
    expect(s.connectionDistances).toEqual({});
    expect(s.connectionLabelOffsets).toEqual({});
    expect(s.currentProjectId).toBeNull();
    expect(s.currentProjectName).toBeNull();
  });

  it('drawing right after New Project (no reload in between) saves nothing from the old drawing', async () => {
    const { storage, data } = memoryStorage();
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    drawNetwork();
    await vi.advanceTimersByTimeAsync(600);
    useDrawingStore.getState().clearCanvas();
    useDrawingStore.getState().setProjectInfo(null, null);
    useDrawingStore.getState().addElement(pole('N', 5, 5));
    await vi.advanceTimersByTimeAsync(600);
    const saved = data.get(DRAFT_KEY) as ReturnType<typeof buildDraft>;
    expect(saved.data.elements.map((e) => e.id)).toEqual(['N']);
    expect(saved.data.connectionDistances).toEqual({});
    expect(saved.data.connectionLabelOffsets).toEqual({});
    expect(saved.projectId).toBeNull();
  });
});

// ---- 5: corrupt draft --------------------------------------------------------
describe('corrupt or incompatible draft', () => {
  const bad: [string, unknown][] = [
    ['not an object', 'garbage'],
    ['wrong version', { version: 99, savedAt: 1, data: { elements: [] } }],
    ['no elements', { version: 1, savedAt: 1, data: {} }],
    ['cable with poleIds missing', { version: 1, savedAt: 1, data: { elements: [{ id: 'c', type: 'cable', x: 0, y: 0 }] } }],
    ['consumer without pole', { version: 1, savedAt: 1, data: { elements: [{ id: 'k', type: 'consumer', x: 0, y: 0 }] } }],
    ['unknown element type', { version: 1, savedAt: 1, data: { elements: [{ id: 'q', type: 'rocket', x: 0, y: 0 }] } }],
  ];
  it.each(bad)('%s: not restored, empty canvas, saved projects and the bad draft kept aside', async (_n, raw) => {
    const saved = { [META_KEY]: [{ id: 'P1', name: 'Saved', createdAt: 1, updatedAt: 1 }], project_P1: { elements: [] } };
    const { storage, data } = memoryStorage({ ...saved, [DRAFT_KEY]: raw });
    await expect(reload(storage)).resolves.toBeTruthy();
    expect(useDrawingStore.getState().elements).toEqual([]);
    expect(useAutosaveStatus.getState()).toMatchObject({ kind: 'error', message: MESSAGES.invalid });
    expect(data.get(META_KEY)).toEqual(saved[META_KEY]);
    expect(data.get('project_P1')).toEqual(saved.project_P1);
    expect(data.get(REJECTED_DRAFT_KEY)).toEqual(raw);
  });

  it('duplicate ids (which the live app tolerates) do not make the whole draft be thrown away', () => {
    expect(validateDraft({ version: 1, savedAt: 1, data: { elements: [pole('A', 0, 0), pole('A', 5, 5)] } }).ok).toBe(true);
  });

  it('missing style / scales are filled with defaults instead of failing', () => {
    const v = validateDraft({ version: 1, savedAt: 1, data: { elements: [pole('A', 0, 0)] } });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.draft.data).toMatchObject({ style: { strokeColor: '#000000', strokeWidth: 2 }, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: {} });
  });

  it('a draft that made the app fail to render is not restored on the next start', async () => {
    const draft = buildDraft({ ...initialState, elements: [pole('A', 0, 0)] }, 777);
    const { storage, data } = memoryStorage({ [DRAFT_KEY]: draft });
    const guard = memoryGuard();
    handle = await initAutosave({ storage, guard, rendered: async () => false, lifecycle: lifecycle() }); // render "crashed"
    expect(guard.value).toBe('777');
    await reload(storage, guard);
    expect(useDrawingStore.getState().elements).toEqual([]);
    expect(useAutosaveStatus.getState().message).toBe(MESSAGES.crashed);
    expect(data.get(REJECTED_DRAFT_KEY)).toEqual(draft);
  });

  it('a storage read failure does not throw and leaves the canvas usable', async () => {
    const storage: DraftStorage = { get: async () => { throw new Error('IDB blocked'); }, set: async () => {}, del: async () => {} };
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle() });
    expect(useAutosaveStatus.getState().message).toBe(MESSAGES.readFailed);
    useDrawingStore.getState().addElement(pole('A', 0, 0));
    expect(useDrawingStore.getState().elements).toHaveLength(1);
  });
});

// ---- 6: storage failure ------------------------------------------------------
describe('storage write failure', () => {
  const failing = (err: Error) => {
    const m = memoryStorage();
    let fail = true;
    const storage: DraftStorage = { ...m.storage, set: async (k, v) => { if (fail) throw err; return m.storage.set(k, v); } };
    return { storage, data: m.data, heal: () => { fail = false; } };
  };
  it('quota exceeded shows a clear message and claims no save', async () => {
    const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    const f = failing(quota);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handle = await initAutosave({ storage: f.storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    useDrawingStore.getState().addElement(pole('A', 0, 0));
    await vi.advanceTimersByTimeAsync(600);
    expect(useAutosaveStatus.getState()).toMatchObject({ kind: 'error', message: MESSAGES.quota, lastSavedAt: null });
    expect(f.data.has(DRAFT_KEY)).toBe(false);
    // the drawing itself is untouched
    expect(useDrawingStore.getState().elements).toHaveLength(1);
    // once storage works again the next change is saved and the error clears
    f.heal();
    useDrawingStore.getState().updateElement('A', { x: 9 });
    await vi.advanceTimersByTimeAsync(600);
    expect(f.data.has(DRAFT_KEY)).toBe(true);
    expect(useAutosaveStatus.getState().kind).toBeNull();
    expect(useAutosaveStatus.getState().lastSavedAt).not.toBeNull();
  });
  it('any other write error shows the generic failure message', async () => {
    const f = failing(new Error('Transaction aborted'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    handle = await initAutosave({ storage: f.storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    useDrawingStore.getState().addElement(pole('A', 0, 0));
    await vi.advanceTimersByTimeAsync(600);
    expect(useAutosaveStatus.getState().message).toBe(MESSAGES.writeFailed);
  });
});

// ---- 7: leaving the page -----------------------------------------------------
describe('leaving the page does not lose the last edit', () => {
  it.each(['pagehide', 'beforeunload'])('%s writes the pending change immediately', async (evt) => {
    const { storage } = memoryStorage();
    const target = lifecycle();
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: target, debounceMs: 5000 });
    useDrawingStore.getState().addElement(pole('A', 0, 0));
    useDrawingStore.getState().updateElement('A', { x: 42 });
    target.dispatchEvent(new Event(evt));
    await handle.idle();
    await reload(storage);
    expect(useDrawingStore.getState().elements[0].x).toBe(42);
  });
  it('switching away (visibilitychange → hidden, e.g. iOS app switcher) writes immediately', async () => {
    const { storage, data } = memoryStorage();
    const target = lifecycle();
    let hidden = false;
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: target, isHidden: () => hidden, debounceMs: 5000 });
    useDrawingStore.getState().addElement(pole('A', 0, 0));
    target.dispatchEvent(new Event('visibilitychange')); // still visible → nothing yet
    await handle.idle();
    expect(data.has(DRAFT_KEY)).toBe(false);
    hidden = true;
    target.dispatchEvent(new Event('visibilitychange'));
    await handle.idle();
    expect(data.has(DRAFT_KEY)).toBe(true);
  });
});

// ---- 8: no undo steps, no cable order change ---------------------------------
describe('autosave is invisible to undo/redo and cable layout', () => {
  it('saving adds no history entries and does not change elements or cable order', async () => {
    const { storage } = memoryStorage();
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    drawNetwork();
    const s0 = useDrawingStore.getState();
    const snap = { history: s0.history, redo: s0.redoStack, elements: s0.elements, geo: geometry(s0.elements) };
    await vi.advanceTimersByTimeAsync(600);
    await handle.flush();
    const s1 = useDrawingStore.getState();
    expect(s1.history).toBe(snap.history);
    expect(s1.redoStack).toBe(snap.redo);
    expect(s1.elements).toBe(snap.elements);
    expect(geometry(s1.elements)).toEqual(snap.geo);
    // undo still walks back exactly the user's steps
    const steps = s1.history.length;
    for (let i = 0; i < steps; i++) useDrawingStore.getState().undo();
    expect(useDrawingStore.getState().elements).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(useDrawingStore.getState().history).toHaveLength(0);
  });
  it('restoring a draft starts with an empty undo history (no extra steps) and identical cable geometry', async () => {
    const { storage } = memoryStorage();
    handle = await initAutosave({ storage, guard: memoryGuard(), rendered, lifecycle: lifecycle(), debounceMs: 500 });
    drawNetwork();
    const els = structuredClone(useDrawingStore.getState().elements);
    await vi.advanceTimersByTimeAsync(600);
    await reload(storage);
    const s = useDrawingStore.getState();
    expect(s.history).toEqual([]);
    expect(s.redoStack).toEqual([]);
    expect(s.elements.filter((e) => e.type === 'cable').map((c) => [c.id, (c as CableElement).poleIds])).toEqual(
      els.filter((e) => e.type === 'cable').map((c) => [c.id, (c as CableElement).poleIds]));
    expect(geometry(s.elements)).toEqual(geometry(els));
  });
  it('a restore does not rewrite the draft by itself', async () => {
    const draft = buildDraft({ ...initialState, elements: [pole('A', 0, 0)] }, 123);
    const { storage, writes } = memoryStorage({ [DRAFT_KEY]: draft });
    await reload(storage);
    await vi.advanceTimersByTimeAsync(2000);
    expect(writes).toEqual([]);
  });
});

describe('restore never overrides work started before it finished', () => {
  it('skips the draft if the canvas already has content', async () => {
    const { storage } = memoryStorage({ [DRAFT_KEY]: buildDraft({ ...initialState, elements: [pole('OLD', 0, 0)] }, 1) });
    useDrawingStore.getState().addElement(pole('NEW', 0, 0));
    const r = await restoreDraft({ storage, guard: memoryGuard(), rendered });
    expect(r.status).toBe('skipped');
    expect(useDrawingStore.getState().elements.map((e) => e.id)).toEqual(['NEW']);
  });
});
