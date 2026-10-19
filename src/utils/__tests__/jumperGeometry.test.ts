import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { arcGeometry, createArc, endPosition, listConnectionPoints } from '../cableArcs';
import { calculateCablePath } from '../cableLayout';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { useDrawingStore } from '../../store/drawingStore';
import type { CableArcElement, CableArcEnd, CableElement, DrawingElement, Point, SymbolElement } from '../../types/drawing';

// Jumper (cable_arc) geometry — Stage 6.3 reference: the jumper's ends sit on the
// cables away from the pole (visible gap), and the jumper runs round the pole
// parallel to its outline, never touching it.
//
// Every check reads the DRAWN SVG path back (M / L / Q / C / A) and measures it,
// independently of how arcGeometry builds it. The thresholds are requirements,
// not the implementation's constants, so the Stage 6.1 / 6.2 shapes (which start
// on the pole circle and bulge in and out) fail them.

const R = 20;
const MIN_GAP = 0.2 * R;        // required visible gap between jumper and pole outline
const C0 = { x: 300, y: 300 };
const pole = (id: string, x: number, y: number): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000000', fillColor: '#FFFFFF', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color: string): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: color, fillColor: 'transparent', strokeWidth: 2 });
const end = (cableId: string, side: 'prev' | 'next', occurrence = 0): CableArcEnd => ({ cableId, side, occurrence });
const key = (e: CableArcEnd) => `${e.cableId}:${e.side}:${e.occurrence}`;
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

// ---- read a drawn SVG path back into a dense polyline --------------------------
const samplePath = (d: string): Point[] => {
  const t = d.trim().replace(/,/g, ' ').split(/\s+/);
  const out: Point[] = []; let cur: Point = { x: 0, y: 0 }; let i = 0;
  const n = () => parseFloat(t[i++]);
  while (i < t.length) {
    const cmd = t[i++];
    if (cmd === 'M') { cur = { x: n(), y: n() }; out.push(cur); }
    else if (cmd === 'L') { cur = { x: n(), y: n() }; out.push(cur); }
    else if (cmd === 'Q') { const c = { x: n(), y: n() }, p = { x: n(), y: n() }; for (let k = 1; k <= 200; k++) { const u = k / 200; out.push({ x: (1 - u) ** 2 * cur.x + 2 * (1 - u) * u * c.x + u * u * p.x, y: (1 - u) ** 2 * cur.y + 2 * (1 - u) * u * c.y + u * u * p.y }); } cur = p; }
    else if (cmd === 'C') { const c1 = { x: n(), y: n() }, c2 = { x: n(), y: n() }, p = { x: n(), y: n() }; for (let k = 1; k <= 200; k++) { const u = k / 200, v = 1 - u; out.push({ x: v ** 3 * cur.x + 3 * v * v * u * c1.x + 3 * v * u * u * c2.x + u ** 3 * p.x, y: v ** 3 * cur.y + 3 * v * v * u * c1.y + 3 * v * u * u * c2.y + u ** 3 * p.y }); } cur = p; }
    else if (cmd === 'A') {
      // SVG elliptical arc, endpoint → centre parameterisation (rx = ry, no rotation)
      let r = n(); n(); n(); const large = n(), sweep = n(); const p = { x: n(), y: n() };
      const mx = (cur.x - p.x) / 2, my = (cur.y - p.y) / 2;
      const lam = (mx * mx + my * my) / (r * r); if (lam > 1) r *= Math.sqrt(lam);
      const sign = large === sweep ? -1 : 1;
      const co = sign * Math.sqrt(Math.max(0, (r * r - mx * mx - my * my) / (mx * mx + my * my)));
      const cx = co * my + (cur.x + p.x) / 2, cy = -co * mx + (cur.y + p.y) / 2;
      const a1 = Math.atan2(cur.y - cy, cur.x - cx); let da = Math.atan2(p.y - cy, p.x - cx) - a1;
      if (sweep && da < 0) da += 2 * Math.PI; if (!sweep && da > 0) da -= 2 * Math.PI;
      for (let k = 1; k <= 400; k++) { const a = a1 + (da * k) / 400; out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
      cur = p;
    } else throw new Error(`unexpected path command ${cmd}`);
  }
  return out;
};
const radii = (d: string, c: Point) => samplePath(d).map((p) => dist(p, c));

// Pole P (at C0): through-cable t, a parallel through-cable t2, branch br north,
// cable `in` arriving from the south, cable dg leaving diagonally.
const network = (P = C0): DrawingElement[] => [
  pole('A', P.x - 200, P.y), pole('P', P.x, P.y), pole('B', P.x + 200, P.y), pole('C', P.x, P.y - 200), pole('D', P.x, P.y + 200), pole('E', P.x + 150, P.y + 150),
  cable('t', ['A', 'P', 'B'], '#FF0000'), cable('t2', ['A', 'P', 'B'], '#0000FF'), cable('br', ['P', 'C'], '#00AA00'), cable('in', ['D', 'P'], '#AA00AA'), cable('dg', ['P', 'E'], '#999999'),
];
const withJumper = (els: DrawingElement[], a: CableArcEnd, b: CableArcEnd, id = 'j'): [DrawingElement[], CableArcElement] => {
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
/** distance from a point to a cable's drawn path (polyline) */
const distToCable = (p: Point, c: CableElement, els: DrawingElement[]) => {
  const path = calculateCablePath(c, els);
  let m = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    m = Math.min(m, Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy));
  }
  return m;
};
const firstPoint = (d: string) => samplePath(d)[0];
const lastPoint = (d: string) => { const s = samplePath(d); return s[s.length - 1]; };

describe('jumper ends keep clear of the pole', () => {
  it('1–2. start and end of the drawn path are a visible gap away from the pole outline, for every pair of points', () => {
    const els = network();
    const pairs = allPairs(els);
    expect(pairs.length).toBe(42);
    for (const [a, b] of pairs) {
      const [e2, j] = withJumper(els, a, b);
      const g = arcGeometry(e2, j, R)!;
      expect(dist(firstPoint(g.d), C0) - R, `start ${key(a)}→${key(b)}`).toBeGreaterThan(MIN_GAP);
      expect(dist(lastPoint(g.d), C0) - R, `end ${key(a)}→${key(b)}`).toBeGreaterThan(MIN_GAP);
      // and they sit on their own cables — including the offset parallel cables t / t2
      expect(distToCable(firstPoint(g.d), els.find((x) => x.id === a.cableId) as CableElement, els), `start on ${a.cableId}`).toBeLessThan(0.05);
      expect(distToCable(lastPoint(g.d), els.find((x) => x.id === b.cableId) as CableElement, els), `end on ${b.cableId}`).toBeLessThan(0.05);
    }
  });
  it('3. the whole drawn path stays outside the pole circle with that gap (the cable connection points are not moved)', () => {
    const els = network();
    const before = listConnectionPoints(els, 'P', R).map((p) => p.position);
    for (const [a, b] of allPairs(els)) {
      const [e2, j] = withJumper(els, a, b);
      expect(Math.min(...radii(arcGeometry(e2, j, R)!.d, C0)) - R, `${key(a)}→${key(b)}`).toBeGreaterThan(MIN_GAP);
      expect(listConnectionPoints(e2, 'P', R).map((p) => p.position)).toEqual(before);
    }
  });
  it('4. the ends lie on their own cables (not on the circle), whatever the angles — rotated networks', () => {
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * 2 * Math.PI, P = { x: 500, y: 400 };
      const rot = (dx: number, dy: number) => ({ x: P.x + dx * Math.cos(ang) - dy * Math.sin(ang), y: P.y + dx * Math.sin(ang) + dy * Math.cos(ang) });
      const q = [rot(-200, 0), rot(200, 0), rot(0, -200), rot(130, 160)];
      const els: DrawingElement[] = [pole('A', q[0].x, q[0].y), pole('P', P.x, P.y), pole('B', q[1].x, q[1].y), pole('C', q[2].x, q[2].y), pole('E', q[3].x, q[3].y),
        cable('t', ['A', 'P', 'B'], '#f00'), cable('br', ['C', 'P'], '#0f0'), cable('dg', ['P', 'E'], '#00f')];
      for (const [a, b] of allPairs(els)) {
        const [e2, j] = withJumper(els, a, b);
        const g = arcGeometry(e2, j, R)!;
        const s = firstPoint(g.d), e = lastPoint(g.d);
        expect(dist(s, P) - R).toBeGreaterThan(MIN_GAP);
        expect(dist(e, P) - R).toBeGreaterThan(MIN_GAP);
        expect(distToCable(s, els.find((x) => x.id === a.cableId) as CableElement, els), `start on ${a.cableId}`).toBeLessThan(0.05);
        expect(distToCable(e, els.find((x) => x.id === b.cableId) as CableElement, els), `end on ${b.cableId}`).toBeLessThan(0.05);
        expect(Math.min(...radii(g.d, P)) - R).toBeGreaterThan(MIN_GAP);
      }
    }
  });
});

describe('jumper follows the pole outline', () => {
  it('5. every point of the drawn path is at the same distance from the pole centre (parallel to the outline), and the curve is smooth', () => {
    const els = network();
    for (const [a, b] of allPairs(els)) {
      const [e2, j] = withJumper(els, a, b);
      const r = radii(arcGeometry(e2, j, R)!.d, C0);
      const spread = Math.max(...r) - Math.min(...r);
      expect(spread, `${key(a)}→${key(b)}`).toBeLessThan(0.05);         // a concentric arc, not a bulge
      expect(Math.max(...r)).toBeLessThan(R * 2.2);                        // close to the pole, not a big loop
      // smoothness: direction changes evenly (no corners)
      const s = samplePath(arcGeometry(e2, j, R)!.d);
      let maxTurn = 0;
      for (let i = 2; i < s.length; i++) {
        const t1 = Math.atan2(s[i - 1].y - s[i - 2].y, s[i - 1].x - s[i - 2].x), t2 = Math.atan2(s[i].y - s[i - 1].y, s[i].x - s[i - 1].x);
        let dt = Math.abs(t2 - t1); if (dt > Math.PI) dt = 2 * Math.PI - dt;
        maxTurn = Math.max(maxTurn, dt);
      }
      expect(maxTurn).toBeLessThan(0.05);
    }
  });
  it('6. swapping the two points draws the same curve, just in the other direction', () => {
    const els = network();
    for (const [a, b] of allPairs(els)) {
      const [e1, j1] = withJumper(els, a, b), [e2, j2] = withJumper(els, b, a);
      const s1 = samplePath(arcGeometry(e1, j1, R)!.d), s2 = samplePath(arcGeometry(e2, j2, R)!.d).reverse();
      expect(s1.length).toBe(s2.length);
      s1.forEach((p, i) => expect(dist(p, s2[i]), `${key(a)}↔${key(b)} #${i}`).toBeLessThan(0.05));
    }
  });
  it('7. same side (parallel cables towards A) goes the short way on that side; opposite sides go round one side', () => {
    const els = network();
    const [e1, same] = withJumper(els, end('t', 'prev'), end('t2', 'prev'));
    const s1 = samplePath(arcGeometry(e1, same, R)!.d);
    expect(s1.every((p) => p.x < C0.x - R)).toBe(true);                    // stays on the A side
    const [e2, opp] = withJumper(els, end('t', 'prev'), end('t', 'next'));
    const s2 = samplePath(arcGeometry(e2, opp, R)!.d);
    // away from the ends (which sit on the slightly offset cables) it is all on one side
    const ys = s2.slice(Math.floor(s2.length * 0.1), Math.ceil(s2.length * 0.9)).map((p) => p.y - C0.y);
    expect(ys.every((y) => y < 0) || ys.every((y) => y > 0)).toBe(true);
    expect(Math.min(...radii(arcGeometry(e2, opp, R)!.d, C0)) - R).toBeGreaterThan(MIN_GAP);
  });
});

describe('several jumpers on one pole', () => {
  it('8. overlapping jumpers are on separate rings a clear distance apart; non-overlapping ones stay close to the pole', () => {
    let els = network();
    const defs: [CableArcEnd, CableArcEnd][] = [[end('t', 'prev'), end('br', 'next')], [end('t2', 'prev'), end('br', 'next')], [end('t', 'prev'), end('t', 'next')], [end('in', 'prev'), end('dg', 'next')]];
    defs.forEach(([a, b], i) => { els = withJumper(els, a, b, `j${i}`)[0]; });
    const js = els.filter((e): e is CableArcElement => e.type === 'cable_arc');
    const ringR = js.map((j) => { const r = radii(arcGeometry(els, j, R)!.d, C0); return (Math.max(...r) + Math.min(...r)) / 2; });
    // j0 (W→N) and j1 (W→N, parallel cable) overlap → different rings, ≥ 0.2R apart
    expect(Math.abs(ringR[0] - ringR[1])).toBeGreaterThan(0.2 * R);
    // every jumper keeps the gap; none is blown up
    js.forEach((j) => expect(Math.min(...radii(arcGeometry(els, j, R)!.d, C0)) - R).toBeGreaterThan(MIN_GAP));
    expect(Math.max(...ringR)).toBeLessThan(R * 2.6);
    // a jumper that overlaps nothing stays on the innermost ring
    const lone = network();
    const [e1, j1] = withJumper(lone, end('in', 'prev'), end('dg', 'next'));
    expect(Math.abs(ringR[3] - (() => { const r = radii(arcGeometry(e1, j1, R)!.d, C0); return (Math.max(...r) + Math.min(...r)) / 2; })())).toBeLessThan(0.05);
    // drawn paths of different-ring jumpers never touch
    const p0 = samplePath(arcGeometry(els, js[0], R)!.d), p1 = samplePath(arcGeometry(els, js[1], R)!.d);
    expect(Math.min(...p0.map((p) => Math.min(...p1.map((q) => dist(p, q)))))).toBeGreaterThan(0.2 * R);
  });
  it('ends stay bound to their connection identities after the pole moves and the cables re-layout', () => {
    let els = network();
    els = withJumper(els, end('t2', 'prev'), end('dg', 'next'))[0];
    useDrawingStore.setState({ ...useDrawingStore.getState(), elements: els, history: [], redoStack: [], pendingStep: null }, true);
    const S = () => useDrawingStore.getState();
    S().updateElement('P', { x: 340, y: 270 }); S().commitHistory();
    S().addElement(cable('t3', ['A', 'P'], '#777777')); S().commitHistory();
    const now = S().elements; const j = now.find((e): e is CableArcElement => e.type === 'cable_arc')!;
    const g = arcGeometry(now, j, R)!;
    expect(g.a).toEqual(endPosition(now, 'P', j.from, R));
    expect(g.b).toEqual(endPosition(now, 'P', j.to, R));
    expect(distToCable(firstPoint(g.d), now.find((e) => e.id === 't2') as CableElement, now)).toBeLessThan(0.05);
    expect(distToCable(lastPoint(g.d), now.find((e) => e.id === 'dg') as CableElement, now)).toBeLessThan(0.05);
    expect(Math.min(...radii(g.d, { x: 340, y: 270 })) - R).toBeGreaterThan(MIN_GAP);
  });
});

describe('cables, renderers, naming, compatibility', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const src = (f: string) => readFileSync(path.join(root, f), 'utf8');
  it('9. cable paths are identical with and without jumpers', () => {
    const plain = network();
    let withJ = plain;
    withJ = withJumper(withJ, end('t', 'prev'), end('br', 'next'), 'j1')[0];
    withJ = withJumper(withJ, end('t', 'prev'), end('t', 'next'), 'j2')[0];
    for (const c of plain.filter((e): e is CableElement => e.type === 'cable')) expect(calculateCablePath(c, withJ)).toEqual(calculateCablePath(c, plain));
  });
  it('10. canvas and share/PDF preview draw the same path and the same end dots from one function, same pole radius', () => {
    const canvas = src('src/components/SketchCanvas.tsx'), preview = src('src/components/PreviewCanvas.tsx');
    expect(canvas).toMatch(/const arcRadius = POLE_RADIUS \* poleSizeScale;/);
    expect(canvas).toMatch(/arcGeometry\(elements, el, arcRadius\)/);
    expect(preview).toMatch(/arcGeometry\(elements, el, POLE_RADIUS \* poleSizeScale\)/);
    for (const f of [canvas, preview]) {
      expect(f).toMatch(/const POLE_RADIUS = 20;/);
      expect(f).toMatch(/cx=\{g\.start\.x\} cy=\{g\.start\.y\} r=\{g\.dotRadius\}/);
      expect(f).toMatch(/cx=\{g\.end\.x\} cy=\{g\.end\.y\} r=\{g\.dotRadius\}/);
    }
  });
  it('the tool is still named «Jumper — وصلة ربط»', () => {
    expect(src('src/components/ColumnContextMenu.tsx')).toContain('Jumper — وصلة ربط');
    expect(src('src/components/SketchCanvas.tsx')).toContain('aria-label="أداة وصلة الربط"');
  });
  it('a project saved with earlier jumpers (type cable_arc) opens, saves again without loss, and draws with the new clearance', () => {
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
    const g = arcGeometry(s.elements, legacyJumper as CableArcElement, R)!;
    expect(dist(firstPoint(g.d), C0) - R).toBeGreaterThan(MIN_GAP);
  });
});
