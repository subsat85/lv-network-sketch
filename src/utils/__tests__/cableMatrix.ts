// Test fixtures for cableLayout: builds drawings the same way the editor does.
//
// - IDs come from the editor's generator: Math.random().toString(36).substr(2, 9),
//   driven by a seeded PRNG so each scenario is reproducible per seed.
// - When a cable is drawn onto a pole pair that already has a cable, the editor
//   copies that cable's `cableIndex`/`offset` (SketchCanvas "Match the
//   cableIndex/offset of the existing cable"). So every cable on one pair
//   carries the same stored offset: 0 on the first pair of a drawing, ±8, +16 … on
//   later pairs.
import type { CableElement, DrawingElement, SymbolElement } from '../../types/drawing';

export const SEEDS = [11, 12345, 987654] as const;
export const CABLE_SPACING = 8;

export function seededIdGenerator(seed: number) {
  let t = seed;
  const rnd = () => { t = (t * 1103515245 + 12345) % 2147483648; return t / 2147483648; };
  return () => rnd().toString(36).substr(2, 9);
}

/** Stored offset the editor gives the n-th cable of a drawing (0, +8, -8, +16, -16 …). */
export function editorOffset(cableIndex: number): number {
  if (cableIndex === 0) return 0;
  const isOdd = cableIndex % 2 !== 0;
  const multiplier = isOdd ? (cableIndex + 1) / 2 : -(cableIndex / 2);
  return multiplier * CABLE_SPACING;
}

const pole = (id: string, x: number, y: number, symbolId = 'lv-pole'): SymbolElement => ({
  id, type: 'symbol', symbolId, x, y, width: 24, height: 24,
  strokeColor: '#000000', fillColor: '#FFFFFF', strokeWidth: 2,
});

const cableEl = (id: string, poleIds: string[], cableIndex: number, offset: number): CableElement => ({
  id, type: 'cable', x: 0, y: 0, poleIds, strokeColor: '#000000', fillColor: 'none',
  strokeWidth: 2, cableIndex, offset, lineStyle: 'zigzag',
});

export interface Scenario {
  name: string;
  /** directions of the cables drawn between A and B, e.g. ['AB','BA'] */
  dirs: string[];
  /** stored offset index of the first cable on the pair (0 = first pair of drawing) */
  pairCableIndex: number;
  /** extra pole C so cables run A→B→C / C→B→A (multi-pole cables) */
  viaC?: boolean;
  /** B is a transformer */
  transformerB?: boolean;
}

export const SCENARIOS: Scenario[] = (() => {
  const dirSets = [['AB', 'AB'], ['AB', 'BA'], ['BA', 'AB'], ['BA', 'BA'], ['AB', 'AB', 'AB'], ['AB', 'BA', 'AB'], ['AB', 'AB', 'BA'], ['BA', 'AB', 'BA'], ['AB', 'BA', 'AB', 'BA'], ['AB', 'AB', 'AB', 'BA', 'BA']];
  const out: Scenario[] = [];
  for (const pairCableIndex of [0, 1, 2, 3]) {
    for (const dirs of dirSets) out.push({ name: `pairIndex${pairCableIndex}:${dirs.join(',')}`, dirs, pairCableIndex });
  }
  for (const pairCableIndex of [0, 1]) {
    out.push({ name: `pairIndex${pairCableIndex}:viaC:AB,BA`, dirs: ['AB', 'BA'], pairCableIndex, viaC: true });
    out.push({ name: `pairIndex${pairCableIndex}:viaC:AB,AB,BA`, dirs: ['AB', 'AB', 'BA'], pairCableIndex, viaC: true });
    out.push({ name: `pairIndex${pairCableIndex}:transformer:AB,BA`, dirs: ['AB', 'BA'], pairCableIndex, transformerB: true });
  }
  return out;
})();

export interface Built { elements: DrawingElement[]; A: SymbolElement; B: SymbolElement; cables: CableElement[] }

export function buildScenario(sc: Scenario, seed: number): Built {
  const gen = seededIdGenerator(seed);
  const A = pole(gen(), 100, 100);
  const B = pole(gen(), 400, 100, sc.transformerB ? 'transformer' : 'lv-pole');
  const C = pole(gen(), 400, 300);
  const elements: DrawingElement[] = [A, B];
  if (sc.viaC) elements.push(C);
  // earlier cables elsewhere in the drawing so this pair gets a non-zero stored offset
  for (let i = 0; i < sc.pairCableIndex; i++) {
    const P = pole(gen(), 100, 500 + i * 100), Q = pole(gen(), 400, 500 + i * 100);
    elements.push(P, Q, cableEl(gen(), [P.id, Q.id], i, editorOffset(i)));
  }
  const offset = editorOffset(sc.pairCableIndex);
  const cables: CableElement[] = [];
  for (const d of sc.dirs) {
    let ids = d === 'AB' ? [A.id, B.id] : [B.id, A.id];
    if (sc.viaC) ids = d === 'AB' ? [A.id, B.id, C.id] : [C.id, B.id, A.id];
    const c = cableEl(gen(), ids, sc.pairCableIndex, offset);
    cables.push(c); elements.push(c);
  }
  return { elements, A, B, cables };
}

/**
 * Perpendicular offset (world units, left-hand normal of A→B positive) of each
 * cable's A–B run, taken at the end of that run nearest to pole A. Rounded to 0.01.
 * The A–B run is the path segment whose ends project to opposite ends of A–B.
 */
export function offsetsOnAB(paths: { x: number; y: number }[][], built: Built): number[] {
  const { A, B } = built;
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const t = (p: { x: number; y: number }) => ((p.x - A.x) * ux + (p.y - A.y) * uy) / len;
  const perp = (p: { x: number; y: number }) => (p.x - A.x) * nx + (p.y - A.y) * ny;
  return paths.map(pts => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(t(a) - t(b)) > 0.7 && Math.abs(perp(a)) < 60 && Math.abs(perp(b)) < 60) {
        const nearA = t(a) < t(b) ? a : b;
        return Math.round(perp(nearA) * 100) / 100;
      }
    }
    return NaN;
  });
}
