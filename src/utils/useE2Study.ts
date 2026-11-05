import { useMemo } from 'react';
import { useDrawingStore } from '../store/drawingStore';
import { documentWithEdit, useSpanEditPreview } from '../store/spanEditStore';
import { cachedVoltageView, runE2Study, type E2StudyResult, type VoltageView } from './e2Presentation';

/**
 * The E2 study of the current drawing (read only). It runs only while `enabled` and again only
 * when the document changes. The document is never written.
 */
export const useE2Study = (enabled = true): E2StudyResult | null => {
  const view = useVoltageView(enabled);
  return view?.study ?? null;
};

/**
 * The voltage-drop view of the current drawing (E2), recomputed only when the document changes;
 * every reader (drawing overlay, panel, preview) shares the same calculation. While the span sheet
 * is open, its unsaved values are included (spanEditStore): the result before «حفظ» is the result after.
 */
export const useVoltageView = (enabled = true): VoltageView | null => {
  const elements = useDrawingStore((s) => s.elements);
  const connectionDistances = useDrawingStore((s) => s.connectionDistances);
  const electrical = useDrawingStore((s) => s.electrical);
  const distanceFlags = useDrawingStore((s) => s.distanceFlags);
  const edit = useSpanEditPreview((s) => s.preview);
  return useMemo(
    () => (enabled ? cachedVoltageView(documentWithEdit({ elements, connectionDistances, distanceFlags, electrical }, edit)) : null),
    [enabled, elements, connectionDistances, distanceFlags, electrical, edit],
  );
};

export { runE2Study };
