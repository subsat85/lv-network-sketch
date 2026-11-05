import { createHash } from 'node:crypto';
import type { GoldenCase } from '../../../utils/__tests__/vdGoldenNetworks';
import { runStudyE2, type AllocationMethod } from '../index';

// The E2 golden record of the 240 golden networks (vdGoldenNetworks.ts): per network, the sha-256 of
// E2's full result (circuits and issues) with the labels left out — every number, every phasor,
// every reason and every structure is in it; the statuses, warnings, input provenances and their
// references are not (they are labels of the inputs, not results of the equations).

const LABELS = new Set(['warnings', 'status', 'provenance', 'ref']);
const strip = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(strip);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([k]) => !LABELS.has(k)).map(([k, v]) => [k, strip(v)]));
  return x;
};
/** E2's result of a golden network as plain data (as JSON would store it) */
export const e2Raw = (g: GoldenCase, allocationMethod?: AllocationMethod): unknown => {
  const r = runStudyE2({ elements: g.elements, connectionDistances: g.distances, distanceFlags: {}, electrical: g.settings }, { inputOrigin: 'legacy-project', ...(allocationMethod ? { allocationMethod } : {}) });
  return JSON.parse(JSON.stringify({ circuits: r.circuits, issues: r.issues }));
};
export const digest = (raw: unknown): string => createHash('sha256').update(JSON.stringify(strip(raw))).digest('hex');
