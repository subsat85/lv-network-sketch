import type { CableElement, DrawingElement, SpanProps } from '../types/drawing';
import type { E2DocumentInput } from './e2Presentation';
import { pairKey } from './cableSegments';
import { clearSplitReviewForPair, hasElectrical, spanAt, withSpanProps } from './spanModel';

// The span sheet's unsaved values, applied to the document exactly as its «حفظ» writes them, so the
// drawing, the panel and the sheet's own check show the result before saving — and saving changes
// nothing in it. Pure: nothing here writes the drawing store.

export interface SpanEdit {
  cableId: string;
  index: number;
  /** the span record from the form (fromForm) */
  props: SpanProps;
  /** the length field as typed */
  length: string;
  /** an estimated length confirmed as measured */
  confirmMeasured: boolean;
}

/** the span record «حفظ» writes: undefined when the form holds no electrical value (no record is kept) */
export const spanRecordToSave = (props: SpanProps): SpanProps | undefined =>
  (hasElectrical(props) || props.legacyV2 !== undefined ? props : undefined);

/** the length «حفظ» writes, or undefined when the drawing's distance stays as it is (an empty field changes nothing) */
export const lengthToSave = (length: string, current: string | undefined, estimated: boolean, confirmMeasured: boolean): string | undefined => {
  const len = length.trim();
  return len && (len !== current || (estimated && confirmMeasured)) ? len : undefined;
};

/** the document as it will be after «حفظ» (the same document when the span is gone) */
export const applySpanEdit = (d: E2DocumentInput, e: SpanEdit): E2DocumentInput => {
  const cable = d.elements.find((x): x is CableElement => x.id === e.cableId && x.type === 'cable');
  if (!cable) return d;
  const a = cable.poleIds[e.index], b = cable.poleIds[e.index + 1];
  const { id: spanId, props: stored } = spanAt(cable, e.index);
  if (!a || !b || !spanId) return d;
  const next = spanRecordToSave(e.props);
  let elements = next || stored ? d.elements.map((x) => (x.id === cable.id ? withSpanProps(cable, spanId, next) : x)) : d.elements;
  let { connectionDistances, distanceFlags } = d;
  const key = pairKey(a, b);
  const len = lengthToSave(e.length, connectionDistances[key], !!distanceFlags[key]?.estimated, e.confirmMeasured);
  if (len !== undefined) {
    // as the store's updateConnectionDistance: the distance, its estimated flag cleared, split review marks of the pair cleared
    connectionDistances = { ...connectionDistances, [key]: len };
    if (distanceFlags[key]) { const f = { ...distanceFlags }; delete f[key]; distanceFlags = f; }
    elements = clearSplitReviewForPair(elements as DrawingElement[], key);
  }
  return { elements, connectionDistances, distanceFlags, electrical: d.electrical };
};
