import type { CableTypeRevision } from '../types/cableType';
import type { CableElement, DrawingElement } from '../types/drawing';
import { syncSpansToRevision, type SpanSync } from '../utils/spanCableLink';
import { getCableLibrary, type CableLibraryController } from './cableLibraryStore';
import { useDrawingStore } from './drawingStore';

// Automatic synchronization of projects with the cable library, in two places:
//   - when a project is opened (withLatestLibraryRevisions, before it is loaded: ProjectManager,
//     projectImport, autosave restore): its spans are moved to the latest revision the library holds;
//   - while it is open (installCableLibrarySync), as below.
// This is the library of THIS device only: nothing is exchanged between devices.
//
// When the library saves a new
// revision of a cable type (an edit, a verification), every span of the open project linked to that
// type on an older revision is moved to it — the snapshot E2, the voltage drop, the ampacity check,
// the preview and the PDF all read — with the project's own overrides kept (syncSpansToRevision).
//   - one save in the library = ONE undo step in the project (undo: the spans' previous revisions;
//     redo: the new one again); nothing else of the drawing is touched;
//   - all the spans or none: the new elements are worked out first, then written in one store update;
//   - the drawing store's autosave keeps it like any other change (the saved project has the new
//     revision; reopening it does not go back);
//   - spans of other cable types, or not linked, are not looked at; nothing is read from the library
//     at calculation time (E2 keeps reading the span's own snapshot).

/** the drawing store's actions used here (one undo step: boundary, update, boundary) */
export interface SyncTarget {
  elements: readonly DrawingElement[];
  updateElements: (updates: { id: string; changes: Partial<DrawingElement> }[]) => void;
  saveHistory: () => void;
}

/** Moves the open project to these saved revisions as one step. Returns the spans moved. */
export const applyLibraryRevisions = (target: () => SyncTarget, saved: readonly CableTypeRevision[], now?: number): SpanSync[] => {
  // worked out on a copy first (several cable types in one save): nothing is written if this throws
  let elements = target().elements;
  const moved: SpanSync[] = [];
  const changed = new Map<string, Partial<CableElement>>();
  for (const rev of saved) {
    const { updates, spans } = syncSpansToRevision(elements, rev, now);
    if (!updates.length) continue;
    const by = new Map(updates.map((u) => [u.id, u.changes]));
    elements = elements.map((e) => (by.has(e.id) ? ({ ...e, ...by.get(e.id) } as DrawingElement) : e));
    for (const u of updates) changed.set(u.id, { ...(changed.get(u.id) ?? {}), ...u.changes });
    moved.push(...spans);
  }
  if (!moved.length) return moved;
  const t = target();
  t.saveHistory();
  t.updateElements([...changed].map(([id, changes]) => ({ id, changes })));
  target().saveHistory();
  return moved;
};

/**
 * A project being opened (a saved project, an imported file, the autosaved draft), moved to the latest
 * revision this device's library holds of each cable type it is linked to — BEFORE it is loaded, so the
 * drawing, E2 and every result show the latest revision from the start (no undo step: it is how the
 * project opens). Idempotent: spans already on the latest revision (or a later one: never backwards),
 * spans of a cable type this library does not have, and spans not linked are left exactly as they are,
 * and with nothing to move the same array is returned. When the library cannot be read the project
 * opens as it is stored (nothing is guessed).
 */
export const withLatestLibraryRevisions = async (
  elements: DrawingElement[], controller: CableLibraryController = getCableLibrary(), now?: number,
): Promise<{ elements: DrawingElement[]; spans: SpanSync[] }> => {
  const linked = new Set<string>();
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    for (const p of Object.values((e as CableElement).spanProps ?? {})) if (p?.cableType?.typeId) linked.add(p.cableType.typeId);
  }
  if (!linked.size) return { elements, spans: [] };
  try { await controller.load(); } catch { return { elements, spans: [] }; }
  const lib = controller.store.getState();
  if (lib.status !== 'ready') return { elements, spans: [] };
  let out = elements;
  const spans: SpanSync[] = [];
  for (const latest of lib.types) {
    if (!linked.has(latest.id)) continue;
    const r = syncSpansToRevision(out, latest, now);
    if (!r.updates.length) continue;
    const by = new Map(r.updates.map((u) => [u.id, u.changes]));
    out = out.map((e) => (by.has(e.id) ? ({ ...e, ...by.get(e.id) } as DrawingElement) : e));
    spans.push(...r.spans);
  }
  return { elements: out, spans };
};

/** Keeps the open project in step with the library; returns the function that stops it. */
export const installCableLibrarySync = (
  controller: CableLibraryController = getCableLibrary(),
  target: () => SyncTarget = () => useDrawingStore.getState(),
): (() => void) => controller.subscribe((saved) => { applyLibraryRevisions(target, saved, Date.now()); });
