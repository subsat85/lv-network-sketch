import { create } from 'zustand';

// The network analysis panel and the drawing (view only: nothing of the project is read or written
// here). The panel asks the drawing to show a pole and / or a cable's spans; the drawing moves its view
// there and marks them for a moment. «Back to the analysis» reopens the panel where it was.

export interface AnalysisFocus {
  /** the pole to bring to the middle of the screen */
  poleId?: string;
  /** the spans to mark (`${cableId}#${index}`); with no pole, the view fits them */
  spanKeys?: string[];
  color?: string;
  /** a new request each time, even for the same pole */
  seq: number;
}

interface AnalysisFocusState {
  open: boolean;
  /** the card that was open (kept when the panel closes to show the drawing) */
  openCard?: string;
  hideOk: boolean;
  focus: AnalysisFocus | null;
  /** the panel was left to show something on the drawing: offer the way back */
  canReturn: boolean;
  setOpen: (open: boolean) => void;
  setOpenCard: (id: string | undefined) => void;
  setHideOk: (v: boolean) => void;
  show: (f: Omit<AnalysisFocus, 'seq'>) => void;
  back: () => void;
  dismissReturn: () => void;
}

let seq = 0;
export const useAnalysisFocus = create<AnalysisFocusState>((set) => ({
  open: false,
  hideOk: false,
  focus: null,
  canReturn: false,
  setOpen: (open) => set(open ? { open, canReturn: false } : { open }),
  setOpenCard: (openCard) => set({ openCard }),
  setHideOk: (hideOk) => set({ hideOk }),
  show: (f) => set({ open: false, canReturn: true, focus: { ...f, seq: ++seq } }),
  back: () => set({ open: true, canReturn: false }),
  dismissReturn: () => set({ canReturn: false }),
}));
