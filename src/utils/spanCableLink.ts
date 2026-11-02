import type { CableElement, SpanProps } from '../types/drawing';
import type { CableTypeHistory, CableTypeRevision, ElectricalProperty, SpanCableType } from '../types/cableType';
import { assignCableType, cableTypeMergeConflict, cableTypeUpdateAvailable, effectiveCableType, latestRevision } from './cableTypeModel';
import { hasElectrical, spanAt, withSpanProps } from './spanModel';

// Stage C4: a library cable type linked to one span, and the link removed. Pure: the span's own
// fields (R / X / Rn, material, section, data source…) are never read or changed here, nothing is
// copied from the snapshot into them, and nothing is read from the library at calculation time —
// the span keeps the exact snapshot it was linked to.

/**
 * The span linked to this revision (reference, revision number and a full snapshot, Stage B).
 * Every other property of the span is kept as it is. A cable type merge conflict (C0) is resolved by
 * this choice: the merged originals and the merge marks are dropped (the person chose the cable).
 */
export const linkSpanCable = (stored: SpanProps | undefined, poles: [string, string], revision: CableTypeRevision, now?: number): SpanProps => {
  const base: SpanProps = stored ? { ...stored } : { poles };
  if (cableTypeMergeConflict(base)) {
    delete base.mergedFrom;
    const review = (base.review ?? []).filter((r) => r !== 'merge-different' && r !== 'merge-partial');
    if (review.length) base.review = review; else delete base.review;
  }
  return assignCableType(base, revision, now);
};

/**
 * The link removed. The cable type stays in the library (nothing is deleted there); the span keeps
 * its own fields. A record left with nothing in it is removed (as the span sheet does on save).
 */
export const unlinkSpanCable = (stored: SpanProps): SpanProps | undefined => {
  const { cableType: _c, ...rest } = stored;
  return hasElectrical(rest) || rest.legacyV2 !== undefined || rest.mergedFrom?.length ? rest : undefined;
};

/** The drawing store's actions used to write a span record (the sheet's own save path). */
export interface SpanWriter {
  elements: readonly { id: string; type: string }[];
  updateElement: (id: string, updates: Partial<CableElement>) => void;
  saveHistory: () => void;
}

/**
 * Writes one span record as ONE undo step through the drawing store's element update (the same
 * sequence as the sheet's «Save»). Only `spanProps` of that cable is written: the poles, the geometry,
 * the length and every other drawing property stay as they are. Returns false when the span is gone.
 */
export const writeSpanProps = (store: SpanWriter, cableId: string, index: number, change: (stored: SpanProps | undefined, poles: [string, string]) => SpanProps | undefined): boolean => {
  const cable = store.elements.find((e) => e.id === cableId && e.type === 'cable') as CableElement | undefined;
  if (!cable) return false;
  const a = cable.poleIds[index], b = cable.poleIds[index + 1];
  const { id: spanId, props: stored } = spanAt(cable, index);
  if (!a || !b || !spanId) return false;
  const next = change(stored, [a, b]);
  store.saveHistory();
  store.updateElement(cable.id, { spanProps: withSpanProps(cable, spanId, next).spanProps });
  store.saveHistory();
  return true;
};

// ---------- what the span sheet shows about a link ----------

/** where the linked record stands in the library on this device (shown only; never used by a calculation) */
export type LinkRecordState =
  | { kind: 'checking' }
  | { kind: 'current' }
  /** a newer revision exists in the library: shown, NOT applied (no automatic upgrade) */
  | { kind: 'newer'; latest: number }
  /** the record is not in this device's library (an imported project): the snapshot is still used */
  | { kind: 'missing' }
  /** the linked revision is newer than anything the local library has (another device's library) */
  | { kind: 'ahead'; latest: number }
  /** the library could not be read: nothing can be said about the record */
  | { kind: 'unknown' };

/** the state of a link against the record's history in the local library (undefined: no such record) */
export const linkRecordState = (ct: SpanCableType, history: CableTypeHistory | undefined): LinkRecordState => {
  if (!history || history.id !== ct.typeId || !history.revisions.length) return { kind: 'missing' };
  const newer = cableTypeUpdateAvailable(ct, history);
  if (newer) return { kind: 'newer', latest: newer.revision };
  const last = latestRevision(history).revision;
  return last < ct.revision ? { kind: 'ahead', latest: last } : { kind: 'current' };
};

/** the values the span uses with E2: the snapshot with the project's overrides (nothing derived) */
export const linkedCableData = (ct: SpanCableType): { data: CableTypeRevision; overridden: ElectricalProperty[] } => effectiveCableType(ct);

/** R / Rn entered on a DC basis: used as entered (no conversion), the E2 result is provisional */
export const dcResistances = (d: CableTypeRevision): ElectricalProperty[] =>
  (['r', 'rn'] as const).filter((p) => d[p].value !== undefined && d[p].basis === 'dc');

/** the revision that may be linked now: the record's latest revision read from the library, or why not */
export type PickCheck = { ok: true; revision: CableTypeRevision } | { ok: false; reason: 'gone' | 'changed' | 'failed'; latest?: CableTypeRevision };
export const checkPick = async (read: (id: string) => Promise<CableTypeHistory>, shown: CableTypeRevision): Promise<PickCheck> => {
  let h: CableTypeHistory;
  try { h = await read(shown.id); } catch (e) {
    return { ok: false, reason: (e as { kind?: string })?.kind === 'not-found' ? 'gone' : 'failed' };
  }
  if (!h.revisions.length) return { ok: false, reason: 'gone' };
  const last = latestRevision(h);
  // only the revision the person looked at is linked: a newer one is shown first
  if (last.revision !== shown.revision) return { ok: false, reason: 'changed', latest: last };
  return { ok: true, revision: last };
};
