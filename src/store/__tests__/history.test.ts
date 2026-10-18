import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrawingStore, HISTORY_LIMIT, historyGestureStart, historyGestureEnd } from '../drawingStore';
import { startAutosave, DraftStorage } from '../../utils/autosave';
import { parseProjectFile, serializeProject } from '../../utils/projectSerialization';
import { applyImport, planImport } from '../../utils/projectImport';
import { calculateCablePath } from '../../utils/cableLayout';
import type { CableElement, ConsumerElement, DrawingElement, PathElement, ShapeElement, SymbolElement } from '../../types/drawing';

const S = () => useDrawingStore.getState();
const initial = S();
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
afterEach(() => { vi.useRealTimers(); });

// ---- fixtures ------------------------------------------------------------------
const pole = (id: string, x: number, y: number): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color = '#ff0000'): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: color, fillColor: 'transparent', strokeWidth: 2 });
const consumer = (id: string, poleId: string): ConsumerElement => ({ id, type: 'consumer', x: 0, y: 0, poleId, color: '#000', count: 1, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, variant: 'circle', label: '' });
const key = (a: string, b: string) => [a, b].sort().join('_');

// The document part of the state, as plain data.
const doc = () => JSON.parse(JSON.stringify({ e: S().elements, d: S().connectionDistances, o: S().connectionLabelOffsets }));
const geometry = () => S().elements.filter((e): e is CableElement => e.type === 'cable').map((c) => calculateCablePath(c, S().elements));

// One user action outside a pointer gesture (e.g. a button tap): ends with the step committed.
const action = (fn: () => void) => { fn(); S().commitHistory(); };
// One pointer gesture: everything between down and up is a single step.
const gesture = async (fn: () => void | Promise<void>) => {
  historyGestureStart(1);
  await fn();
  historyGestureEnd(1);
  await new Promise((r) => setTimeout(r, 0));
};

// A small network: A–B–C trunk, D–B branch, C–E, subscriber on B, distances + an offset.
const network = () => {
  action(() => { S().addElement(pole('A', 0, 0)); });
  action(() => { S().addElement(pole('B', 200, 0)); });
  action(() => { S().addElement(pole('C', 400, 0)); });
  action(() => { S().addElement(pole('D', 200, 200)); });
  action(() => { S().addElement(pole('E', 600, 0)); });
  action(() => { S().addElement(cable('t', ['A', 'B', 'C'])); });
  action(() => { S().addElement(cable('br', ['D', 'B'], '#0000ff')); });
  action(() => { S().addElement(cable('o', ['C', 'E'], '#00aa00')); });
  action(() => { S().addElement(consumer('uB', 'B')); });
  action(() => { S().updateConnectionDistance(key('A', 'B'), '25'); });
  action(() => { S().updateConnectionDistance(key('B', 'C'), '30'); });
  action(() => { S().updateConnectionLabelOffset(key('A', 'B'), { x: 5, y: -5 }); });
};

// ---- 1 + 2 ---------------------------------------------------------------------------
describe('adding an element', () => {
  it('1. is one undo step, even when the canvas marks a boundary first (saveHistory + addElement)', () => {
    action(() => { S().saveHistory(); S().addElement(pole('A', 0, 0)); });
    expect(S().history).toHaveLength(1);
    S().undo();
    expect(S().elements).toEqual([]);
    expect(S().history).toHaveLength(0);
  });
  it('2. redo brings it back exactly', () => {
    action(() => { S().addElement(pole('A', 1, 2)); });
    S().undo();
    S().redo();
    expect(S().elements).toEqual([pole('A', 1, 2)]);
    expect(S().history).toHaveLength(1);
    expect(S().redoStack).toHaveLength(0);
  });
  it('several store calls in one handler (pole splitting a cable + two distances) are one step, committed after the task', async () => {
    vi.useFakeTimers();
    network();
    const before = doc(); const n = S().history.length;
    // what SketchCanvas does when a pole is dropped on cable A–B
    S().addElement(pole('M', 100, 0));
    S().updateElement('t', { poleIds: ['A', 'M', 'B', 'C'] });
    S().updateConnectionDistance(key('A', 'M'), '12.5');
    S().updateConnectionDistance(key('M', 'B'), '12.5');
    expect(S().history).toHaveLength(n); // not yet: the handler is still running
    await vi.advanceTimersByTimeAsync(0);
    expect(S().history).toHaveLength(n + 1);
    S().undo();
    expect(doc()).toEqual(before);
  });
});

// ---- 3 -------------------------------------------------------------------------------
describe('selecting without changing', () => {
  it('3. tap-select (boundary + select) adds no step and keeps redo available', async () => {
    network();
    S().undo(); // something to redo
    const h = S().history.length; const r = S().redoStack.length;
    await gesture(() => { S().saveHistory(); S().setSelectedId('B'); });
    expect(S().history).toHaveLength(h);
    expect(S().redoStack).toHaveLength(r);
    expect(S().selectedId).toBe('B');
  });
  it('a "drag" that ends where it started is not a step', async () => {
    network();
    const h = S().history.length;
    await gesture(() => { S().saveHistory(); S().updateElement('B', { x: 210 }); S().updateElement('B', { x: 200 }); });
    expect(S().history).toHaveLength(h);
  });
  it('a drag spread over many frames (pointer still down between moves) is one step', async () => {
    network();
    const before = doc(); const h = S().history.length;
    historyGestureStart(7);
    for (let i = 1; i <= 10; i++) { S().updateElement('B', { x: 200 + i }); await new Promise((r) => setTimeout(r, 5)); }
    expect(S().history).toHaveLength(h); // still dragging
    historyGestureEnd(7);
    await new Promise((r) => setTimeout(r, 0));
    expect(S().history).toHaveLength(h + 1);
    S().undo();
    expect(doc()).toEqual(before);
  });
  it('two-finger gesture: the step closes only when the last pointer lifts', async () => {
    network();
    const h = S().history.length;
    historyGestureStart(1); historyGestureStart(2);
    S().updateElement('B', { x: 260 });
    historyGestureEnd(1); await new Promise((r) => setTimeout(r, 5));
    S().updateElement('B', { x: 270 });
    expect(S().history).toHaveLength(h);
    historyGestureEnd(2); await new Promise((r) => setTimeout(r, 0));
    expect(S().history).toHaveLength(h + 1);
  });
  it('a real drag is exactly one step, however many moves', async () => {
    network();
    const before = doc(); const h = S().history.length;
    await gesture(() => { for (let i = 1; i <= 50; i++) S().updateElement('B', { x: 200 + i, y: i }); });
    expect(S().history).toHaveLength(h + 1);
    S().undo();
    expect(doc()).toEqual(before);
  });
});

// ---- 4 + 5 ---------------------------------------------------------------------------
describe('cable properties and distances', () => {
  it('4. cable property edits are recorded, undone and redone', () => {
    network();
    const before = doc();
    action(() => { S().updateElement('t', { lineStyle: 'straight' } as Partial<CableElement>); });
    action(() => { S().updateElement('t', { strokeColor: '#999999', strokeWidth: 4 }); });
    action(() => { S().updateElement('t', { cableType: 'ground', arrowMode: 'end' } as Partial<CableElement>); });
    const after = doc();
    S().undo(); expect((S().elements.find((e) => e.id === 't') as CableElement).cableType).toBeUndefined();
    S().undo(); expect(S().elements.find((e) => e.id === 't')?.strokeColor).toBe('#ff0000');
    S().undo(); expect(doc()).toEqual(before);
    S().redo(); S().redo(); S().redo();
    expect(doc()).toEqual(after);
  });
  it('"apply width to all cables" is one step', () => {
    network();
    const h = S().history.length;
    action(() => { S().updateElements(['t', 'br', 'o'].map((id) => ({ id, changes: { strokeWidth: 5 } }))); });
    expect(S().history).toHaveLength(h + 1);
    S().undo();
    expect(S().elements.filter((e) => e.type === 'cable').every((c) => c.strokeWidth === 2)).toBe(true);
  });
  it('5. a distance edit is recorded, undone and redone', () => {
    network();
    action(() => { S().updateConnectionDistance(key('A', 'B'), '40'); });
    S().undo();
    expect(S().connectionDistances[key('A', 'B')]).toBe('25');
    S().redo();
    expect(S().connectionDistances[key('A', 'B')]).toBe('40');
    S().undo(); S().undo();
    expect(S().connectionLabelOffsets).toEqual({});
    expect(S().connectionDistances[key('A', 'B')]).toBe('25');
  });
  it('dragging a distance label is one step and undo puts it back', async () => {
    network();
    await gesture(() => { for (let i = 0; i < 20; i++) S().updateConnectionLabelOffset(key('B', 'C'), { x: i, y: -i }); });
    expect(S().connectionLabelOffsets[key('B', 'C')]).toEqual({ x: 19, y: -19 });
    S().undo();
    expect(S().connectionLabelOffsets[key('B', 'C')]).toBeUndefined();
    S().redo();
    expect(S().connectionLabelOffsets[key('B', 'C')]).toEqual({ x: 19, y: -19 });
  });
});

// ---- 6 -------------------------------------------------------------------------------
describe('deleting a branch pole (Stage 5.5 behaviour kept)', () => {
  it('6. one step; undo restores pole, cables, subscriber, distances and offsets; redo re-applies', () => {
    network();
    const before = doc(); const geo = geometry(); const h = S().history.length;
    action(() => { expect(S().deleteElement('B').ok).toBe(true); });
    expect(S().history).toHaveLength(h + 1);
    const after = doc();
    expect(after.e.map((e: DrawingElement) => e.id)).not.toContain('B');
    expect(after.e.map((e: DrawingElement) => e.id)).not.toContain('uB');
    expect(after.d).toEqual({ [key('A', 'C')]: '55' });
    expect(after.o).toEqual({});
    S().undo();
    expect(doc()).toEqual(before);
    expect(geometry()).toEqual(geo);
    S().redo();
    expect(doc()).toEqual(after);
    S().undo();
    expect(doc()).toEqual(before);
  });
});

// ---- 7 -------------------------------------------------------------------------------
describe('freehand stroke recognised as a shape', () => {
  it('7. the whole stroke + replacement is one step; undo leaves neither path nor shape, redo only the shape', async () => {
    network();
    const before = doc();
    const path: PathElement = { id: 'p', type: 'path', x: 0, y: 0, points: [{ x: 0, y: 0 }], strokeColor: '#000', fillColor: 'none', strokeWidth: 2 };
    const shape: ShapeElement = { id: 'sh', type: 'shape', shapeType: 'circle', x: 0, y: 0, width: 50, height: 50, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, rotation: 0, scaleX: 1, scaleY: 1 };
    await gesture(() => {
      S().saveHistory(); S().addElement(path);                         // pointerdown
      for (let i = 1; i < 30; i++) S().updateElement('p', { points: Array.from({ length: i }, (_, k) => ({ x: k, y: k })) }); // moves
      S().updateElement('p', { points: [{ x: 1, y: 1 }] });            // pointerup: final points
      S().deleteElement('p'); S().addElement(shape);                   // recognised → replaced
    });
    expect(S().elements.filter((e) => e.id === 'p' || e.id === 'sh').map((e) => e.id)).toEqual(['sh']);
    S().undo();
    expect(doc()).toEqual(before);
    S().redo();
    expect(S().elements.some((e) => e.id === 'p')).toBe(false);
    expect(S().elements.some((e) => e.id === 'sh')).toBe(true);
  });
});

// ---- 8 -------------------------------------------------------------------------------
describe('New Project', () => {
  it('8. is one step; undo restores elements, distances and label offsets', () => {
    network();
    S().setProjectInfo('P1', 'Line 7');
    const before = doc();
    action(() => { S().clearCanvas(); S().setProjectInfo(null, null); }); // ProjectManager.handleNewProject
    expect(doc()).toEqual({ e: [], d: {}, o: {} });
    S().undo();
    expect(doc()).toEqual(before);
    expect(S().connectionDistances).toEqual({ [key('A', 'B')]: '25', [key('B', 'C')]: '30' });
    expect(S().connectionLabelOffsets).toEqual({ [key('A', 'B')]: { x: 5, y: -5 } });
    // the project link is not restored: a later Save makes a new project rather than overwriting P1
    expect(S().currentProjectId).toBeNull();
    S().redo();
    expect(doc()).toEqual({ e: [], d: {}, o: {} });
  });
});

// ---- 9 -------------------------------------------------------------------------------
describe('a sequence of mixed operations', () => {
  it('9. undo walks back through every state in order, redo forward again', async () => {
    const states: unknown[] = [doc()];
    const record = () => states.push(doc());
    network(); // 12 steps
    // re-record the network states by undoing/redoing is not needed: build the expected list from here
    const base = S().history.length;
    states.length = 0; states.push(doc());
    action(() => { S().updateElement('br', { strokeColor: '#123123' }); }); record();
    await gesture(() => { for (let i = 0; i < 5; i++) S().updateElement('E', { x: 600 + i * 10 }); }); record();
    action(() => { S().updateConnectionDistance(key('C', 'E'), '17'); }); record();
    action(() => { S().deleteElement('B'); }); record();
    action(() => { S().updateSymbolModifiers('C', { isTilted: true }); }); record();
    action(() => { S().addElement(consumer('uC', 'C')); }); record();
    await gesture(() => { S().updateConnectionLabelOffset(key('A', 'C'), { x: 9, y: 9 }); }); record();
    action(() => { S().clearCanvas(); }); record();
    expect(S().history).toHaveLength(base + states.length - 1);
    for (let i = states.length - 2; i >= 0; i--) { S().undo(); expect(doc()).toEqual(states[i]); }
    for (let i = 1; i < states.length; i++) { S().redo(); expect(doc()).toEqual(states[i]); }
    // a new edit after undo clears the redo stack
    S().undo(); S().undo();
    action(() => { S().addElement(pole('Z', 1, 1)); });
    expect(S().redoStack).toHaveLength(0);
  });
  it('undo while an operation is still open commits it first (nothing is lost or skipped)', () => {
    action(() => { S().addElement(pole('A', 0, 0)); });
    S().addElement(pole('B', 1, 1)); // still pending
    S().undo();
    expect(S().elements.map((e) => e.id)).toEqual(['A']);
    S().redo();
    expect(S().elements.map((e) => e.id)).toEqual(['A', 'B']);
  });
});

// ---- 10 ------------------------------------------------------------------------------
describe('history limit', () => {
  it(`10. keeps the last ${HISTORY_LIMIT} steps, the current state and the order intact`, () => {
    const total = HISTORY_LIMIT + 30;
    const states: unknown[] = [doc()];
    for (let i = 0; i < total; i++) { action(() => { S().addElement(pole(`p${i}`, i, 0)); }); states.push(doc()); }
    expect(S().history).toHaveLength(HISTORY_LIMIT);
    expect(doc()).toEqual(states[total]);
    for (let i = total - 1; i >= total - HISTORY_LIMIT; i--) { S().undo(); expect(doc()).toEqual(states[i]); }
    // oldest steps are gone: further undo does nothing
    const floor = doc();
    S().undo();
    expect(doc()).toEqual(floor);
    expect(floor).toEqual(states[total - HISTORY_LIMIT]);
    for (let i = total - HISTORY_LIMIT + 1; i <= total; i++) { S().redo(); expect(doc()).toEqual(states[i]); }
    expect(S().history).toHaveLength(HISTORY_LIMIT);
  });
});

// ---- 11 ------------------------------------------------------------------------------
describe('autosave', () => {
  it('11. autosaving does not add or duplicate undo steps', async () => {
    vi.useFakeTimers();
    const data = new Map<string, unknown>();
    const storage: DraftStorage = { get: async (k) => data.get(k) as never, set: async (k, v) => { data.set(k, v); }, del: async (k) => { data.delete(k); } };
    const h = startAutosave({ storage, lifecycle: null, debounceMs: 100 });
    try {
      for (let i = 0; i < 5; i++) { S().addElement(pole(`p${i}`, i, 0)); await vi.advanceTimersByTimeAsync(300); }
      await h.flush();
      expect(data.size).toBe(1);
      expect(S().history).toHaveLength(5);
      S().undo(); await vi.advanceTimersByTimeAsync(300);
      S().undo(); await vi.advanceTimersByTimeAsync(300);
      expect(S().history).toHaveLength(3);
      expect(S().redoStack).toHaveLength(2);
      expect((data.get('autosave_draft_v1') as { data: { elements: unknown[] } }).data.elements).toHaveLength(3);
    } finally { h.stop(); }
  });
});

// ---- 12 ------------------------------------------------------------------------------
describe('drawing data stays intact through undo/redo, save and import', () => {
  it('12. after undo/redo the exported file re-imports to the identical drawing, with a fresh history', async () => {
    network();
    action(() => { S().deleteElement('B'); });
    S().undo(); S().redo(); S().undo();
    const live = doc(); const geo = geometry();
    const s = S();
    const json = serializeProject(s.elements, s.style, s.poleSizeScale, s.consumerVariant, s.connectionDistances, s.connectionLabelOffsets, null, 'Round trip', s.distanceTextScale, s.consumerSizeScale);
    expect(parseProjectFile(json).ok).toBe(true);
    useDrawingStore.setState({ ...initial }, true);
    const planned = await planImport(json, { getMeta: async () => [] });
    if (!planned.ok) throw new Error('rejected');
    await applyImport(planned.plan, 'open');
    expect(doc()).toEqual(live);
    expect(geometry()).toEqual(geo);
    expect(S().history).toEqual([]);
    expect(S().redoStack).toEqual([]);
    S().undo(); // nothing to undo into: the previous canvas is not mixed in
    expect(doc()).toEqual(live);
  });
});
