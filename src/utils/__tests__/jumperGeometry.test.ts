import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { arcGeometry, createArc, endPosition, listConnectionPoints } from '../cableArcs';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { useDrawingStore } from '../../store/drawingStore';
import type { CableArcElement, CableArcEnd, CableElement, DrawingElement, Point, SymbolElement } from '../../types/drawing';

// Stage 6.2: jumper (cable_arc) geometry must stay outside the pole circle.

const R = 20;
const pole = (id: string, x: number, y: number): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000000', fillColor: '#FFFFFF', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color: string): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: color, fillColor: 'transparent', strokeWidth: 2 });
const key = (e: CableArcEnd) => `${e.cableId}:${e.side}:${e.occurrence}`;

// ---- reading a drawn SVG path back (M / L / Q / C), so the test checks what is drawn ----
const pathPoints = (d: string): Point[][] => {
  const t = d.trim().split(/\s+/);
  const segs: Point[][] = [];
  let cur: Point | null = null; let i = 0;
  const num = () => parseFloat(t[i++]);
  while (i < t.length) {
    const cmd = t[i++];
    if (cmd === 'M') { cur = { x: num(), y: num() }; }
    else if (cmd === 'L') { const p = { x: num(), y: num() }; segs.push([cur!, p]); cur = p; }
    else if (cmd === 'Q') { const c = { x: num(), y: num() }, p = { x: num(), y: num() }; const s: Point[] = []; for (let k = 0; k <= 200; k++) { const u = k / 200; s.push({ x: (1 - u) ** 2 * cur!.x + 2 * (1 - u) * u * c.x + u * u * p.x, y: (1 - u) ** 2 * cur!.y + 2 * (1 - u) * u * c.y + u * u * p.y }); } for (let k = 1; k < s.length; k++) segs.push([s[k - 1], s[k]]); cur = p; }
    else if (cmd === 'C') { const c1 = { x: num(), y: num() }, c2 = { x: num(), y: num() }, p = { x: num(), y: num() }; const s: Point[] = []; for (let k = 0; k <= 200; k++) { const u = k / 200, v = 1 - u; s.push({ x: v ** 3 * cur!.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u ** 3 * p.x, y: v ** 3 * cur!.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u ** 3 * p.y }); } for (let k = 1; k < s.length; k++) segs.push([s[k - 1], s[k]]); cur = p; }
    else throw new Error(`unexpected path command ${cmd}`);
  }
  return segs;
};
const distToSeg = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
};
/** Closest approach of the drawn path to the pole centre (exact per drawn segment). */
const closest = (d: string, c: Point) => Math.min(...pathPoints(d).map(([a, b]) => distToSeg(c, a, b)));
/** Same, leaving out the first and last tenth of the path (the parts that start at the circle). */
const closestAwayFromEnds = (d: string, c: Point) => { const s = pathPoints(d); const n = Math.ceil(s.length / 10); return Math.min(...s.slice(n, s.length - n).map(([a, b]) => distToSeg(c, a, b))); };
// the path's coordinates are rounded to 0.01, so an end on the circle may read up to ~0.01 inside
const ON_CIRCLE = R - 0.015;
/** Closest approach between two drawn paths. */
const gap = (d1: string, d2: string) => {
  const p1 = pathPoints(d1).map((s) => s[0]), p2 = pathPoints(d2);
  return Math.min(...p1.map((p) => Math.min(...p2.map(([a, b]) => distToSeg(p, a, b)))));
};

// Pole P with a cable passing through (t), a parallel one (t2), a branch north (br),
// a cable arriving from the south (in) and one leaving diagonally (dg).
const network = (P = { x: 300, y: 300 }): DrawingElement[] => [
  pole('A', P.x - 200, P.y), pole('P', P.x, P.y), pole('B', P.x + 200, P.y), pole('C', P.x, P.y - 200), pole('D', P.x, P.y + 200), pole('E', P.x + 150, P.y + 150),
  cable('t', ['A', 'P', 'B'], '#FF0000'), cable('t2', ['A', 'P', 'B'], '#0000FF'), cable('br', ['P', 'C'], '#00AA00'), cable('in', ['D', 'P'], '#AA00AA'), cable('dg', ['P', 'E'], '#999999'),
];
const withArc = (els: DrawingElement[], a: CableArcEnd, b: CableArcEnd, id = 'j'): [DrawingElement[], CableArcElement] => {
  const r = createArc(els, 'P', a, b, id);
  if (!r.ok) throw new Error((r as { reason: string }).reason);
  return [[...els, r.arc], r.arc];
};
const allPairs = (els: DrawingElement[]) => {
  const pts = listConnectionPoints(els, 'P', R);
  const out: [CableArcEnd, CableArcEnd][] = [];
  for (let i = 0; i < pts.length; i++) for (let j = 0; j < pts.length; j++) if (i !== j) out.push([pts[i].end, pts[j].end]);
  return out;
};

describe('jumper path stays outside the pole circle', () => {
  it('1. for every pair of connection points (incl. opposite, adjacent, parallel), the whole drawn path keeps out of the circle', () => {
    const els = network();
    const pairs = allPairs(els);
    expect(pairs.length).toBe(42); // 7 points → 42 ordered pairs
    for (const [a, b] of pairs) {
      const [e2, arc] = withArc(els, a, b);
      const g = arcGeometry(e2, arc, R)!;
      expect(closest(g.d, { x: 300, y: 300 }), `${key(a)} → ${key(b)}`).toBeGreaterThanOrEqual(ON_CIRCLE);
      // and away from the ends it is clearly outside, not grazing the circle
      expect(closestAwayFromEnds(g.d, { x: 300, y: 300 }), `${key(a)} → ${key(b)}`).toBeGreaterThan(R + 1);
      expect(Math.hypot(g.apex.x - 300, g.apex.y - 300)).toBeGreaterThan(R * 1.5);
    }
  });
  it('the shape of Stage 6.1 (quadratic through a far control point) is caught by this check', () => {
    // both sides of a cable passing through: ends at (280,300) and (320,300)
    const old = 'M 280 300 Q 300 260 320 300';
    expect(closest(old, { x: 300, y: 300 })).toBeLessThan(R * 0.95);
  });
  it('2. swapping the order of the two points never puts it inside, and draws the same curve', () => {
    const els = network();
    for (const [a, b] of allPairs(els)) {
      const [e1, j1] = withArc(els, a, b);
      const [e2, j2] = withArc(els, b, a);
      const g1 = arcGeometry(e1, j1, R)!, g2 = arcGeometry(e2, j2, R)!;
      expect(closest(g2.d, { x: 300, y: 300 })).toBeGreaterThanOrEqual(ON_CIRCLE);
      const p1 = g1.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
      const p2 = [...g2.points].reverse().map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
      expect(p2, `${key(a)} ↔ ${key(b)}`).toEqual(p1);
    }
  });
  it('3. same side (two parallel cables towards A) and opposite sides (through-cable) both work', () => {
    const els = network();
    const [e1, same] = withArc(els, { cableId: 't', side: 'prev', occurrence: 0 }, { cableId: 't2', side: 'prev', occurrence: 0 });
    const g1 = arcGeometry(e1, same, R)!;
    expect(closest(g1.d, { x: 300, y: 300 })).toBeGreaterThanOrEqual(ON_CIRCLE);
    expect(g1.apex.x).toBeLessThan(300 - R); // stays on the A side
    const [e2, opp] = withArc(els, { cableId: 't', side: 'prev', occurrence: 0 }, { cableId: 't', side: 'next', occurrence: 0 });
    const g2 = arcGeometry(e2, opp, R)!;
    expect(closest(g2.d, { x: 300, y: 300 })).toBeGreaterThanOrEqual(ON_CIRCLE);
    expect(Math.abs(g2.apex.x - 300)).toBeLessThan(R * 0.5);     // goes round over the top/bottom
    expect(Math.abs(g2.apex.y - 300)).toBeGreaterThan(R * 1.5);
  });
  it('holds wherever the pole is and whatever the cable directions (rotated networks)', () => {
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * 2 * Math.PI, P = { x: 500, y: 400 };
      const rot = (dx: number, dy: number) => ({ x: P.x + dx * Math.cos(ang) - dy * Math.sin(ang), y: P.y + dx * Math.sin(ang) + dy * Math.cos(ang) });
      const pts = [rot(-200, 0), rot(200, 0), rot(0, -200), rot(130, 160)];
      const els: DrawingElement[] = [pole('A', pts[0].x, pts[0].y), pole('P', P.x, P.y), pole('B', pts[1].x, pts[1].y), pole('C', pts[2].x, pts[2].y), pole('E', pts[3].x, pts[3].y),
        cable('t', ['A', 'P', 'B'], '#f00'), cable('br', ['C', 'P'], '#0f0'), cable('dg', ['P', 'E'], '#00f')];
      for (const [a, b] of allPairs(els)) {
        const [e2, arc] = withArc(els, a, b);
        expect(closest(arcGeometry(e2, arc, R)!.d, P)).toBeGreaterThanOrEqual(ON_CIRCLE);
      }
    }
  });
});

describe('several jumpers and their ends', () => {
  it('4. several jumpers on one pole stay apart from each other and outside the circle', () => {
    let els = network();
    const ends: [string, 'prev' | 'next', string, 'prev' | 'next'][] = [['t', 'prev', 'br', 'next'], ['t2', 'prev', 'br', 'next'], ['t', 'prev', 't', 'next'], ['in', 'prev', 'dg', 'next']];
    ends.forEach(([c1, s1, c2, s2], i) => { els = withArc(els, { cableId: c1, side: s1, occurrence: 0 }, { cableId: c2, side: s2, occurrence: 0 }, `j${i}`)[0]; });
    const geos = els.filter((e): e is CableArcElement => e.type === 'cable_arc').map((j) => arcGeometry(els, j, R)!);
    for (const g of geos) expect(closest(g.d, { x: 300, y: 300 })).toBeGreaterThanOrEqual(ON_CIRCLE);
    // the two jumpers from the parallel cables to the same branch are nested, not on top of each other
    const midGap = Math.hypot(geos[0].apex.x - geos[1].apex.x, geos[0].apex.y - geos[1].apex.y);
    expect(midGap).toBeGreaterThan(R * 0.4);
    expect(gap(geos[0].d, geos[1].d)).toBeGreaterThan(0); // they only meet where they share the br end
  });
  it('5. the ends are exactly the connection points of the chosen identities, after moves and re-layout', () => {
    let els = network();
    els = withArc(els, { cableId: 't2', side: 'prev', occurrence: 0 }, { cableId: 'dg', side: 'next', occurrence: 0 })[0];
    useDrawingStore.setState({ ...useDrawingStore.getState(), elements: els, history: [], redoStack: [], pendingStep: null }, true);
    const S = () => useDrawingStore.getState();
    S().updateElement('P', { x: 340, y: 270 }); S().commitHistory();
    S().addElement(cable('t3', ['A', 'P'], '#777777')); S().commitHistory();
    const now = S().elements; const j = now.find((e): e is CableArcElement => e.type === 'cable_arc')!;
    const g = arcGeometry(now, j, R)!;
    expect(g.a).toEqual(endPosition(now, 'P', j.from, R));
    expect(g.b).toEqual(endPosition(now, 'P', j.to, R));
    expect(closest(g.d, { x: 340, y: 270 })).toBeGreaterThanOrEqual(ON_CIRCLE);
  });
});

describe('one geometry everywhere, naming, compatibility', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
  it('6. canvas and share/PDF preview draw jumpers with the same function and the same pole radius', () => {
    const canvas = src('src/components/SketchCanvas.tsx'), preview = src('src/components/PreviewCanvas.tsx');
    expect(canvas).toMatch(/const arcRadius = POLE_RADIUS \* poleSizeScale;/);
    expect(canvas).toMatch(/arcGeometry\(elements, el, arcRadius\)/);
    expect(preview).toMatch(/arcGeometry\(elements, el, POLE_RADIUS \* poleSizeScale\)/);
    expect(canvas).toMatch(/const POLE_RADIUS = 20;/);
    expect(preview).toMatch(/const POLE_RADIUS = 20;/);
  });
  it('7. the tool is named «Jumper — وصلة ربط» in the pole menu and the tool bar; no "قوس" left for it', () => {
    const menu = src('src/components/ColumnContextMenu.tsx'), canvas = src('src/components/SketchCanvas.tsx');
    expect(menu).toContain('Jumper — وصلة ربط');
    expect(canvas).toContain('aria-label="أداة وصلة الربط"');
    expect(canvas).toContain('aria-label="إنهاء وصلة الربط"');
    expect(menu).not.toMatch(/>\s*قوس\s*</);
    expect(canvas).not.toMatch(/القوس|>\s*قوس\s*</);
  });
  it('8. a project saved with Stage 6.1 jumpers (type cable_arc) opens and saves again without loss', () => {
    // element exactly as Stage 6.1 wrote it
    const legacyJumper = { id: 'old1', type: 'cable_arc', poleId: 'P', from: { cableId: 't', side: 'prev', occurrence: 0 }, to: { cableId: 'br', side: 'next', occurrence: 0 }, x: 0, y: 0, strokeColor: '#123456', fillColor: 'none', strokeWidth: 3 };
    const file = { version: 1, elements: [...network(), legacyJumper], style: { strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: {}, connectionLabelOffsets: {}, metadata: { id: null, name: 'Old', exportedAt: 1 } };
    const r = parseProjectFile(JSON.stringify(file));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    useDrawingStore.getState().loadProject(r.data);
    const s = useDrawingStore.getState();
    expect(s.elements.find((e) => e.id === 'old1')).toEqual(legacyJumper);
    const again = parseProjectFile(serializeProject(s.elements, s.style, s.poleSizeScale, s.consumerVariant, s.connectionDistances, s.connectionLabelOffsets, null, 'Old', 1, 1));
    expect(again.ok && again.data.elements.find((e) => e.id === 'old1')).toEqual(legacyJumper);
    // and it is now drawn outside the circle
    const g = arcGeometry(s.elements, legacyJumper as CableArcElement, R)!;
    expect(closest(g.d, { x: 300, y: 300 })).toBeGreaterThanOrEqual(ON_CIRCLE);
  });
});
