import { describe, expect, it } from 'vitest';
import type { CableElement, ConsumerElement, DrawingElement, SymbolElement } from '../../types/drawing';
import { autoConsumerOffset, squareLabelRoom, squareLabelY } from '../consumerPlacement';
import { consumerShapes } from '../overlayLayout';

// The label of a three-phase subscriber (square) is drawn on the side away from its pole, and a
// vertical stack leaves room for it (display only). ALL DRAWINGS ARE SYNTHETIC.

const R = 20; // pole radius used here
const pole = (id: string, x: number, y: number): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 40, height: 40, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 } as SymbolElement);
const cable = (poleIds: string[]): CableElement => ({ id: 'k', type: 'cable', x: 0, y: 0, poleIds, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 } as unknown as CableElement);
const sub = (id: string, poleId: string, variant: 'circle' | 'square', label = '', o: Partial<ConsumerElement> = {}): ConsumerElement =>
  ({ id, type: 'consumer', x: 0, y: 0, poleId, color: '#000', count: 1, strokeColor: '#000', fillColor: '#000', strokeWidth: 2, variant, label, ...o } as ConsumerElement);

type Box = { x: number; y: number; w: number; h: number };
const hitsCircle = (b: Box, cx: number, cy: number, r: number) => {
  const nx = Math.max(b.x, Math.min(cx, b.x + b.w)), ny = Math.max(b.y, Math.min(cy, b.y + b.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r;
};
const hitsBox = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const squareBox = (s: { cx: number; cy: number; r: number }): Box => ({ x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r });

describe('the stack offset', () => {
  const list = [sub('a', 'P', 'square', '200'), sub('b', 'P', 'circle'), sub('c', 'P', 'square', '63')];
  it('unchanged sideways and for a vertical stack with no labelled square (the original rule)', () => {
    for (const scale of [0.7, 1, 1.6]) {
      const r = 16 * scale, m = 5 * scale;
      for (let i = 0; i < 3; i++) expect(autoConsumerOffset(list, i, R, scale, false)).toBeCloseTo(R + r + m + i * (2 * r + m));
      const plain = [sub('a', 'P', 'circle'), sub('b', 'P', 'square'), sub('c', 'P', 'circle')];
      for (let i = 0; i < 3; i++) expect(autoConsumerOffset(plain, i, R, scale, true)).toBeCloseTo(R + r + m + i * (2 * r + m));
    }
  });
  it('a vertical stack keeps room for the label of each square before it (the first one is where it was)', () => {
    expect(autoConsumerOffset(list, 0, R, 1, true)).toBe(R + 21);
    expect(autoConsumerOffset(list, 1, R, 1, true)).toBe(R + 21 + 37 + squareLabelRoom(1));
    expect(autoConsumerOffset(list, 2, R, 1, true)).toBe(R + 21 + 2 * 37 + squareLabelRoom(1));
  });
  it('the label is below the square when the stack goes down, above it otherwise', () => {
    expect(squareLabelY(16, 1)).toBe(26);
    expect([squareLabelY(16, -1), squareLabelY(16, 0)]).toEqual([-26, -26]);
  });
});

describe('the drawn positions (the same rule the canvas and the overlay layout use)', () => {
  const ctx = { poleRadius: R, consumerScale: 1 };
  it('the reported case: a labelled square under the end pole of a line drawn downward — clear of the pole', () => {
    for (const poles of [['A', 'B', 'C'], ['C', 'B', 'A']]) { // both drawing directions
      const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 0, 110), pole('C', 0, 220), cable(poles), sub('s', 'C', 'square', '200')];
      const [s] = consumerShapes(els, ctx);
      expect([s.cx, s.cy]).toEqual([0, 220 + R + 21]); // the square itself has not moved
      expect(s.label!.y).toBeGreaterThan(s.cy + s.r); // its label below it
      expect(hitsCircle(s.label!, 0, 220, R)).toBe(false);
      expect(hitsBox(s.label!, squareBox(s))).toBe(false);
    }
  });
  it('several squares and a circle stacked down: no label on a pole or on another subscriber', () => {
    const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 0, 130), cable(['A', 'B']), sub('s1', 'B', 'square', '200'), sub('s2', 'B', 'square', '63'), sub('c', 'B', 'circle')];
    const shapes = consumerShapes(els, ctx);
    for (const s of shapes) if (s.label) {
      expect(hitsCircle(s.label, 0, 130, R)).toBe(false);
      for (const o of shapes) expect(o.square ? hitsBox(s.label, squareBox(o)) : hitsCircle(s.label, o.cx, o.cy, o.r)).toBe(false);
    }
    // the shapes themselves do not overlap either
    expect(shapes[1].cy - shapes[0].cy).toBeGreaterThan(2 * 16);
    expect(shapes[2].cy - shapes[1].cy).toBeGreaterThan(2 * 16);
  });
  it('a stack going up: labels above, clear of the next square', () => {
    const els: DrawingElement[] = [pole('A', 0, 300), pole('B', 0, 170), cable(['A', 'B']), sub('s1', 'B', 'square', '200'), sub('s2', 'B', 'square', '63')];
    const shapes = consumerShapes(els, ctx);
    expect(shapes[0].label!.y + shapes[0].label!.h).toBeLessThan(shapes[0].cy - 16);
    expect(hitsBox(shapes[0].label!, squareBox(shapes[1]))).toBe(false);
    expect(hitsCircle(shapes[0].label!, 0, 170, R)).toBe(false);
  });
  it('sideways (a horizontal line end) and a subscriber placed by hand: exactly as before', () => {
    const side = consumerShapes([pole('A', 0, 0), pole('B', 120, 0), cable(['A', 'B']), sub('s', 'B', 'square', '200'), sub('t', 'B', 'square', '63')], ctx);
    expect(side.map((s) => [s.cx, s.cy])).toEqual([[120 + R + 21, 0], [120 + R + 21 + 37, 0]]);
    expect(side[0].label!.y).toBeLessThan(-16); // above
    const manual = consumerShapes([pole('A', 0, 0), pole('B', 0, 110), cable(['A', 'B']), sub('m', 'B', 'square', '200', { hasManualPosition: true, x: 50, y: 60 })], ctx);
    expect([manual[0].cx, manual[0].cy]).toEqual([50, 60]);
    expect(manual[0].label!.y).toBeLessThan(60 - 16); // above, as before
  });
  it('nothing in the elements is changed', () => {
    const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 0, 110), cable(['A', 'B']), sub('s', 'B', 'square', '200')];
    const before = JSON.stringify(els);
    consumerShapes(els, ctx);
    expect(JSON.stringify(els)).toBe(before);
  });
});
