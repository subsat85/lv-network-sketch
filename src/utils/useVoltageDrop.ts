import { useMemo } from 'react';
import { useDrawingStore } from '../store/drawingStore';
import { computeVoltageDrop, VoltageDropResult } from './voltageDrop';
import { effectiveSettings } from './electricalSettings';

/** Voltage-drop result of the current drawing (recomputed only when the document changes). */
export const useVoltageDrop = (enabled = true): VoltageDropResult | null => {
  const elements = useDrawingStore((s) => s.elements);
  const distances = useDrawingStore((s) => s.connectionDistances);
  const electrical = useDrawingStore((s) => s.electrical);
  const flags = useDrawingStore((s) => s.distanceFlags);
  // a missing power factor is taken as the default (0.9) for the calculation only
  return useMemo(() => (enabled ? computeVoltageDrop(elements, distances, effectiveSettings(electrical), flags) : null), [enabled, elements, distances, electrical, flags]);
};
