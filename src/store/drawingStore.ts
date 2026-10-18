import { create } from 'zustand';
import { DrawingElement, ToolType, DrawingStyle } from '../types/drawing';
import { deletePoleCascade, DeletePoleFailure } from '../utils/deletePole';
import { pruneInvalidArcs } from '../utils/cableArcs';

// ---------------------------------------------------------------------------
// Undo / redo
//
// A history entry is a snapshot of the whole drawing document: elements plus
// the per-pole-pair distances and label offsets. Snapshots share unchanged
// objects with the live state (all updates are immutable), so they are cheap.
//
// One logical operation = one entry. Every change to the document opens a
// "pending step" that remembers the document as it was before; the step is
// committed when the operation is over:
//   - at the end of a pointer gesture (all pointers lifted) — so a drag, a
//     freehand stroke turned into a shape, or a label drag is one step;
//   - otherwise right after the current task, so several store calls made by
//     one handler (e.g. split a cable + set two distances) are one step;
//   - before undo / redo, and when saveHistory() marks a boundary.
// A step whose document ends up equal to where it started (e.g. selecting an
// element without changing it) is dropped. The history keeps the last
// HISTORY_LIMIT steps; the oldest are discarded first.
// ---------------------------------------------------------------------------

export interface DocSnapshot {
  elements: DrawingElement[];
  connectionDistances: Record<string, string>;
  connectionLabelOffsets: Record<string, { x: number, y: number }>;
}
export const HISTORY_LIMIT = 100;

const docOf = (s: DocSnapshot): DocSnapshot => ({
  elements: s.elements,
  connectionDistances: s.connectionDistances,
  connectionLabelOffsets: s.connectionLabelOffsets,
});

const sameRecord = <T,>(a: Record<string, T>, b: Record<string, T>, eq: (x: T, y: T) => boolean) => {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && eq(a[k], b[k]));
};
export const docEqual = (a: DocSnapshot, b: DocSnapshot) => {
  if (a.elements !== b.elements) {
    if (a.elements.length !== b.elements.length) return false;
    for (let i = 0; i < a.elements.length; i++) {
      const x = a.elements[i], y = b.elements[i];
      if (x !== y && JSON.stringify(x) !== JSON.stringify(y)) return false;
    }
  }
  return sameRecord(a.connectionDistances, b.connectionDistances, (x, y) => x === y)
    && sameRecord(a.connectionLabelOffsets, b.connectionLabelOffsets, (x, y) => x === y || (x.x === y.x && x.y === y.y));
};

const pushLimited = (list: DocSnapshot[], item: DocSnapshot) => {
  const next = [...list, item];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
};

// pointer-gesture tracking (installed on window by the app; called directly in tests)
const activePointers = new Set<number>();
let commitTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleCommit = () => {
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    commitTimer = null;
    if (activePointers.size === 0) useDrawingStore.getState().commitHistory();
  }, 0);
};
export const historyGestureStart = (pointerId: number) => { activePointers.add(pointerId); };
export const historyGestureEnd = (pointerId?: number) => {
  if (pointerId === undefined) activePointers.clear(); else activePointers.delete(pointerId);
  if (activePointers.size === 0) scheduleCommit();
};
export const installHistoryGestureTracking = (target: Window = window) => {
  // capture phase: runs even when a canvas handler stops propagation
  const down = (e: PointerEvent) => historyGestureStart(e.pointerId);
  const up = (e: PointerEvent) => historyGestureEnd(e.pointerId);
  const reset = () => historyGestureEnd();
  target.addEventListener('pointerdown', down, true);
  target.addEventListener('pointerup', up, true);
  target.addEventListener('pointercancel', up, true);
  target.addEventListener('blur', reset);
  return () => {
    target.removeEventListener('pointerdown', down, true);
    target.removeEventListener('pointerup', up, true);
    target.removeEventListener('pointercancel', up, true);
    target.removeEventListener('blur', reset);
  };
};

interface DrawingState {
  elements: DrawingElement[];
  history: DocSnapshot[];
  redoStack: DocSnapshot[];
  // document as it was before the operation in progress (not yet committed)
  pendingStep: DocSnapshot | null;
  tool: ToolType;
  style: DrawingStyle;
  selectedId: string | null;
  activeSymbolId: string | null;
  activeCableId: string | null;
  activeShapeType: import('../types/drawing').ShapeType | null;
  poleSizeScale: number;
  distanceTextScale: number;
  consumerSizeScale: number;
  consumerVariant: 'circle' | 'square';
  currentProjectId: string | null;
  currentProjectName: string | null;
  attachedImage: string | null;
  connectionDistances: Record<string, string>;
  connectionLabelOffsets: Record<string, { x: number, y: number }>;
  showDistanceLabels: boolean;
  
  saveHistory: () => void;
  commitHistory: () => void;
  setTool: (tool: ToolType) => void;
  setProjectInfo: (id: string | null, name: string | null) => void;
  setAttachedImage: (image: string | null) => void;
  setConsumerVariant: (variant: 'circle' | 'square') => void;
  setPoleSizeScale: (scale: number) => void;
  setDistanceTextScale: (scale: number) => void;
  setConsumerSizeScale: (scale: number) => void;
  setShowDistanceLabels: (show: boolean) => void;
  setStyle: (style: Partial<DrawingStyle>) => void;
  addElement: (element: DrawingElement) => void;
  updateElement: (id: string, updates: Partial<DrawingElement>) => void;
  updateElements: (updates: { id: string, changes: Partial<DrawingElement> }[]) => void;
  updateSymbolModifiers: (id: string, modifiers: Partial<import('../types/drawing').SymbolModifiers>) => void;
  updateConnectionDistance: (key: string, distance: string) => void;
  updateConnectionLabelOffset: (key: string, offset: { x: number, y: number }) => void;
  deleteElement: (id: string) => { ok: boolean; reason?: string };
  setSelectedId: (id: string | null) => void;
  setActiveSymbolId: (id: string | null) => void;
  setActiveCableId: (id: string | null) => void;
  setActiveShapeType: (type: import('../types/drawing').ShapeType | null) => void;
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (data: { elements: DrawingElement[], style: DrawingStyle, poleSizeScale: number, consumerVariant: 'circle' | 'square', connectionDistances?: Record<string, string>, connectionLabelOffsets?: Record<string, { x: number, y: number }> }) => void;
}

export const useDrawingStore = create<DrawingState>((set, get) => {
  // Apply a change to the document, opening a pending undo step if none is open.
  const mutate = (changes: Partial<DrawingState> | ((s: DrawingState) => Partial<DrawingState>)) => {
    const s = get();
    const patch = typeof changes === 'function' ? changes(s) : changes;
    // cable arcs whose pole / cable / connection side is gone are removed with the change
    if (patch.elements) patch.elements = pruneInvalidArcs(patch.elements);
    if (s.pendingStep) { set(patch); return; }
    set({ ...patch, pendingStep: docOf(s) });
    scheduleCommit();
  };

  return {
  elements: [],
  history: [],
  redoStack: [],
  pendingStep: null,
  tool: 'select',
  style: {
    strokeColor: '#000000',
    fillColor: 'transparent',
    strokeWidth: 2,
    fontSize: 16,
  },
  selectedId: null,
  activeSymbolId: null,
  activeCableId: null,
  activeShapeType: null,
  poleSizeScale: 1,
  distanceTextScale: 1,
  consumerSizeScale: 1,
  consumerVariant: 'circle',
  currentProjectId: null,
  currentProjectName: null,
  attachedImage: null,
  connectionDistances: {},
  connectionLabelOffsets: {},
  showDistanceLabels: true,

  setProjectInfo: (id, name) => set({ currentProjectId: id, currentProjectName: name }),
  setAttachedImage: (image) => set({ attachedImage: image }),

  loadProject: (data) => set({
    elements: pruneInvalidArcs(data.elements),
    style: data.style,
    poleSizeScale: data.poleSizeScale,
    distanceTextScale: (data as any).distanceTextScale || 1,
    consumerSizeScale: (data as any).consumerSizeScale || 1,
    consumerVariant: data.consumerVariant,
    attachedImage: (data as any).attachedImage || null,
    connectionDistances: data.connectionDistances || {},
    connectionLabelOffsets: data.connectionLabelOffsets || {},
    history: [], // Clear history on load
    redoStack: [], // Clear redo stack on load
    pendingStep: null,
    selectedId: null,
    activeSymbolId: null,
    activeCableId: null,
  }),

  setTool: (tool) => set((state) => ({ 
    tool, 
    selectedId: tool === 'select' ? state.selectedId : null, 
    activeCableId: tool === 'cable' && state.selectedId && state.elements.find(e => e.id === state.selectedId)?.type === 'cable' 
      ? state.selectedId 
      : (tool === 'cable' ? state.activeCableId : null)
  })),
  setConsumerVariant: (variant) => set({ consumerVariant: variant }),
  setPoleSizeScale: (scale) => set({ poleSizeScale: scale }),
  setDistanceTextScale: (scale) => set({ distanceTextScale: scale }),
  setConsumerSizeScale: (scale) => set({ consumerSizeScale: scale }),
  setShowDistanceLabels: (show) => set({ showDistanceLabels: show }),
  setStyle: (updates) => set((state) => ({ style: { ...state.style, ...updates } })),
  
  addElement: (element) => mutate((state) => ({ 
    elements: [...state.elements, element] 
  })),
  
  updateElement: (id, updates) => mutate((state) => ({
    elements: state.elements.map((el) => (el.id === id ? { ...el, ...updates } as DrawingElement : el)),
  })),

  updateElements: (updates) => mutate((state) => ({
    elements: state.elements.map((el) => {
      const update = updates.find(u => u.id === el.id);
      return update ? { ...el, ...update.changes } as DrawingElement : el;
    }),
  })),

  updateSymbolModifiers: (id, modifiers) => mutate((state) => ({
    elements: state.elements.map((el) => {
      if (el.id === id && el.type === 'symbol') {
        const currentModifiers = el.modifiers || {};
        
        let newNote = currentModifiers.note;
        // Check if 'note' property is explicitly present in the update object
        if (Object.prototype.hasOwnProperty.call(modifiers, 'note')) {
           // If it is present and null/undefined, remove the note
           // If it is an object, merge it
           if (!modifiers.note) {
             newNote = undefined;
           } else {
             newNote = { ...(currentModifiers.note || { text: '', x: 0, y: 0 }), ...modifiers.note };
           }
        }

        return {
          ...el,
          modifiers: {
            ...currentModifiers,
            ...modifiers,
            note: newNote
          }
        };
      }
      return el;
    }),
  })),

  updateConnectionDistance: (key, distance) => mutate((state) => ({
    connectionDistances: { ...state.connectionDistances, [key]: distance }
  })),

  updateConnectionLabelOffset: (key, offset) => mutate((state) => ({
    connectionLabelOffsets: { ...state.connectionLabelOffsets, [key]: offset }
  })),

  // Close the operation in progress (if it changed the document) as one undo step.
  commitHistory: () => {
    const s = get();
    if (!s.pendingStep) return;
    if (docEqual(s.pendingStep, docOf(s))) { set({ pendingStep: null }); return; }
    set({ history: pushLimited(s.history, s.pendingStep), redoStack: [], pendingStep: null });
  },

  // Kept for existing callers: marks a step boundary before a new operation.
  saveHistory: () => get().commitHistory(),

  deleteElement: (id) => {
    const state = get();
    const target = state.elements.find((el) => el.id === id);
    if (target && target.type === 'symbol') {
      // Pole: remove it together with its subscribers, and continue/trim every
      // cable through it, as one atomic, single-undo-step change.
      const res = deletePoleCascade(state.elements, state.connectionDistances, state.connectionLabelOffsets, id);
      if (!res.ok) return { ok: false, reason: (res as DeletePoleFailure).reason };
      const gone = new Set(res.removedElementIds);
      mutate({
        elements: res.elements,
        connectionDistances: res.connectionDistances,
        connectionLabelOffsets: res.connectionLabelOffsets,
        selectedId: state.selectedId && gone.has(state.selectedId) ? null : state.selectedId,
        activeCableId: state.activeCableId && gone.has(state.activeCableId) ? null : state.activeCableId,
      });
      return { ok: true };
    }
    mutate({
      elements: state.elements.filter((el) => el.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    });
    return { ok: true };
  },

  setSelectedId: (id) => set({ selectedId: id }),
  setActiveSymbolId: (id) => set({ activeSymbolId: id, tool: 'symbol', selectedId: null, activeCableId: null }),
  setActiveCableId: (id) => set({ activeCableId: id }),
  setActiveShapeType: (type) => set({ activeShapeType: type, tool: 'shape', selectedId: null, activeCableId: null }),
  
  clearCanvas: () => mutate({
    elements: [],
    connectionDistances: {},
    connectionLabelOffsets: {},
    selectedId: null,
    activeCableId: null,
  }),

  undo: () => {
    get().commitHistory();
    const state = get();
    if (state.history.length === 0) return;
    const previous = state.history[state.history.length - 1];
    set({
      ...docOf(previous),
      history: state.history.slice(0, -1),
      redoStack: [docOf(state), ...state.redoStack],
      selectedId: null,
      activeCableId: null,
    });
  },

  redo: () => {
    get().commitHistory();
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[0];
    set({
      ...docOf(next),
      history: pushLimited(state.history, docOf(state)),
      redoStack: state.redoStack.slice(1),
      selectedId: null,
      activeCableId: null,
    });
  },
  };
});
