import { describe, expect, it } from 'vitest';
import { abs, add, arg, c, conj, deg, div, isFiniteC, mul, polar, rad, scale, sub } from '../complex';

describe('complex helpers', () => {
  it('arithmetic', () => {
    expect(add(c(1, 2), c(3, -1))).toEqual(c(4, 1));
    expect(sub(c(1, 2), c(3, -1))).toEqual(c(-2, 3));
    expect(mul(c(1, 2), c(3, -1))).toEqual(c(5, 5));
    expect(scale(c(1, -2), 3)).toEqual(c(3, -6));
    expect(conj(c(1, 2))).toEqual(c(1, -2));
    const q = div(c(5, 5), c(3, -1));
    expect(q.re).toBeCloseTo(1, 12);
    expect(q.im).toBeCloseTo(2, 12);
  });
  it('polar form and angles', () => {
    const z = polar(230, rad(-120));
    expect(abs(z)).toBeCloseTo(230, 10);
    expect(deg(arg(z))).toBeCloseTo(-120, 10);
    expect(isFiniteC(c(Number.NaN, 0))).toBe(false);
    expect(isFiniteC(div(c(1, 0), c(0, 0)))).toBe(false);
  });
});
