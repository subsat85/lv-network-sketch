import type { CableElement, DrawingElement, SpanProps, SpanReview } from '../types/drawing';

// ---------------------------------------------------------------------------
// Span identity and per-span electrical properties.
//
// Every cable keeps `spanIds` aligned with its pole list (spanIds[i] is the span
// poleIds[i] → poleIds[i+1]) and `spanProps` keyed by span id. Properties are
// stored on the cable, so parallel cables on the same pole pair never share them,
// and they travel with the cable through save / export / autosave / undo.
//
// When a pole list changes, reconcileCable works out from the previous version
// what happened to each span, without any UI involvement:
//   - a span that still exists (same pole pair) keeps its id and properties;
//   - a span split by new poles: both parts get a copy, marked 'split' (the
//     length of each part must be checked);
//   - spans merged because the pole between them was deleted: one span; same
//     properties → kept; different → the first one's, marked 'merge-different';
//   - a span added at the end (or start) while drawing gets a copy of the
//     neighbouring span's properties, marked `inherited` (a suggestion the user
//     can change; it is a copy, not a link);
//   - any other new span gets a new id and no properties.
// Spans that disappear because an end pole was deleted lose their properties
// with them (undo restores them).
// ---------------------------------------------------------------------------

export type GenId = () => string;
export const newSpanId: GenId = () => 's' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

/** The fields that carry electrical meaning (bookkeeping fields excluded). */
export const ELECTRICAL_FIELDS = [
  'cableKind', 'material', 'crossSectionMm2', 'neutralCrossSectionMm2', 'neutralMaterial', 'parallel', 'system',
  'rOhmPerKm', 'xOhmPerKm', 'rNeutralOhmPerKm', 'dataSource',
] as const;

export const sameElectrical = (a: SpanProps, b: SpanProps) => ELECTRICAL_FIELDS.every((k) => a[k] === b[k]);
export const hasElectrical = (p: SpanProps | undefined) => !!p && ELECTRICAL_FIELDS.some((k) => p[k] !== undefined && p[k] !== '');

const withReview = (p: SpanProps, r: SpanReview): SpanProps =>
  p.review?.includes(r) ? p : { ...p, review: [...(p.review ?? []), r] };

const samePair = (a1: string, b1: string, a2: string, b2: string) => (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2);

const recordFits = (rec: SpanProps | undefined, a: string, b: string) =>
  !rec || !Array.isArray(rec.poles) || rec.poles.length !== 2 || samePair(rec.poles[0], rec.poles[1], a, b);

const spanCount = (c: CableElement) => Math.max(0, c.poleIds.length - 1);

/** True when spanIds fit the pole list and every stored record is for its span's pole pair. */
export const isCableConsistent = (c: CableElement): boolean => {
  const ids = c.spanIds;
  if (!Array.isArray(ids) || ids.length !== spanCount(c)) return false;
  if (new Set(ids).size !== ids.length || ids.some((s) => typeof s !== 'string' || !s)) return false;
  const props = c.spanProps ?? {};
  return ids.every((id, i) => {
    const rec = props[id];
    return !rec || (Array.isArray(rec.poles) && rec.poles.length === 2 && samePair(rec.poles[0], rec.poles[1], c.poleIds[i], c.poleIds[i + 1]));
  });
};

const build = (cable: CableElement, ids: string[], props: Record<string, SpanProps>): CableElement => {
  const out: CableElement = { ...cable, spanIds: ids };
  if (Object.keys(props).length) out.spanProps = props; else delete out.spanProps;
  return out;
};

/**
 * Make a cable consistent without knowing its previous version (projects loaded
 * from storage, files, older versions). Ids and records are matched by position
 * first, then by pole pair; nothing is guessed. Records that fit no current span
 * are kept as they are (see orphanSpanIds) so no data is dropped silently.
 */
export const normalizeCable = (cable: CableElement, genId: GenId = newSpanId): CableElement => {
  if (isCableConsistent(cable)) return cable;
  const Q = cable.poleIds;
  const n = spanCount(cable);
  const props = cable.spanProps ?? {};
  const stored = Array.isArray(cable.spanIds) ? cable.spanIds : [];
  const J: (string | null)[] = new Array(n).fill(null);
  const moved = new Set<string>();
  const used = new Set<string>();
  for (let k = 0; k < n; k++) {
    const id = stored[k];
    if (typeof id === 'string' && id && !used.has(id) && recordFits(props[id], Q[k], Q[k + 1])) { J[k] = id; used.add(id); }
  }
  for (let k = 0; k < n; k++) {
    if (J[k]) continue;
    const id = Object.keys(props).find((pid) => !used.has(pid) && Array.isArray(props[pid].poles) && samePair(props[pid].poles[0], props[pid].poles[1], Q[k], Q[k + 1]));
    if (id) { J[k] = id; used.add(id); moved.add(id); }
  }
  const ids = J.map((id) => id ?? genId());
  const out: Record<string, SpanProps> = {};
  ids.forEach((id, k) => {
    const rec = props[id];
    if (!rec) return;
    const placed: SpanProps = { ...rec, poles: [Q[k], Q[k + 1]] };
    out[id] = moved.has(id) ? withReview(placed, 'moved') : placed;
  });
  for (const [id, rec] of Object.entries(props)) if (!used.has(id)) out[id] = rec; // orphans, kept
  return build(cable, ids, out);
};

const stripForCopy = (p: SpanProps): SpanProps => {
  const { review: _r, legacyV2: _l, inherited: _i, mergedFrom: _m, ...rest } = p;
  return rest as SpanProps;
};
const withoutPoles = (p: SpanProps): Omit<SpanProps, 'poles' | 'mergedFrom'> => {
  const { poles: _p, mergedFrom: _m, ...rest } = p;
  return rest;
};

/** Update spanIds / spanProps of `next` from what changed since `prev` (same cable). */
export const reconcileCable = (prev: CableElement | undefined, next: CableElement, genId: GenId = newSpanId): CableElement => {
  if (prev === next) return next;
  if (!prev || !isCableConsistent(prev)) return normalizeCable(next, genId);
  const P = prev.poleIds, Q = next.poleIds;
  const samePoles = P.length === Q.length && P.every((p, i) => p === Q[i]);
  // same pole list: the caller's spanIds / spanProps are the truth (e.g. a property edit)
  if (samePoles) return normalizeCable(next, genId);
  // pole list changed but the caller already supplied fitting span data
  if (next.spanIds !== prev.spanIds && isCableConsistent(next)) return adjustEndLinks(prev, next);

  const I = prev.spanIds as string[];
  const R = prev.spanProps ?? {};
  const m = Math.max(0, Q.length - 1);
  const J: (string | null)[] = new Array(m).fill(null);
  const out: Record<string, SpanProps> = {};
  const usedOld = new Set<number>();
  const oldPoles = new Set(P), newPoles = new Set(Q);

  // 1. spans that still exist
  for (let k = 0; k < m; k++) {
    for (let i = 0; i < P.length - 1; i++) {
      if (usedOld.has(i) || !samePair(P[i], P[i + 1], Q[k], Q[k + 1])) continue;
      usedOld.add(i);
      J[k] = I[i];
      if (R[I[i]]) out[I[i]] = { ...R[I[i]], poles: [Q[k], Q[k + 1]] };
      break;
    }
  }

  // 2. spans split by newly inserted poles
  for (let i = 0; i < P.length - 1; i++) {
    if (usedOld.has(i)) continue;
    const A = P[i], B = P[i + 1];
    let done = false;
    for (let k1 = 0; k1 < Q.length && !done; k1++) {
      if (Q[k1] !== A && Q[k1] !== B) continue;
      const other = Q[k1] === A ? B : A;
      for (let k2 = k1 + 1; k2 < Q.length; k2++) {
        if (J[k2 - 1] !== null) break; // that span is accounted for already
        if (Q[k2] === other) {
          if (k2 - k1 >= 2) {
            usedOld.add(i);
            for (let k = k1; k < k2; k++) {
              const id = genId();
              J[k] = id;
              if (R[I[i]]) out[id] = withReview({ ...R[I[i]], poles: [Q[k], Q[k + 1]] }, 'split');
            }
            done = true;
          }
          break;
        }
        if (oldPoles.has(Q[k2])) break; // poles inside the split span must be new ones
      }
    }
  }

  // 3. spans merged because the poles between them were removed
  for (let k = 0; k < m; k++) {
    if (J[k] !== null) continue;
    const A = Q[k], B = Q[k + 1];
    let merged = false;
    for (let a = 0; a < P.length && !merged; a++) {
      if (P[a] !== A && P[a] !== B) continue;
      const other = P[a] === A ? B : A;
      for (let b = a + 1; b < P.length; b++) {
        if (usedOld.has(b - 1)) break;
        if (P[b] !== other) {
          if (newPoles.has(P[b])) break; // poles between them must be the removed ones
          continue;
        }
        if (b - a < 2) break;
        const spans: number[] = [];
        for (let i = a; i < b; i++) spans.push(i);
        spans.forEach((i) => usedOld.add(i));
        const id = genId();
        J[k] = id;
        const recs = spans.map((i) => R[I[i]]);
        const existing = recs.filter((r): r is SpanProps => !!r);
        if (existing.length) {
          // the first span's values are used; nothing is dropped: when the spans
          // differed (or one had none) every original record is kept in mergedFrom
          const base: SpanProps = { ...existing[0], poles: [A, B] };
          delete base.review; delete base.mergedFrom;
          const reviews = [...new Set(existing.flatMap((r) => r.review ?? []))].filter((r) => r !== 'split'); // the split is undone
          if (reviews.length) base.review = reviews;
          if (existing.some((r) => r.inherited)) base.inherited = true;
          const differ = !existing.every((r) => sameElectrical(r, existing[0]));
          const partial = existing.length < recs.length;
          let rec = base;
          if (differ) rec = withReview(rec, 'merge-different');
          if (partial) rec = withReview(rec, 'merge-partial');
          if (differ || partial) rec = { ...rec, mergedFrom: recs.flatMap((r) => (r ? r.mergedFrom ?? [withoutPoles(r)] : [null])) };
          out[id] = rec;
        }
        merged = true;
        break;
      }
    }
  }

  // 4. new spans; while drawing, a span added at an end copies its neighbour's properties
  for (let k = 0; k < m; k++) if (J[k] === null) J[k] = genId();
  const ids = J as string[];
  const appended = Q.length === P.length + 1 && P.every((p, i) => p === Q[i]);
  const prepended = Q.length === P.length + 1 && P.every((p, i) => p === Q[i + 1]);
  const inherit = (to: number, from: number) => {
    const src = out[ids[from]];
    if (out[ids[to]] || !hasElectrical(src)) return;
    out[ids[to]] = { ...stripForCopy(src), poles: [Q[to], Q[to + 1]], inherited: true };
  };
  if (appended && m >= 2) inherit(m - 1, m - 2);
  if (prepended && m >= 2) inherit(0, 1);

  // records that were already orphans stay
  const prevIds = new Set(I);
  for (const [id, rec] of Object.entries(R)) if (!prevIds.has(id) && !out[id]) out[id] = rec;
  return adjustEndLinks(prev, build(next, ids, out));
};

/**
 * A cable end's link setting belongs to the pole that end was at: when the end
 * moves (the cable is extended or shortened at that end, or that pole is
 * deleted) the setting is removed, so it never applies to another pole.
 */
export const adjustEndLinks = (prev: CableElement, next: CableElement): CableElement => {
  if (!next.endLinks) return next;
  const P = prev.poleIds, Q = next.poleIds;
  const links = { ...next.endLinks };
  if (links.start !== undefined && (!Q.length || Q[0] !== P[0])) delete links.start;
  if (links.end !== undefined && (!Q.length || Q[Q.length - 1] !== P[P.length - 1])) delete links.end;
  if (links.start === next.endLinks.start && links.end === next.endLinks.end) return next;
  const out: CableElement = { ...next, endLinks: links.start || links.end ? links : undefined };
  return out;
};

/** Apply reconcileCable to every cable that changed between two element lists. */
export const reconcileElements = (prev: DrawingElement[], next: DrawingElement[], genId: GenId = newSpanId): DrawingElement[] => {
  const before = new Map<string, CableElement>();
  for (const el of prev) if (el.type === 'cable') before.set(el.id, el);
  let changed = false;
  const out = next.map((el) => {
    if (el.type !== 'cable') return el;
    const p = before.get(el.id);
    if (p === el) return el;
    const r = reconcileCable(p, el, genId);
    if (r !== el) changed = true;
    return r;
  });
  return changed ? out : next;
};

/** Make every cable consistent (used when a project is loaded). */
export const normalizeElements = (elements: DrawingElement[], genId: GenId = newSpanId): DrawingElement[] => {
  let changed = false;
  const out = elements.map((el) => {
    if (el.type !== 'cable') return el;
    const r = normalizeCable(el, genId);
    if (r !== el) changed = true;
    return r;
  });
  return changed ? out : elements;
};

/** Ids of property records that belong to no current span of the cable. */
export const orphanSpanIds = (cable: CableElement): string[] => {
  const ids = new Set(cable.spanIds ?? []);
  return Object.keys(cable.spanProps ?? {}).filter((id) => !ids.has(id));
};

/** Span id and properties of span `index` of a cable. */
export const spanAt = (cable: CableElement, index: number): { id: string | undefined; props: SpanProps | undefined } => {
  const id = cable.spanIds?.[index];
  return { id, props: id ? cable.spanProps?.[id] : undefined };
};

/** A copy of the cable with new properties for one span (undefined removes them). */
export const withSpanProps = (cable: CableElement, spanId: string, props: SpanProps | undefined): CableElement => {
  const next = { ...(cable.spanProps ?? {}) };
  if (props) next[spanId] = props; else delete next[spanId];
  // spanProps is always present as a key (undefined when empty) so that passing the
  // result to updateElement as a patch also clears the last record
  return { ...cable, spanProps: Object.keys(next).length ? next : undefined };
};

/** Legacy pole-to-pole links (feature/vd) whose poles are gone are removed. */
export const pruneLegacyJumpers = (elements: DrawingElement[]): DrawingElement[] => {
  if (!elements.some((e) => e.type === 'jumper')) return elements;
  const poles = new Set(elements.filter((e) => e.type === 'symbol').map((e) => e.id));
  const out = elements.filter((e) => e.type !== 'jumper' || (poles.has(e.fromPoleId) && poles.has(e.toPoleId)));
  return out.length === elements.length ? elements : out;
};

/**
 * Pole-list updates that put `newPoleId` into every direct span a–b (either
 * direction) of every cable. Used when a pole is placed on a span.
 */
export const splitSpanInCables = (elements: DrawingElement[], a: string, b: string, newPoleId: string): { id: string; changes: Partial<CableElement> }[] => {
  const updates: { id: string; changes: Partial<CableElement> }[] = [];
  for (const el of elements) {
    if (el.type !== 'cable') continue;
    const ids = el.poleIds;
    const next: string[] = [];
    let hit = false;
    for (let i = 0; i < ids.length; i++) {
      next.push(ids[i]);
      if (i < ids.length - 1 && ((ids[i] === a && ids[i + 1] === b) || (ids[i] === b && ids[i + 1] === a))) { next.push(newPoleId); hit = true; }
    }
    if (hit) updates.push({ id: el.id, changes: { poleIds: next } });
  }
  return updates;
};

/** Remove the 'split' review mark from every span on the pole pair `key` (its length has been entered). */
export const clearSplitReviewForPair = (elements: DrawingElement[], key: string): DrawingElement[] => {
  let changed = false;
  const out = elements.map((el) => {
    if (el.type !== 'cable' || !el.spanProps || !el.spanIds) return el;
    let props: Record<string, SpanProps> | undefined;
    el.spanIds.forEach((id, i) => {
      const rec = el.spanProps![id];
      if (!rec?.review?.includes('split')) return;
      if ([el.poleIds[i], el.poleIds[i + 1]].sort().join('_') !== key) return;
      props ??= { ...el.spanProps! };
      const review = rec.review.filter((r) => r !== 'split');
      const next: SpanProps = { ...rec };
      if (review.length) next.review = review; else delete next.review;
      props[id] = next;
    });
    if (!props) return el;
    changed = true;
    return { ...el, spanProps: props };
  });
  return changed ? out : elements;
};
