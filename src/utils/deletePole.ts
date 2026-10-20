import type { CableElement, DistanceFlag, DrawingElement } from '../types/drawing';
import { addExact, isPlainDistance } from './distances';

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
 * A–C that has no stored distance yet:
 *   - if B was placed on A–C and neither part has been measured since (both
 *     still carry the split marker of A–C), A–C gets back its original value
 *     (and label offset) exactly — deleting B undoes placing it;
 *   - otherwise A–C gets the exact sum of the bridged segments when all of them
 *     are plain numbers; the sum is marked estimated if one part was estimated;
 *   - otherwise A–C is left unset (no guess).
 * An existing A–C value (another cable already runs A–C) is never changed.
 * Label offsets and distance markers of removed keys are removed.
 */

export type MapPatch = Record<string, { before: unknown; after: unknown }>;

export interface DeletePoleSuccess {
  ok: true;
  elements: DrawingElement[];
  connectionDistances: Record<string, string>;
  connectionLabelOffsets: Record<string, { x: number; y: number }>;
  distanceFlags: Record<string, DistanceFlag>;
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
  distanceFlags: Record<string, DistanceFlag> = {},
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
  const flags = { ...distanceFlags };
  const distancePatch: MapPatch = {};
  const labelOffsetPatch: MapPatch = {};
  const setDist = (k: string, v: string | undefined) => {
    if (!(k in distancePatch)) distancePatch[k] = { before: connectionDistances[k], after: undefined };
    if (v === undefined) delete distances[k]; else distances[k] = v;
    distancePatch[k].after = v;
  };

  // bridged pairs first (they read the values that are about to be removed)
  // a pair some cable runs directly between before the deletion (its distance is in use)
  const directBefore = (a: string, b: string) => elements.some((e) => e.type === 'cable' && e.poleIds.some((p, i) => i < e.poleIds.length - 1 && pairKey(p, e.poleIds[i + 1]) === pairKey(a, b)));
  for (const { a, b, chain } of bridged) {
    const k = pairKey(a, b);
    // An A–C value that no cable used before is a leftover of placing B on A–C in
    // an older version (the old key used to be kept): it is replaced below by the
    // parts' values when they exist, so a re-measured span is not reverted.
    const leftover = distances[k] !== undefined && !directBefore(a, b);
    if (distances[k] !== undefined && !leftover) continue;
    const partKeys = chain.slice(0, -1).map((p, j) => pairKey(p, chain[j + 1]));
    // undo of a split: every part still unmeasured and split from this very pair
    const src = partKeys.map((pk) => distanceFlags[pk]?.splitFrom);
    if (src.every((x) => x && x.key === k && JSON.stringify(x) === JSON.stringify(src[0]))) {
      setDist(k, src[0]!.value);
      if (src[0]!.offset && !offsets[k]) {
        labelOffsetPatch[k] = { before: connectionLabelOffsets[k], after: src[0]!.offset };
        offsets[k] = src[0]!.offset;
      }
      // the restored value gets back the marker it had (e.g. it was itself an estimate)
      if (src[0]!.flag) flags[k] = src[0]!.flag; else delete flags[k];
      continue;
    }
    const values = partKeys.map((pk) => connectionDistances[pk]);
    const exact = values.every(isPlainDistance) ? addExact(values) : null;
    if (leftover && exact === null) continue; // nothing better than the leftover: keep it
    if (exact !== null) {
      setDist(k, exact);
      if (partKeys.some((pk) => distanceFlags[pk]?.estimated)) flags[k] = { estimated: true }; else delete flags[k];
      continue;
    }
    let sum = 0, ok = true;
    for (let j = 0; j < chain.length - 1; j++) {
      const n = toNumber(connectionDistances[pairKey(chain[j], chain[j + 1])]);
      if (Number.isNaN(n)) { ok = false; break; }
      sum += n;
    }
    if (ok && !leftover) {
      setDist(k, formatSum(sum));
      if (partKeys.some((pk) => distanceFlags[pk]?.estimated)) flags[k] = { estimated: true };
    }
  }
  const involves = (k: string) => k.startsWith(poleId + '_') || k.endsWith('_' + poleId);
  for (const k of Object.keys(connectionDistances)) if (involves(k)) setDist(k, undefined);
  for (const k of Object.keys(distanceFlags)) if (involves(k)) delete flags[k];
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
    distanceFlags: flags,
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
