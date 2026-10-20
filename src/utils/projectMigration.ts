import type { CableElement, DrawingElement, SpanProps } from '../types/drawing';
import { GenId, newSpanId, normalizeElements, pruneLegacyJumpers } from './spanModel';

// ---------------------------------------------------------------------------
// Reading documents written by other versions of the app.
//
// Version 1 (main, all Stage ≤ 6 files): no span data → span ids are created,
//   nothing else changes.
// Version 2 (branch feature/vd, published for a few hours on 2026-10-19):
//   - cables carry `spanIds` (aligned with poleIds) — kept as they are;
//   - a top-level `spanProps` map keyed by span id ({cableTypeId, temperature,
//     tempStatus, isUserModified}). Those fields have no equivalent here (its
//     cable catalogue was empty), so each record is kept unchanged under
//     `legacyV2` on the span it belongs to and marked for review; it is not
//     used by the calculation;
//   - "?" in connectionDistances meant "unknown" → the key is left unset, which
//     means the same thing here;
//   - `jumper` elements (pole to pole) are kept and drawn, but not used by the
//     calculation (their electrical meaning is not defined here).
// A v2 record that cannot be placed on a span (a span id no cable has) is not
// dropped: the file is rejected with a message instead (see unplacedV2Records).
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Span ids of `v2SpanProps` that no cable in `elements` has, in a fitting span list. */
export const unplacedV2Records = (elements: DrawingElement[], v2SpanProps: unknown): string[] => {
  if (!isObj(v2SpanProps)) return [];
  const known = new Set<string>();
  for (const el of elements) {
    if (el.type !== 'cable' || !Array.isArray(el.spanIds)) continue;
    if (el.spanIds.length !== Math.max(0, el.poleIds.length - 1)) continue;
    el.spanIds.forEach((id) => known.add(id));
  }
  return Object.keys(v2SpanProps).filter((id) => !known.has(id));
};

/** A saved document that cannot be opened without losing data. Nothing has been changed. */
export class ProjectDataError extends Error {}

export interface DocumentParts {
  elements: DrawingElement[];
  connectionDistances: Record<string, string>;
}

/**
 * Bring a document into the current shape. Safe to run on current documents
 * (it then changes nothing apart from creating missing span ids).
 */
export const prepareDocument = (doc: DocumentParts, v2SpanProps?: unknown, genId: GenId = newSpanId): DocumentParts => {
  let elements = doc.elements;
  // never drop version-2 span records silently (a saved project is not validated like a file)
  const unplaced = unplacedV2Records(elements, v2SpanProps);
  if (unplaced.length) {
    throw new ProjectDataError(`لم يُفتح المشروع: فيه خصائص ${unplaced.length} مقطع من الإصدار 2 لا تتبع أي مقطع موجود (${unplaced.slice(0, 3).join('، ')}). لم يتغيّر الرسم الحالي، ولم يُكتب شيء في المشروع المحفوظ.`);
  }
  if (isObj(v2SpanProps) && Object.keys(v2SpanProps).length) {
    elements = elements.map((el) => {
      if (el.type !== 'cable' || !Array.isArray(el.spanIds)) return el;
      const cable = el as CableElement;
      if (cable.spanIds!.length !== Math.max(0, cable.poleIds.length - 1)) return el;
      let props: Record<string, SpanProps> | undefined;
      cable.spanIds!.forEach((id, i) => {
        const raw = v2SpanProps[id];
        if (raw === undefined || cable.spanProps?.[id]) return;
        props ??= { ...(cable.spanProps ?? {}) };
        props[id] = { poles: [cable.poleIds[i], cable.poleIds[i + 1]], legacyV2: raw, review: ['v2'] };
      });
      return props ? { ...cable, spanProps: props } : el;
    });
  }
  let distances = doc.connectionDistances;
  if (Object.values(distances).some((v) => v === '?')) {
    distances = Object.fromEntries(Object.entries(distances).filter(([, v]) => v !== '?'));
  }
  elements = pruneLegacyJumpers(normalizeElements(elements, genId));
  return { elements, connectionDistances: distances };
};
