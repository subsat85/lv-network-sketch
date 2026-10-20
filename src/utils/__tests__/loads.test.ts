import { describe, expect, it } from 'vitest';
import { consumerLoad, loadsByColor } from '../loads';
import type { ConsumerElement } from '../../types/drawing';

// The load report's calculation exactly as it was in LoadReportModal.tsx before
// the rules were moved to utils/loads.ts (commit 75eb847) — the reference.
const oldReport = (consumers: ConsumerElement[]) => {
  const cableMap = new Map<string, { color: string; singlePhaseCount: number; singlePhaseLoad: number; threePhaseCount: number; threePhaseLoad: number; totalLoad: number }>();
  consumers.forEach(consumer => {
    const color = consumer.color || '#000000';
    const count = consumer.count || 1;
    if (!cableMap.has(color)) cableMap.set(color, { color, singlePhaseCount: 0, singlePhaseLoad: 0, threePhaseCount: 0, threePhaseLoad: 0, totalLoad: 0 });
    const cable = cableMap.get(color)!;
    if (consumer.variant === 'circle') {
      cable.singlePhaseCount += count;
      cable.singlePhaseLoad += count * 4;
    } else {
      const amps = consumer.label ? parseFloat(consumer.label) : 32;
      cable.threePhaseCount += count;
      cable.threePhaseLoad += count * (isNaN(amps) ? 32 : amps);
    }
    cable.totalLoad = cable.singlePhaseLoad + cable.threePhaseLoad;
  });
  return Array.from(cableMap.values()).sort((a, b) => b.totalLoad - a.totalLoad);
};

let k = 0;
const c = (p: Partial<ConsumerElement>): ConsumerElement => ({ id: `c${++k}`, type: 'consumer', x: 0, y: 0, poleId: 'P', color: '#ff0000', count: 1, strokeColor: '#000', fillColor: '#000', strokeWidth: 2, variant: 'circle', ...p });

describe('subscriber load rules', () => {
  it('single-phase (circle): 4 A each', () => {
    expect(consumerLoad(c({ variant: 'circle', count: 3 }))).toEqual({ kind: 'single', count: 3, ampsEach: 4, amps: 12, source: 'single-phase-rule' });
  });
  it('three-phase (square): the label in A, or 32 A without a numeric label', () => {
    expect(consumerLoad(c({ variant: 'square', label: '63', count: 2 }))).toMatchObject({ kind: 'three', ampsEach: 63, amps: 126, source: 'label' });
    expect(consumerLoad(c({ variant: 'square', label: '' }))).toMatchObject({ ampsEach: 32, source: 'three-phase-default' });
    expect(consumerLoad(c({ variant: 'square', label: 'x' }))).toMatchObject({ ampsEach: 32, source: 'three-phase-default' });
    expect(consumerLoad(c({ variant: 'square', label: '40A' }))).toMatchObject({ ampsEach: 40, source: 'label' });
  });
  it('a subscriber without a variant counts as three-phase, a missing count as 1 (as before)', () => {
    expect(consumerLoad(c({ variant: undefined, count: 0 }))).toMatchObject({ kind: 'three', count: 1, amps: 32 });
  });
  it('the load report gives exactly the same rows as before, for many random drawings', () => {
    const colors = ['#ff0000', '#0000ff', '#00aa00', ''];
    const labels = [undefined, '', '16', '25', '63', 'abc', '12.5', '0'];
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let t = 0; t < 300; t++) {
      const list = Array.from({ length: rnd(12) }, () => c({
        color: colors[rnd(colors.length)],
        variant: (['circle', 'square', undefined] as const)[rnd(3)],
        label: labels[rnd(labels.length)],
        count: rnd(5),
      }));
      expect(loadsByColor(list)).toEqual(oldReport(list));
    }
  });
});

describe('7.8 invalid load values', () => {
  it('a label that is a number ≤ 0, or a count that is not a whole number ≥ 1, is marked invalid', () => {
    expect(consumerLoad(c({ variant: 'square', label: '-40' })).invalid).toBe('label');
    expect(consumerLoad(c({ variant: 'square', label: '0' })).invalid).toBe('label');
    expect(consumerLoad(c({ variant: 'circle', count: -2 })).invalid).toBe('count');
    expect(consumerLoad(c({ variant: 'square', count: 1.5, label: '63' })).invalid).toBe('count');
    expect(consumerLoad(c({ variant: 'square', label: '63' })).invalid).toBeUndefined();
    expect(consumerLoad(c({ variant: 'square', label: 'x' })).invalid).toBeUndefined(); // the existing "no number → 32 A" rule
  });
});
