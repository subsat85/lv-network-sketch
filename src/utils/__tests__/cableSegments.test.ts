import { beforeEach, describe, expect, it } from 'vitest';
import { calculateCablePath } from '../cableLayout';
import { pathSegmentSpans, pairKey } from '../cableSegments';
import { SCENARIOS, SEEDS, buildScenario } from './cableMatrix';
import { useDrawingStore, historyGestureStart, historyGestureEnd } from '../../store/drawingStore';
import type { CableElement, DrawingElement, Point, SymbolElement } from '../../types/drawing';

// Stage 5.2 regression: tapping a cable must edit the distance of the span that was tapped.

const pole = (id: string, x: number, y: number, symbolId = 'lv-pole'): SymbolElement => ({ id, type: 'symbol', symbolId, x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], offset = 0): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset, lineStyle: 'zigzag', strokeColor: '#f00', fillColor: 'transparent', strokeWidth: 2 });
const byId = (els: DrawingElement[], id: string) => els.find((e) => e.id === id)!;
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// For every span of the cable: the drawn segment a user taps in the middle of that span
// (the one whose midpoint is nearest the span midpoint) must map to that span — and every
// drawn segment must map to one of the cable's own spans.
const expectSpansCorrect = (c: CableElement, els: DrawingElement[]) => {
  const path = calculateCablePath(c, els);
  const spans = pathSegmentSpans(c, els, path);
  const own = new Set(c.poleIds.slice(1).map((id, i) => pairKey(c.poleIds[i], id)));
  spans.forEach((s) => { if (s) expect(own.has(s.key)).toBe(true); });
  for (let j = 0; j < c.poleIds.length - 1; j++) {
    const P = byId(els, c.poleIds[j]), Q = byId(els, c.poleIds[j + 1]);
    const m = mid(P, Q);
    let best = -1, bestD = Infinity;
    path.slice(0, -1).forEach((a, i) => { if (!spans[i]) return; const d = Math.hypot(mid(a, path[i + 1]).x - m.x, mid(a, path[i + 1]).y - m.y); if (d < bestD) { bestD = d; best = i; } });
    expect(spans[best]?.key, `cable ${c.id} span ${j}`).toBe(pairKey(P.id, Q.id));
    expect(spans[best]?.index).toBe(j);
  }
  return { path, spans };
};

describe('tapping a cable picks the span that was tapped', () => {
  it('old behaviour reproduced: the path-segment index is not the pole index', () => {
    const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 300, 0), pole('C', 600, 0)];
    const c = cable('t', ['A', 'B', 'C']); els.push(c);
    const path = calculateCablePath(c, els);
    // path: A centre, A–B start, A–B end, B–C start, B–C end, C centre → the A–B run is segment 1
    const ab = path.slice(0, -1).findIndex((p, i) => mid(p, path[i + 1]).x > 100 && mid(p, path[i + 1]).x < 200);
    expect(ab).toBe(1);
    const old = pairKey(c.poleIds[ab], c.poleIds[ab + 1]); // what the old code edited
    expect(old).toBe('B_C');
    expect(pathSegmentSpans(c, els, path)[ab]?.key).toBe('A_B');
  });

  it('two-pole cable: every drawn piece is that span', () => {
    const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 300, 100)];
    const c = cable('c', ['A', 'B']); els.push(c);
    const spans = pathSegmentSpans(c, els);
    expect(spans.filter(Boolean).every((s) => s!.key === 'A_B')).toBe(true);
  });

  it('first and later spans of a multi-span cable (straight, bent and acute-angle routes)', () => {
    const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 300, 0), pole('C', 300, 300), pole('D', 600, 300), pole('E', 380, 80), pole('F', 900, 300)];
    const c = cable('m', ['A', 'B', 'C', 'D', 'E', 'F']); els.push(c);
    const { spans } = expectSpansCorrect(c, els);
    expect(new Set(spans.filter(Boolean).map((s) => s!.key))).toEqual(new Set(['A_B', 'B_C', 'C_D', 'D_E', 'E_F']));
  });

  it('both drawing directions on the same poles (parallel, offset cables)', () => {
    const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 300, 0), pole('C', 600, 150)];
    const fwd = cable('f', ['A', 'B', 'C'], 0), rev = cable('r', ['C', 'B', 'A'], 0), fwd2 = cable('g', ['A', 'B', 'C'], 0);
    els.push(fwd, rev, fwd2);
    for (const c of [fwd, rev, fwd2]) expectSpansCorrect(c, els);
    // reverse cable: its first span is C–B
    const rs = pathSegmentSpans(rev, els);
    expect(rs.find(Boolean)?.key).toBe('B_C');
  });

  it('cables ending or starting at a transformer', () => {
    const els: DrawingElement[] = [pole('T', 0, 0, 'transformer'), pole('B', 300, 0), pole('C', 600, 200), pole('T2', 900, 200, 'transformer')];
    const out = cable('o', ['T', 'B', 'C']), into = cable('i', ['C', 'B', 'T']), both = cable('b', ['T', 'B']);
    els.push(out, into, both);
    for (const c of [out, into, both]) expectSpansCorrect(c, els);
  });

  it('known layout limit (unchanged here): a cable with a transformer at both ends is drawn straight between the two transformers, skipping the poles in between; taps still map only to that cable\'s spans', () => {
    const els: DrawingElement[] = [pole('T', 0, 0, 'transformer'), pole('B', 300, 0), pole('C', 600, 200), pole('T2', 900, 200, 'transformer')];
    const c = cable('b', ['T', 'B', 'C', 'T2']); els.push(c);
    const path = calculateCablePath(c, els);
    // the drawn path goes T-edge → B-side → T2-edge: there is no drawn piece along C–T2
    expect(path).toHaveLength(3);
    const keys = pathSegmentSpans(c, els, path).map((s) => s?.key);
    expect(keys[0]).toBe('B_T');
    expect(['B_C', 'C_T2']).toContain(keys[1]);
    const els2: DrawingElement[] = [pole('T', 0, 0, 'transformer'), pole('B', 300, 0), pole('T2', 900, 200, 'transformer')];
    const c2 = cable('b2', ['T', 'B', 'T2']); els2.push(c2);
    expect(calculateCablePath(c2, els2)).toHaveLength(2);
    expect(['B_T', 'B_T2']).toContain(pathSegmentSpans(c2, els2)[0]?.key);
  });

  it('every cable-ordering scenario of Stage 4 × seeds (first pair / later pairs, mixed directions, via C, transformer)', () => {
    let checked = 0;
    for (const sc of SCENARIOS) for (const seed of SEEDS) {
      const built = buildScenario(sc, seed);
      for (const c of built.elements.filter((e): e is CableElement => e.type === 'cable')) { expectSpansCorrect(c, built.elements); checked++; }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('a missing pole id in an old cable does not shift the spans', () => {
    const els: DrawingElement[] = [pole('A', 0, 0), pole('B', 300, 0), pole('C', 600, 0)];
    const c = cable('x', ['A', 'GONE', 'B', 'C']); els.push(c);
    const spans = pathSegmentSpans(c, els);
    expect(new Set(spans.filter(Boolean).map((s) => s!.key))).toEqual(new Set(['A_B', 'B_C']));
  });
});

describe('distance edited from a cable tap: one undo step', () => {
  const S = () => useDrawingStore.getState();
  beforeEach(() => {
    useDrawingStore.setState({ ...useDrawingStore.getState(), elements: [pole('A', 0, 0), pole('B', 300, 0), cable('t', ['A', 'B'])], connectionDistances: { A_B: '10' }, connectionLabelOffsets: {}, history: [], redoStack: [], pendingStep: null }, true);
    historyGestureEnd();
  });
  it('edit inside the pointer-down (as the prompt does) is committed at once; undo/redo give the right values', async () => {
    historyGestureStart(1);                   // finger on the cable
    S().saveHistory(); S().updateConnectionDistance('A_B', '42'); S().saveHistory(); // handleSegmentClick
    expect(S().history).toHaveLength(1);      // already a step, even if pointer-up never arrives
    historyGestureEnd(1); await new Promise((r) => setTimeout(r, 0));
    expect(S().history).toHaveLength(1);      // no duplicate at pointer-up
    S().undo(); expect(S().connectionDistances.A_B).toBe('10');
    S().redo(); expect(S().connectionDistances.A_B).toBe('42');
  });
});
