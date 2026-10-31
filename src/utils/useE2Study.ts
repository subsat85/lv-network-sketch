import { useMemo } from 'react';
import { useDrawingStore } from '../store/drawingStore';
import { runE2Study, type E2StudyResult } from './e2Presentation';

/**
 * The E2 study of the current drawing (read only). It runs only while `enabled` (the E2 panel
 * is open) and again only when the document changes. The document is never written.
 */
export const useE2Study = (enabled = true): E2StudyResult | null => {
  const elements = useDrawingStore((s) => s.elements);
  const connectionDistances = useDrawingStore((s) => s.connectionDistances);
  const electrical = useDrawingStore((s) => s.electrical);
  const distanceFlags = useDrawingStore((s) => s.distanceFlags);
  return useMemo(
    () => (enabled ? runE2Study({ elements, connectionDistances, distanceFlags, electrical }) : null),
    [enabled, elements, connectionDistances, distanceFlags, electrical],
  );
};
