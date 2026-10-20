import type { ConsumerElement, DrawingElement } from '../types/drawing';

// ---------------------------------------------------------------------------
// Subscriber load rules — the ones the load report has always used, in one place
// so the report and the voltage-drop calculation cannot drift apart:
//   - circle  (واحد فاز, single-phase): 4 A per subscriber;
//   - square  (ثلاث فاز, three-phase):  the number written on it, in A, or 32 A
//     when it has no (numeric) label. Anything that is not a circle counts as
//     three-phase, as before (older subscribers may have no variant).
// `count` multiplies (a missing / zero count counts as 1, as before).
// No diversity factor is applied: the app has no rule for one.
// For the voltage-drop calculation the three-phase value is taken as the
// current of each phase (a balanced three-phase load).
// A load value that cannot be a current — a label that is a number ≤ 0 (or not
// finite), or a count that is not a whole number ≥ 1 — is marked `invalid`. The
// load report keeps its totals exactly as before (and lists the invalid ones);
// the voltage-drop calculation refuses to use them (never a negative drop).
// ---------------------------------------------------------------------------

export const SINGLE_PHASE_AMPS = 4;
export const THREE_PHASE_DEFAULT_AMPS = 32;

export interface ConsumerLoad {
  kind: 'single' | 'three';
  count: number;
  /** current of one subscriber, A */
  ampsEach: number;
  /** count × ampsEach, A */
  amps: number;
  /** where ampsEach comes from */
  source: 'single-phase-rule' | 'label' | 'three-phase-default';
  /** the value cannot be used as a load current */
  invalid?: 'label' | 'count';
}

export const consumerLoad = (c: Pick<ConsumerElement, 'variant' | 'label' | 'count'>): ConsumerLoad => {
  const count = c.count || 1;
  const badCount = !(Number.isInteger(count) && count >= 1);
  if (c.variant === 'circle') {
    const l: ConsumerLoad = { kind: 'single', count, ampsEach: SINGLE_PHASE_AMPS, amps: count * SINGLE_PHASE_AMPS, source: 'single-phase-rule' };
    if (badCount) l.invalid = 'count';
    return l;
  }
  const parsed = c.label ? parseFloat(c.label) : NaN;
  const fromLabel = !isNaN(parsed);
  const ampsEach = fromLabel ? parsed : THREE_PHASE_DEFAULT_AMPS;
  const l: ConsumerLoad = { kind: 'three', count, ampsEach, amps: count * ampsEach, source: fromLabel ? 'label' : 'three-phase-default' };
  if (fromLabel && !(Number.isFinite(parsed) && parsed > 0)) l.invalid = 'label';
  else if (badCount) l.invalid = 'count';
  return l;
};

/** Subscribers whose load value cannot be used (for warnings). */
export const invalidLoads = (consumers: ConsumerElement[]) => consumers.filter((c) => !!consumerLoad(c).invalid);

export interface ColorLoad {
  color: string;
  singlePhaseCount: number;
  singlePhaseLoad: number;
  threePhaseCount: number;
  threePhaseLoad: number;
  totalLoad: number;
}

/** Load report rows: totals per cable colour, largest first (unchanged behaviour). */
export const loadsByColor = (consumers: ConsumerElement[]): ColorLoad[] => {
  const map = new Map<string, ColorLoad>();
  for (const c of consumers) {
    const color = c.color || '#000000';
    let row = map.get(color);
    if (!row) { row = { color, singlePhaseCount: 0, singlePhaseLoad: 0, threePhaseCount: 0, threePhaseLoad: 0, totalLoad: 0 }; map.set(color, row); }
    const l = consumerLoad(c);
    if (l.kind === 'single') { row.singlePhaseCount += l.count; row.singlePhaseLoad += l.amps; }
    else { row.threePhaseCount += l.count; row.threePhaseLoad += l.amps; }
    row.totalLoad = row.singlePhaseLoad + row.threePhaseLoad;
  }
  return Array.from(map.values()).sort((a, b) => b.totalLoad - a.totalLoad);
};

export const consumersOf = (elements: DrawingElement[]) => elements.filter((e): e is ConsumerElement => e.type === 'consumer');
