import type { DistanceFlag, DrawingElement, ElectricalSettings } from '../../types/drawing';
import { voltageView } from '../e2Presentation';

/** The app's voltage-drop result (E2) of a drawing, for the tests (same call order as the former engine helper). */
export const computeVoltageView = (elements: readonly DrawingElement[], distances: Record<string, string>, settings: ElectricalSettings, flags: Record<string, DistanceFlag> = {}) =>
  voltageView({ elements, connectionDistances: distances, distanceFlags: flags, electrical: settings });

/**
 * Hand reference for a chain of spans with balanced three-phase constant-current loads (an
 * independent fixed-point phasor solution, written here; not E2's code): segments from the
 * source, each with its length (m) and the load at its far end (A per phase). Returns the drop
 * (V, phase to neutral) at the end of each segment.
 */
export const chainDrops = (segments: { Lm: number; A: number }[], r: number, x: number, pf = 0.9, Vph = 230): number[] => {
  const phi = Math.acos(pf);
  const n = segments.length;
  let V = segments.map(() => ({ re: Vph, im: 0 }));
  for (let it = 0; it < 200; it++) {
    const I = segments.map((s, i) => { const a = Math.atan2(V[i].im, V[i].re) - phi; return { re: s.A * Math.cos(a), im: s.A * Math.sin(a) }; });
    const J = I.map((_, i) => I.slice(i).reduce((t, c) => ({ re: t.re + c.re, im: t.im + c.im }), { re: 0, im: 0 }));
    const next: { re: number; im: number }[] = [];
    let up = { re: Vph, im: 0 };
    for (let i = 0; i < n; i++) {
      const zr = r * segments[i].Lm / 1000, zx = x * segments[i].Lm / 1000;
      up = { re: up.re - (zr * J[i].re - zx * J[i].im), im: up.im - (zr * J[i].im + zx * J[i].re) };
      next.push(up);
    }
    const d = Math.max(...next.map((v, i) => Math.hypot(v.re - V[i].re, v.im - V[i].im)));
    V = next;
    if (d < 1e-12) break;
  }
  return V.map((v) => Vph - Math.hypot(v.re, v.im));
};
