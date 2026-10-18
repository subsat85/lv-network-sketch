import type { CableElement, DrawingElement } from '../types/drawing';

/**
 * Deleting a pole (any `symbol` element, incl. transformers) and everything that
 * depends on it, computed as one pure, all-or-nothing step.
 *
 * Data model facts this relies on (checked in the code base):
 * - A cable is an ordered list of pole ids (`poleIds`). Its segments are the
 *   consecutive pairs. A branch is always a *separate* cable that shares a pole,
 *   so every cable can be handled on its own.
 * - Distances and label offsets are stored per pole pair under the key
 *   `[idA, idB].sort().join('_')` (shared by all cables on that pair).
 * - Subscribers (`consumer`) reference exactly one pole via `poleId`.
 *
 * Rules per cable that contains the deleted pole:
 * - Pole in the middle (A → B → C, delete B): the same cable continues A → C.
 * - Pole at an end (A → B, delete B): the end segment is removed; earlier
 *   segments are kept. Fewer than 2 poles left → the cable is removed.
 * - Each cable is treated independently, so through-cables keep running and
 *   cables that end at the pole are trimmed, at a branch point too. No cable is
 *   merged with another and no new cable is created.
 * - Ids of poles that no longer exist (left behind by older versions) are also
 *   dropped from the cables being edited. They were already skipped when drawing,
 *   so the picture does not change.
 *
 * Distances: keys that involve the deleted pole are removed. For a bridged pair
 * A–C that has no stored distance yet, A–C gets the sum of the bridged segments.
 * This is the inverse of placing a pole on a cable, which halves the distance.
 * The sum is set only when every bridged segment has a numeric distance.
 * An existing A–C value (another cable already runs A–C) is never changed.
 * Label offsets of removed keys are removed.
 */

export type MapPatch = Record<string, { before: unknown; after: unknown }>;

export interface DeletePoleSuccess {
  ok: true;
  elements: DrawingElement[];
  connectionDistances: Record<string, string>;
  connectionLabelOffsets: Record<string, { x: number; y: number }>;
  /** what changed in the two maps (for undo/redo) */
  distancePatch: MapPatch;
  labelOffsetPatch: MapPatch;
  removedElementIds: string[];
  changedCableIds: string[];
}
export interface DeletePoleFailure { ok: false; reason: string }
export type DeletePoleResult = DeletePoleSuccess | DeletePoleFailure;

export const pairKey = (a: string, b: string) => [a, b].sort().join('_');

const toNumber = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const formatSum = (n: number) => String(Math.round(n * 100) / 100);

export function deletePoleCascade(
  elements: DrawingElement[],
  connectionDistances: Record<string, string>,
  connectionLabelOffsets: Record<string, { x: number; y: number }>,
  poleId: string,
): DeletePoleResult {
  const pole = elements.find(e => e.id === poleId);
  if (!pole) return { ok: false, reason: 'Pole not found.' };
  if (pole.type !== 'symbol') return { ok: false, reason: 'Selected element is not a pole.' };

  const existing = new Set(elements.map(e => e.id));
  existing.delete(poleId);

  const removed = new Set<string>([poleId]);
  const changedCableIds: string[] = [];
  const bridged: { a: string; b: string; chain: string[] }[] = [];
  const nextElements: DrawingElement[] = [];

  for (const el of elements) {
    if (el.id === poleId) continue;
    if (el.type === 'consumer' && el.poleId === poleId) { removed.add(el.id); continue; }
    if (el.type !== 'cable' || !el.poleIds.includes(poleId)) { nextElements.push(el); continue; }

    const cable = el as CableElement;
    const ids = cable.poleIds;
    // indices of poles that stay, with consecutive duplicates collapsed
    const kept: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (!existing.has(ids[i])) continue;
      if (kept.length && ids[kept[kept.length - 1]] === ids[i]) continue;
      kept.push(i);
    }
    if (kept.length < 2) { removed.add(cable.id); changedCableIds.push(cable.id); continue; }

    const newIds = kept.map(i => ids[i]);
    // per-cable index-keyed distances (legacy optional field): rebuild for the new segments
    let newCableDistances: Record<number, string> | undefined;
    for (let s = 0; s < kept.length - 1; s++) {
      const from = kept[s], to = kept[s + 1];
      const chain = ids.slice(from, to + 1);
      if (to - from > 1) bridged.push({ a: ids[from], b: ids[to], chain });
      if (cable.distances) {
        newCableDistances ??= {};
        if (to - from === 1) {
          if (cable.distances[from] !== undefined) newCableDistances[s] = cable.distances[from];
        } else {
          let sum = 0, ok = true;
          for (let j = from; j < to; j++) { const n = toNumber(cable.distances[j]); if (Number.isNaN(n)) { ok = false; break; } sum += n; }
          if (ok) newCableDistances[s] = formatSum(sum);
        }
      }
    }
    const updated: CableElement = { ...cable, poleIds: newIds };
    if (cable.distances) updated.distances = newCableDistances ?? {};
    nextElements.push(updated);
    changedCableIds.push(cable.id);
  }

  // ---- distances / label offsets ----
  const distances = { ...connectionDistances };
  const offsets = { ...connectionLabelOffsets };
  const distancePatch: MapPatch = {};
  const labelOffsetPatch: MapPatch = {};
  const setDist = (k: string, v: string | undefined) => {
    if (!(k in distancePatch)) distancePatch[k] = { before: connectionDistances[k], after: undefined };
    if (v === undefined) delete distances[k]; else distances[k] = v;
    distancePatch[k].after = v;
  };

  // bridged pairs first (they read the values that are about to be removed)
  for (const { a, b, chain } of bridged) {
    const k = pairKey(a, b);
    if (distances[k] !== undefined) continue;
    let sum = 0, ok = true;
    for (let j = 0; j < chain.length - 1; j++) {
      const n = toNumber(connectionDistances[pairKey(chain[j], chain[j + 1])]);
      if (Number.isNaN(n)) { ok = false; break; }
      sum += n;
    }
    if (ok) setDist(k, formatSum(sum));
  }
  const involves = (k: string) => k.startsWith(poleId + '_') || k.endsWith('_' + poleId);
  for (const k of Object.keys(connectionDistances)) if (involves(k)) setDist(k, undefined);
  for (const k of Object.keys(connectionLabelOffsets)) if (involves(k)) {
    labelOffsetPatch[k] = { before: connectionLabelOffsets[k], after: undefined };
    delete offsets[k];
  }

  // ---- post-conditions (all or nothing) ----
  const finalIds = new Set(nextElements.map(e => e.id));
  for (const el of nextElements) {
    if (el.type === 'cable' && changedCableIds.includes(el.id)) {
      if (el.poleIds.length < 2 || el.poleIds.some(id => !finalIds.has(id))) {
        return { ok: false, reason: 'Could not update the cables connected to this pole safely. Nothing was changed.' };
      }
    }
    if (el.type === 'consumer' && el.poleId === poleId) {
      return { ok: false, reason: 'Could not remove the subscribers of this pole safely. Nothing was changed.' };
    }
  }

  return {
    ok: true,
    elements: nextElements,
    connectionDistances: distances,
    connectionLabelOffsets: offsets,
    distancePatch,
    labelOffsetPatch,
    removedElementIds: [...removed],
    changedCableIds,
  };
}

/** Apply one side of a patch to a map (used by undo/redo). */
export function applyPatch<T>(map: Record<string, T>, patch: MapPatch, side: 'before' | 'after'): Record<string, T> {
  const out = { ...map };
  for (const [k, v] of Object.entries(patch)) {
    const val = v[side];
    if (val === undefined) delete out[k]; else out[k] = val as T;
  }
  return out;
}
