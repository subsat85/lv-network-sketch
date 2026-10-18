import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { calculateCablePath } from '../cableLayout';
import { CABLE_SPACING, SCENARIOS, SEEDS, buildScenario, offsetsOnAB, type Scenario } from './cableMatrix';

// Output of calculateCablePath BEFORE the Stage 4 fix (main @ 1dcf123), recorded
// for every scenario × seed in cableMatrix.ts. `overlap` marks the cases where two
// cables on the A–B segment were drawn exactly on top of each other.
type Legacy = Record<string, { offsets: number[]; overlap: boolean; paths: { x: number; y: number }[][] }>;
const legacy: Legacy = JSON.parse(readFileSync(fileURLToPath(new URL('./cableLayout.legacy.json', import.meta.url)), 'utf8'));

const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

function layout(sc: Scenario, seed: number) {
  const built = buildScenario(sc, seed);
  const paths = built.cables.map(c => calculateCablePath(c, built.elements).map(round));
  return { built, paths, offsets: offsetsOnAB(paths, built) };
}

describe('cableLayout: parallel cables never overlap', () => {
  for (const sc of SCENARIOS) {
    for (const seed of SEEDS) {
      it(`${sc.name} (seed ${seed})`, () => {
        const { offsets } = layout(sc, seed);
        const sorted = [...offsets].sort((a, b) => a - b);
        // distinct, evenly spaced by CABLE_SPACING and centred on the pole axis
        const n = sorted.length;
        const expected = sorted.map((_, i) => (i - (n - 1) / 2) * CABLE_SPACING);
        expect(sorted).toEqual(expected);
      });
    }
  }
});

describe('cableLayout: regression for the reproduced overlap (later segment, reverse-drawn cable)', () => {
  const cases: string[][] = [['AB', 'BA'], ['BA', 'AB'], ['AB', 'BA', 'AB'], ['BA', 'AB', 'BA'], ['AB', 'AB', 'BA']];
  for (const dirs of cases) {
    for (const seed of SEEDS) {
      it(`pairIndex1 ${dirs.join(',')} seed ${seed}: was overlapping, now separated by ${CABLE_SPACING}`, () => {
        const key = `pairIndex1:${dirs.join(',')}|${seed}`;
        expect(legacy[key].overlap).toBe(true); // reproduced before the fix
        const { offsets } = layout({ name: key, dirs, pairCableIndex: 1 }, seed);
        expect(new Set(offsets).size).toBe(offsets.length);
        const sorted = [...offsets].sort((a, b) => a - b);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeCloseTo(CABLE_SPACING, 6);
      });
    }
  }
});

describe('cableLayout: non-overlapping layouts are unchanged by the fix', () => {
  for (const sc of SCENARIOS) {
    for (const seed of SEEDS) {
      const key = `${sc.name}|${seed}`;
      it(`${key} ${legacy[key].overlap ? '(was overlapping: may change)' : 'identical to legacy'}`, () => {
        const { paths } = layout(sc, seed);
        if (!legacy[key].overlap) {
          expect(paths).toEqual(legacy[key].paths);
        } else {
          expect(paths).not.toEqual(legacy[key].paths);
        }
      });
    }
  }
  it('every first segment (all stored offsets 0) is identical to legacy, both directions', () => {
    const firsts = SCENARIOS.filter(s => s.pairCableIndex === 0);
    expect(firsts.length).toBeGreaterThan(5);
    for (const sc of firsts) for (const seed of SEEDS) {
      expect(layout(sc, seed).paths).toEqual(legacy[`${sc.name}|${seed}`].paths);
    }
  });
});

describe('cableLayout: deterministic for the same data', () => {
  it('same drawing gives the same layout regardless of evaluation order', () => {
    const sc = SCENARIOS.find(s => s.name === 'pairIndex1:AB,BA,AB,BA')!;
    const a = layout(sc, 11);
    const b = layout(sc, 11);
    expect(b.paths).toEqual(a.paths);
    // reversing the element array (e.g. different load order) must not change positions
    const built = buildScenario(sc, 11);
    const reversed = [...built.elements].reverse();
    const paths = built.cables.map(c => calculateCablePath(c, reversed).map(round));
    expect(offsetsOnAB(paths, built).sort()).toEqual(a.offsets.slice().sort());
  });
});
