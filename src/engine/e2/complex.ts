// E2: complex numbers for the phasor calculation (no library).

export interface C { re: number; im: number }

export const c = (re: number, im = 0): C => ({ re, im });
export const ZERO: C = c(0, 0);
export const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
export const sub = (a: C, b: C): C => c(a.re - b.re, a.im - b.im);
export const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const scale = (a: C, k: number): C => c(a.re * k, a.im * k);
export const conj = (a: C): C => c(a.re, -a.im);
export const abs = (a: C): number => Math.hypot(a.re, a.im);
/** angle, rad */
export const arg = (a: C): number => Math.atan2(a.im, a.re);
export const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
/** magnitude and angle (rad) → complex */
export const polar = (magnitude: number, angleRad: number): C => c(magnitude * Math.cos(angleRad), magnitude * Math.sin(angleRad));
export const isFiniteC = (a: C): boolean => Number.isFinite(a.re) && Number.isFinite(a.im);
export const deg = (rad: number): number => (rad * 180) / Math.PI;
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;
