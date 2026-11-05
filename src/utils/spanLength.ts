import type { ElectricalSettings } from '../types/drawing';
import { pairKey } from './cableSegments';
import { isPlainDistance } from './distances';

// Helpers the calculation reads the drawing with (span keys, lengths, the study options).

/** why a span has no usable length */
export type LengthMissing =
  | 'length'          // no distance recorded for the span
  | 'length-suspect'; // distance ≤ 1 m: the drawing's placeholder value, not a measured length

/** the key of span `index` of a cable: `${cableId}#${index}` */
export const spanKey = (cableId: string, index: number) => `${cableId}#${index}`;

/** Span length from the drawing's distance for the pole pair, metres. */
export const spanLength = (distances: Record<string, string>, a: string, b: string): { m?: number; missing?: LengthMissing } => {
  const raw = distances[pairKey(a, b)];
  if (raw === undefined || raw.trim() === '') return { missing: 'length' };
  // only a plain number is a length ("40m", "abc"… are not turned into one)
  if (!isPlainDistance(raw)) return { missing: 'length' };
  const v = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return { missing: 'length' };
  if (v <= 1) return { missing: 'length-suspect' };
  return { m: v };
};

/** Network options the project settings ask for (the studies are off unless switched on). */
export const networkOptions = (settings: ElectricalSettings) => ({ studySplits: settings.studySuggestedSplits === true, includeProposedConsumers: settings.studyProposedConsumers === true });
