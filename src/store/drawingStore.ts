import { create } from 'zustand';
import { DrawingElement, ToolType, DrawingStyle } from '../types/drawing';
import { deletePoleCascade, applyPatch, MapPatch, DeletePoleFailure } from '../utils/deletePole';

// Undo/redo for "delete pole" must also restore distances and label offsets,
// which are not part of the elements history. The delete step registers what it
// changed in those maps, keyed by the exact history snapshot arrays it created:
// popping the pre-delete snapshot (undo) applies `before`, popping the
// post-delete snapshot from the redo stack applies `after`.
type MapsPatch = { distances: MapPatch; labelOffsets: MapPatch };
const undoPatches = new WeakMap<DrawingElement[], MapsPatch>();
const redoPatches = new WeakMap<DrawingElement[], MapsPatch>();

interface DrawingState {
  elements: DrawingElement[];
  history: DrawingElement[][];
  redoStack: DrawingElement[][];
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

export const useDrawingStore = create<DrawingState>((set, get) => ({
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
    history: [], // Clear history on load
    redoStack: [], // Clear redo stack on load
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
    history: [...state.history, state.elements],
    redoStack: [],
    elements: [...state.elements, element] 
  })),
  
  updateElement: (id, updates) => set((state) => {
    return {
      elements: state.elements.map((el) => (el.id === id ? { ...el, ...updates } : el)),
    };
  }),

  updateElements: (updates) => set((state) => {
    const newElements = state.elements.map((el) => {
      const update = updates.find(u => u.id === el.id);
      return update ? { ...el, ...update.changes } : el;
    });
    return {
      elements: newElements,
      history: [...state.history, state.elements],
      redoStack: [],
    };
  }),

  updateSymbolModifiers: (id, modifiers) => set((state) => ({
    history: [...state.history, state.elements],
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

  saveHistory: () => set((state) => ({ 
    history: [...state.history, state.elements],
    redoStack: [] 
  })),

  deleteElement: (id) => {
    const state = get();
    const target = state.elements.find((el) => el.id === id);
    if (target && target.type === 'symbol') {
      // Pole: remove it together with its subscribers, and continue/trim every
      // cable through it, as one atomic, single-undo-step change.
      const res = deletePoleCascade(state.elements, state.connectionDistances, state.connectionLabelOffsets, id);
      if (!res.ok) return { ok: false, reason: (res as DeletePoleFailure).reason };
      const patch: MapsPatch = { distances: res.distancePatch, labelOffsets: res.labelOffsetPatch };
      undoPatches.set(state.elements, patch);
      const gone = new Set(res.removedElementIds);
      set({
        history: [...state.history, state.elements],
        redoStack: [],
        elements: res.elements,
        connectionDistances: res.connectionDistances,
        connectionLabelOffsets: res.connectionLabelOffsets,
        selectedId: state.selectedId && gone.has(state.selectedId) ? null : state.selectedId,
        activeCableId: state.activeCableId && gone.has(state.activeCableId) ? null : state.activeCableId,
      });
      return { ok: true };
    }
    set({
      history: [...state.history, state.elements],
      redoStack: [],
      elements: state.elements.filter((el) => el.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    });
    return { ok: true };
  },

  setSelectedId: (id) => set({ selectedId: id }),
  setActiveSymbolId: (id) => set({ activeSymbolId: id, tool: 'symbol', selectedId: null, activeCableId: null }),
  setActiveCableId: (id) => set({ activeCableId: id }),
  setActiveShapeType: (type) => set({ activeShapeType: type, tool: 'shape', selectedId: null, activeCableId: null }),
  
  clearCanvas: () => set((state) => ({ 
    history: [...state.history, state.elements],
    redoStack: [],
    elements: [], 
    connectionDistances: {},
    selectedId: null, 
    activeCableId: null 
  })),

  undo: () => set((state) => {
    if (state.history.length === 0) return {};
    const previous = state.history[state.history.length - 1];
    const newHistory = state.history.slice(0, -1);
    const patch = undoPatches.get(previous);
    if (patch) {
      // hand the patch over to the redo side (whatever array is current now)
      undoPatches.delete(previous);
      redoPatches.set(state.elements, patch);
    }
    return { 
      ...(patch ? {
        connectionDistances: applyPatch(state.connectionDistances, patch.distances, 'before'),
        connectionLabelOffsets: applyPatch(state.connectionLabelOffsets, patch.labelOffsets, 'before'),
      } : {}),
      elements: previous, 
      history: newHistory, 
      redoStack: [state.elements, ...state.redoStack],
      selectedId: null, 
      activeCableId: null 
    };
  }),

  redo: () => set((state) => {
    if (state.redoStack.length === 0) return {};
    const next = state.redoStack[0];
    const newRedoStack = state.redoStack.slice(1);
    const patch = redoPatches.get(next);
    if (patch) {
      redoPatches.delete(next);
      undoPatches.set(state.elements, patch);
    }
    return {
      ...(patch ? {
        connectionDistances: applyPatch(state.connectionDistances, patch.distances, 'after'),
        connectionLabelOffsets: applyPatch(state.connectionLabelOffsets, patch.labelOffsets, 'after'),
      } : {}),
      elements: next,
      history: [...state.history, state.elements],
      redoStack: newRedoStack,
      selectedId: null,
      activeCableId: null
    };
  }),
}));