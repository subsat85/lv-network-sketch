import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawingPointAt, pagePoint, panTransform, pinchTransform, transformAbout, type ViewTransform } from '../viewTransform';

// The share preview view: zoom and rotation around the drawing's centre, pinch / pan from the
// gesture's start values only.

const T0: ViewTransform = { x: 120, y: -40, scale: 1.3, rotation: 0 };
const C = { x: 640, y: 910 }; // the drawing's centre (drawing units)
const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-9) => Math.hypot(a.x - b.x, a.y - b.y) < eps;

describe('share preview view transform', () => {
  it('pagePoint matches the SVG order translate · scale · rotate', () => {
    expect(pagePoint({ x: 10, y: 20, scale: 2, rotation: 90 }, { x: 1, y: 0 })).toEqual({ x: 10, y: expect.closeTo(22, 12) });
    expect(near(pagePoint({ x: 10, y: 20, scale: 2, rotation: 90 }, { x: 1, y: 0 }), { x: 10, y: 22 })).toBe(true);
  });

  // An SVG matrix [a b c d e f] built from the attribute as SVG defines it (translate · scale · rotate),
  // independently of pagePoint / transformAbout: the checks below measure the real page position.
  type M = [number, number, number, number, number, number];
  const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const svgMatrix = (t: ViewTransform): M => { const a = (t.rotation * Math.PI) / 180; return mul(mul([1, 0, 0, 1, t.x, t.y], [t.scale, 0, 0, t.scale, 0, 0]), [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); };
  const apply = (m: M, p: { x: number; y: number }) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
  // the drawing point at the same page place under both matrices
  const fixedPoint = (m0: M, m1: M) => { const A = m1[0] - m0[0], B = m1[2] - m0[2], Cc = m1[1] - m0[1], D = m1[3] - m0[3], rx = m0[4] - m1[4], ry = m0[5] - m1[5]; const det = A * D - B * Cc; return { x: (rx * D - B * ry) / det, y: (A * ry - Cc * rx) / det }; };

  it('pagePoint is the SVG matrix of "translate(x, y) scale(s) rotate(r)" (independent check, 200 random views)', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const t = { x: rnd() * 2000 - 1000, y: rnd() * 2000 - 1000, scale: 0.05 + rnd() * 5, rotation: rnd() * 720 - 360 };
      const p = { x: rnd() * 3000 - 1000, y: rnd() * 3000 - 1000 };
      expect(near(pagePoint(t, p), apply(svgMatrix(t), p), 1e-7)).toBe(true);
    }
  });

  it('every zoom / rotation step (buttons and pinch) has exactly one fixed point: the drawing centre, which stays at the same page place', () => {
    let t = T0;
    const steps: [number, number][] = [[1.1, 0], [0.9, 0], [1, 5], [1, -5], [2.5, 30], [0.4, -75]];
    for (const [f, r] of steps) {
      const next = transformAbout(t, C, t.scale * f, t.rotation + r);
      const m0 = svgMatrix(t), m1 = svgMatrix(next);
      expect(near(fixedPoint(m0, m1), C, 1e-6)).toBe(true);
      expect(near(apply(m1, C), apply(m0, C), 1e-9)).toBe(true);
      t = next;
    }
    const pinched = pinchTransform({ start: T0, dist: 80, angle: 10 }, 200, 47, C);
    expect(near(fixedPoint(svgMatrix(T0), svgMatrix(pinched)), C, 1e-6)).toBe(true);
    // the old behaviour (scale / rotate only) turned around the 0, 0 corner, not the centre
    expect(near(fixedPoint(svgMatrix(T0), svgMatrix({ ...T0, scale: T0.scale * 2 })), C, 1)).toBe(false);
  });

  it('drawingPointAt is the inverse of pagePoint', () => {
    const t = { x: 33, y: 71, scale: 0.7, rotation: -37 };
    expect(near(drawingPointAt(t, pagePoint(t, C)), C, 1e-9)).toBe(true);
  });

  it('zoom keeps the drawing centre where it is on the page (not the 0, 0 corner)', () => {
    const at = pagePoint(T0, C);
    for (const f of [1.1, 0.9, 3, 0.25]) expect(near(pagePoint(transformAbout(T0, C, T0.scale * f, T0.rotation), C), at)).toBe(true);
  });

  it('rotation turns around the drawing centre', () => {
    const at = pagePoint(T0, C);
    for (const r of [5, -5, 90, 180, -270]) expect(near(pagePoint(transformAbout(T0, C, T0.scale, r), C), at)).toBe(true);
  });

  it('repeated zoom / rotation steps do not drift: 1000 mixed steps, then back', () => {
    const at = pagePoint(T0, C);
    let t = T0;
    for (let i = 0; i < 500; i++) { t = transformAbout(t, C, t.scale * 1.1, t.rotation + 5); t = transformAbout(t, C, t.scale / 1.1, t.rotation - 5); }
    expect(near(pagePoint(t, C), at, 1e-6)).toBe(true);
    expect(t.scale).toBeCloseTo(T0.scale, 9);
    expect(t.rotation).toBeCloseTo(0, 9);
    expect(Math.abs(t.x - T0.x) + Math.abs(t.y - T0.y)).toBeLessThan(1e-6);
    // 72 × 5° one way, then 72 × 5° back
    let r = T0;
    for (let i = 0; i < 72; i++) r = transformAbout(r, C, r.scale, r.rotation + 5);
    expect(near(pagePoint(r, C), at, 1e-6)).toBe(true);
    for (let i = 0; i < 72; i++) r = transformAbout(r, C, r.scale, r.rotation - 5);
    expect(near(r, T0, 1e-6)).toBe(true);
    expect(r.rotation).toBe(0);
  });

  it('pinch: computed from the start of the gesture (fast moves give the same result as slow ones)', () => {
    const g = { start: T0, dist: 100, angle: 0 };
    const direct = pinchTransform(g, 250, 30, C);
    let last = T0;
    for (let d = 100; d <= 250; d += 5) last = pinchTransform(g, d, (d - 100) / 5, C);
    expect(last).toEqual(direct);
    expect(direct.scale).toBeCloseTo(T0.scale * 2.5, 12);
    expect(direct.rotation).toBe(30);
    expect(near(pagePoint(direct, C), pagePoint(T0, C))).toBe(true);
  });

  it('pinch that cannot be measured (fingers on one spot, or a bad distance) keeps the start view', () => {
    expect(pinchTransform({ start: T0, dist: 0, angle: 0 }, 120, 10, C)).toEqual(T0);
    expect(pinchTransform({ start: T0, dist: 100, angle: 0 }, 0, 10, C)).toEqual(T0);
    expect(pinchTransform({ start: T0, dist: 100, angle: 0 }, NaN, 10, C)).toEqual(T0);
  });

  it('pan moves by the finger offset from the start, scale and rotation unchanged', () => {
    expect(panTransform({ ...T0, rotation: 30 }, { x: 10, y: 10 }, { x: 25, y: -5 })).toEqual({ x: 135, y: -55, scale: 1.3, rotation: 30 });
  });

  it('the share preview never reads the gesture ref inside a state updater, and turns around the centre', () => {
    const c = readFileSync(resolve(__dirname, '../../components/SharePreview.tsx'), 'utf8');
    expect(c).not.toMatch(/setTransform\(\s*prev\s*=>/);
    expect(c).not.toContain('gestureRef.current!');
    expect(c).toContain('const g = gestureRef.current;');
    expect(c).toContain('setTransform(pinchTransform(g,');
    expect(c).toContain('const handleZoomIn = () => zoomBy(1.1);');
    expect(c).toContain('const handleRotateRight = () => rotateBy(5);');
    expect(c).toContain('onPointerCancel={handlePointerUp}');
  });
});
