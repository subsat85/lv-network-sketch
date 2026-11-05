import { create } from 'zustand';
import type { E2DocumentInput } from '../utils/e2Presentation';

/**
 * The document with the open span sheet's unsaved values (utils/spanEdit.ts), made from `base` — the
 * drawing store's document when the sheet computed it. Readers use it only while the store still
 * holds that same base, so a saved, undone or otherwise changed drawing is never shown with an old
 * edit. Not saved, not in the undo history; cleared when the sheet closes.
 */
export interface SpanEditPreview { base: E2DocumentInput; doc: E2DocumentInput }
export const useSpanEditPreview = create<{ preview: SpanEditPreview | null; setPreview: (p: SpanEditPreview | null) => void }>((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
}));

/** the document to calculate: the open sheet's edit when it was made from exactly this document */
export const documentWithEdit = (d: E2DocumentInput, p: SpanEditPreview | null): E2DocumentInput =>
  p && p.base.elements === d.elements && p.base.connectionDistances === d.connectionDistances && p.base.distanceFlags === d.distanceFlags && p.base.electrical === d.electrical
    ? p.doc : d;
