import { create } from 'zustand';
import { DrawingElement, ToolType, DrawingStyle, CableElement, JumperElement, SpanProps } from '../types/drawing';

// ─── Span ID utilities ────────────────────────────────────────────────────────

/** Generate a stable UUID for a cable segment */
const generateSpanId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Ensure every segment in a cable has a stable spanId.
 *  Returns a new array; does not mutate the cable. */
export const ensureSpanIds = (cable: CableElement): string[] => {
  const needed = Math.max(0, cable.poleIds.length - 1);
  const existing = cable.spanIds ?? [];
  if (existing.length === needed) return existing;
  const result = [...existing];
  while (result.length < needed) result.push(generateSpanId());
  return result.slice(0, needed);
};

// ─── History snapshot ─────────────────────────────────────────────────────────
/** A full snapshot of all state fields that participates in Undo/Redo.
 *  Stored in history[] and redoStack[] so every undo/redo restores a
 *  consistent view of the canvas AND its associated distance/span data. */
interface HistoryEntry {
  elements: DrawingElement[];
  connectionDistances: Record<string, string>;
  connectionLabelOffsets: Record<string, { x: number; y: number }>;
  spanProps: Record<string, SpanProps>;
  suspectDistanceKeys: string[];
}

interface DrawingState {
  elements: DrawingElement[];
  history: HistoryEntry[];
  redoStack: HistoryEntry[];
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

  // ─── Electrical calculation state ─────────────────────────────────────────
  /** Per-segment electrical properties, keyed by spanId */
  spanProps: Record<string, SpanProps>;
  /** Keys in connectionDistances whose value is "1" and was never confirmed by the user.
   *  Populated when loading version-1 projects. Treated as 'unknown' in calculations. */
  suspectDistanceKeys: string[];

  saveHistory: () => void;
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
  updateSpanProps: (spanId: string, props: Partial<SpanProps>) => void;
  setSuspectDistanceKeys: (keys: string[]) => void;
  /** Mark a previously-suspect distance key as confirmed by the user */
  confirmDistanceKey: (key: string) => void;
  /** Remove a distance key (and its label offset, spanProps entry, suspect flag) after a
   *  segment is split or deleted.  spanId is optional — pass it when known. */
  deleteConnectionSegment: (key: string, spanId?: string) => void;
  deleteElement: (id: string) => void;
  /** Delete a pole (symbol) element with full cascade cleanup.
   *  Removes the poleId from all CableElement.poleIds; cables that become
   *  degenerate (< 2 poles) are also removed.
   *  Also cleans up connectionDistances and spanProps for affected segments.
   *  IMPORTANT: The UI must show a confirmation dialog BEFORE calling this action. */
  deletePole: (poleId: string) => void;
  setSelectedId: (id: string | null) => void;
  setActiveSymbolId: (id: string | null) => void;
  setActiveCableId: (id: string | null) => void;
  setActiveShapeType: (type: import('../types/drawing').ShapeType | null) => void;
  clearCanvas: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (data: {
    elements: DrawingElement[];
    style: DrawingStyle;
    poleSizeScale: number;
    consumerVariant: 'circle' | 'square';
    connectionDistances?: Record<string, string>;
    connectionLabelOffsets?: Record<string, { x: number, y: number }>;
    spanProps?: Record<string, SpanProps>;
    suspectDistanceKeys?: string[];
  }) => void;
}

// ─── Helper: build a HistoryEntry from current state ─────────────────────────
/** Captures the five undo-able fields from the current state into one entry. */
const snap = (state: DrawingState): HistoryEntry => ({
  elements: state.elements,
  connectionDistances: state.connectionDistances,
  connectionLabelOffsets: state.connectionLabelOffsets,
  spanProps: state.spanProps,
  suspectDistanceKeys: state.suspectDistanceKeys,
});

/** Apply a HistoryEntry back to the store (used by undo/redo). */
const applyEntry = (entry: HistoryEntry) => ({
  elements: entry.elements,
  connectionDistances: entry.connectionDistances,
  connectionLabelOffsets: entry.connectionLabelOffsets,
  spanProps: entry.spanProps,
  suspectDistanceKeys: entry.suspectDistanceKeys,
});

export const useDrawingStore = create<DrawingState>((set) => ({
  elements: [],
  history: [],
  redoStack: [],
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
  spanProps: {},
  suspectDistanceKeys: [],

  setProjectInfo: (id, name) => set({ currentProjectId: id, currentProjectName: name }),
  setAttachedImage: (image) => set({ attachedImage: image }),

  loadProject: (data) => set({
    elements: data.elements,
    style: data.style,
    poleSizeScale: data.poleSizeScale,
    distanceTextScale: (data as any).distanceTextScale || 1,
    consumerSizeScale: (data as any).consumerSizeScale || 1,
    consumerVariant: data.consumerVariant,
    attachedImage: (data as any).attachedImage || null,
    connectionDistances: data.connectionDistances || {},
    connectionLabelOffsets: data.connectionLabelOffsets || {},
    spanProps: data.spanProps || {},
    suspectDistanceKeys: data.suspectDistanceKeys || [],
    history: [],
    redoStack: [],
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
  
  addElement: (element) => set((state) => ({
    history: [...state.history, snap(state)],
    redoStack: [],
    elements: [...state.elements, element]
  })),

  updateElement: (id, updates) => set((state) => {
    return {
      elements: state.elements.map((el) => (el.id === id ? { ...el, ...updates } : el)),
    };
  }),

  // Note: updateElements does NOT save its own history entry — it is only called
  // from the split handler in SketchCanvas.tsx, where addElement() has already
  // saved the pre-split snapshot.  Saving here would create a spurious extra
  // undo step (parallel-cable split = 2 undos instead of 1).
  updateElements: (updates) => set((state) => {
    const newElements = state.elements.map((el) => {
      const update = updates.find(u => u.id === el.id);
      return update ? { ...el, ...update.changes } : el;
    });
    return {
      elements: newElements,
    };
  }),

  updateSymbolModifiers: (id, modifiers) => set((state) => ({
    history: [...state.history, snap(state)],
    redoStack: [],
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

  updateConnectionDistance: (key, distance) => set((state) => ({
    connectionDistances: { ...state.connectionDistances, [key]: distance }
  })),

  updateConnectionLabelOffset: (key, offset) => set((state) => ({
    connectionLabelOffsets: { ...state.connectionLabelOffsets, [key]: offset }
  })),

  updateSpanProps: (spanId, props) => set((state) => ({
    spanProps: {
      ...state.spanProps,
      [spanId]: { ...state.spanProps[spanId], ...props },
    },
  })),

  setSuspectDistanceKeys: (keys) => set({ suspectDistanceKeys: keys }),

  confirmDistanceKey: (key) => set((state) => ({
    suspectDistanceKeys: state.suspectDistanceKeys.filter(k => k !== key),
  })),

  deleteConnectionSegment: (key, spanId) => set((state) => {
    const newConnectionDistances = { ...state.connectionDistances };
    delete newConnectionDistances[key];
    const newConnectionLabelOffsets = { ...state.connectionLabelOffsets };
    delete newConnectionLabelOffsets[key];
    const newSuspectDistanceKeys = state.suspectDistanceKeys.filter(k => k !== key);
    const newSpanProps = { ...state.spanProps };
    if (spanId) delete newSpanProps[spanId];
    return {
      connectionDistances: newConnectionDistances,
      connectionLabelOffsets: newConnectionLabelOffsets,
      suspectDistanceKeys: newSuspectDistanceKeys,
      spanProps: newSpanProps,
    };
  }),

  deletePole: (poleId: string) => set((state) => {
    const newHistory = [...state.history, snap(state)];

    // Collect spans and distance keys that will be destroyed
    const spanIdsToRemove = new Set<string>();
    const distanceKeysToRemove = new Set<string>();

    // Build a lookup of original consecutive pairs → spanId for each cable
    // so we can reuse surviving spanIds after the pole is removed
    const newElements = state.elements.reduce<DrawingElement[]>((acc, el) => {
      // Remove the pole itself
      if (el.id === poleId) return acc;

      // Remove any jumper that references this pole
      if (el.type === 'jumper') {
        const j = el as JumperElement;
        if (j.fromPoleId === poleId || j.toPoleId === poleId) return acc;
      }

      if (el.type !== 'cable') {
        acc.push(el);
        return acc;
      }

      const cable = el as CableElement;

      // If this cable doesn't reference the deleted pole, keep as-is
      if (!cable.poleIds.includes(poleId)) {
        acc.push(cable);
        return acc;
      }

      const existingSpanIds = cable.spanIds ?? [];

      // Collect distance keys and spanIds for all segments touching this pole
      cable.poleIds.forEach((pid, j) => {
        if (pid !== poleId) return;
        // Segment j-1: poleIds[j-1] → poleIds[j]
        if (j > 0) {
          const k = [cable.poleIds[j - 1], cable.poleIds[j]].sort().join('_');
          distanceKeysToRemove.add(k);
          if (existingSpanIds[j - 1]) spanIdsToRemove.add(existingSpanIds[j - 1]);
        }
        // Segment j: poleIds[j] → poleIds[j+1]
        if (j < cable.poleIds.length - 1) {
          const k = [cable.poleIds[j], cable.poleIds[j + 1]].sort().join('_');
          distanceKeysToRemove.add(k);
          if (existingSpanIds[j]) spanIdsToRemove.add(existingSpanIds[j]);
        }
      });

      const newPoleIds = cable.poleIds.filter(id => id !== poleId);

      if (newPoleIds.length < 2) {
        // Cable becomes degenerate — remove it and mark all its spans for cleanup
        existingSpanIds.forEach(sid => spanIdsToRemove.add(sid));
        return acc;
      }

      // Rebuild spanIds: reuse original spanId where the same consecutive pair survives,
      // generate a fresh one for any new pair (e.g., the bridged gap where the pole was).
      const originalPairToSpanId = new Map<string, string>();
      cable.poleIds.forEach((pid, i) => {
        if (i < cable.poleIds.length - 1 && existingSpanIds[i]) {
          const key = [pid, cable.poleIds[i + 1]].sort().join('_');
          originalPairToSpanId.set(key, existingSpanIds[i]);
        }
      });

      const newSpanIds: string[] = [];
      for (let i = 0; i < newPoleIds.length - 1; i++) {
        const key = [newPoleIds[i], newPoleIds[i + 1]].sort().join('_');
        const reusable = originalPairToSpanId.get(key);
        // Reuse only if it wasn't already collected for removal (i.e., it didn't touch the deleted pole)
        if (reusable && !spanIdsToRemove.has(reusable)) {
          newSpanIds.push(reusable);
        } else {
          newSpanIds.push(generateSpanId());
        }
      }

      acc.push({ ...cable, poleIds: newPoleIds, spanIds: newSpanIds });
      return acc;
    }, []);

    // Clean up connectionDistances
    const newConnectionDistances = { ...state.connectionDistances };
    distanceKeysToRemove.forEach(key => delete newConnectionDistances[key]);

    // Clean up connectionLabelOffsets
    const newConnectionLabelOffsets = { ...state.connectionLabelOffsets };
    distanceKeysToRemove.forEach(key => delete newConnectionLabelOffsets[key]);

    // Clean up spanProps
    const newSpanProps = { ...state.spanProps };
    spanIdsToRemove.forEach(sid => delete newSpanProps[sid]);

    // Clean up suspectDistanceKeys
    const newSuspectDistanceKeys = state.suspectDistanceKeys.filter(
      key => !distanceKeysToRemove.has(key)
    );

    return {
      history: newHistory,
      redoStack: [],
      elements: newElements,
      connectionDistances: newConnectionDistances,
      connectionLabelOffsets: newConnectionLabelOffsets,
      spanProps: newSpanProps,
      suspectDistanceKeys: newSuspectDistanceKeys,
      selectedId: state.selectedId === poleId ? null : state.selectedId,
    };
  }),

  saveHistory: () => set((state) => ({
    history: [...state.history, snap(state)],
    redoStack: []
  })),

  deleteElement: (id) => set((state) => ({
    history: [...state.history, snap(state)],
    redoStack: [],
    elements: state.elements.filter((el) => el.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  })),

  setSelectedId: (id) => set({ selectedId: id }),
  setActiveSymbolId: (id) => set({ activeSymbolId: id, tool: 'symbol', selectedId: null, activeCableId: null }),
  setActiveCableId: (id) => set({ activeCableId: id }),
  setActiveShapeType: (type) => set({ activeShapeType: type, tool: 'shape', selectedId: null, activeCableId: null }),
  
  clearCanvas: () => set((state) => ({
    history: [...state.history, snap(state)],
    redoStack: [],
    elements: [],
    connectionDistances: {},
    connectionLabelOffsets: {},
    spanProps: {},
    suspectDistanceKeys: [],
    selectedId: null,
    activeCableId: null
  })),

  undo: () => set((state) => {
    if (state.history.length === 0) return {};
    const previous = state.history[state.history.length - 1];
    const newHistory = state.history.slice(0, -1);
    return {
      ...applyEntry(previous),
      history: newHistory,
      redoStack: [snap(state), ...state.redoStack],
      selectedId: null,
      activeCableId: null,
    };
  }),

  redo: () => set((state) => {
    if (state.redoStack.length === 0) return {};
    const next = state.redoStack[0];
    const newRedoStack = state.redoStack.slice(1);
    return {
      ...applyEntry(next),
      history: [...state.history, snap(state)],
      redoStack: newRedoStack,
      selectedId: null,
      activeCableId: null,
    };
  }),
}));