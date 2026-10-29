// The share preview's view of the drawing on the A4 page: `translate(x, y) scale(scale) rotate(rotation)`.
// A drawing point p is drawn at  page = (x, y) + scale · R(rotation) · p.
// Zooming and rotating keep one drawing point (the pivot, the centre of the drawing) where it is on
// the page, so the drawing turns and grows around its own centre instead of its 0, 0 corner.
// Only this view changes; no element or saved value does.

export interface ViewTransform { x: number; y: number; scale: number; rotation: number }
export interface Point { x: number; y: number }

const rad = (deg: number) => (deg * Math.PI) / 180;

/** where drawing point `p` is on the page under `t` */
export const pagePoint = (t: ViewTransform, p: Point): Point => {
  const a = rad(t.rotation), c = Math.cos(a), s = Math.sin(a);
  return { x: t.x + t.scale * (c * p.x - s * p.y), y: t.y + t.scale * (s * p.x + c * p.y) };
};

/** `t` with a new scale / rotation, moved so that drawing point `pivot` stays at the same page place */
export const transformAbout = (t: ViewTransform, pivot: Point, scale: number, rotation: number): ViewTransform => {
  const at = pagePoint(t, pivot);
  const moved = pagePoint({ x: 0, y: 0, scale, rotation }, pivot);
  return { x: at.x - moved.x, y: at.y - moved.y, scale, rotation };
};

export interface PinchStart { start: ViewTransform; dist: number; angle: number }

/**
 * Two fingers: scale by the change of their distance and turn by the change of their angle (degrees),
 * always from the transform at the start of the pinch (no step-by-step drift), around `pivot`.
 * A pinch that started with both fingers on one spot cannot be measured: the start transform is kept.
 */
export const pinchTransform = (g: PinchStart, dist: number, angle: number, pivot: Point): ViewTransform => {
  if (!(g.dist > 0) || !Number.isFinite(dist) || !(dist > 0)) return { ...g.start };
  return transformAbout(g.start, pivot, g.start.scale * (dist / g.dist), g.start.rotation + (angle - g.angle));
};

/** one finger: move by the finger's offset from where it started */
export const panTransform = (start: ViewTransform, from: Point, to: Point): ViewTransform => ({ ...start, x: start.x + (to.x - from.x), y: start.y + (to.y - from.y) });

/** the drawing point shown at page point `q` under `t` (the inverse of pagePoint) */
export const drawingPointAt = (t: ViewTransform, q: Point): Point => {
  const a = rad(-t.rotation), c = Math.cos(a), s = Math.sin(a);
  const dx = (q.x - t.x) / t.scale, dy = (q.y - t.y) / t.scale;
  return { x: c * dx - s * dy, y: s * dx + c * dy };
};
