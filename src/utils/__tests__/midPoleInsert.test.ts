import { beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import { splitSpanInCables } from '../spanModel';
import { idBetween, midPoleId, MID_POLE_REFUSED, splitPoleId } from '../splitPoleId';
import { calculateCablePath } from '../cableLayout';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import type { CableElement, DrawingElement, SymbolElement } from '../../types/drawing';

// Stage 7.11 — placing a pole on a span with parallel cables: the cables keep their
// order and spacing on both new spans, and the distance labels stay consistent.

const S = () => useDrawingStore.getState();
const initial = S();
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
const step = (fn: () => void) => { fn(); S().commitHistory(); };
const pole = (id: string, x: number, y: number): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
// cables as the drawing tool makes them: a cable that follows an existing span copies its offset (→ all 0)
const cable = (id: string, poleIds: string[], color: string, cableIndex = 0, offset = 0): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex, offset, lineStyle: 'zigzag', strokeColor: color, fillColor: 'none', strokeWidth: 2 });
const P = (id: string) => S().elements.find((e) => e.id === id) as SymbolElement;
const cableOf = (id: string) => S().elements.find((e) => e.id === id) as CableElement;
const doc = () => JSON.stringify({ e: S().elements, d: S().connectionDistances, o: S().connectionLabelOffsets, f: S().distanceFlags });
const load = (elements: DrawingElement[], connectionDistances: Record<string, string> = {}) => {
  S().loadProject({ elements, style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances, connectionLabelOffsets: {} });
  historyGestureEnd();
};

// What the canvas does when a pole is placed on span a–b at fraction t (SketchCanvas, split branch):
// the id from midPoleId, or — when it refuses — the message and no change at all.
const tryPlaceOn = (a: string, b: string, t = 0.5, rand?: () => number): { id: string } | { refused: string } => {
  const pa = P(a), pb = P(b);
  const mid = midPoleId(a, b, (x) => S().elements.some((e) => e.id === x), rand);
  if ('message' in mid) return { refused: mid.message };
  step(() => {
    S().addElement(pole(mid.id, pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t));
    S().updateElements(splitSpanInCables(S().elements, a, b, mid.id));
    S().splitConnectionDistance(a, b, mid.id);
  });
  return { id: mid.id };
};
const placeOn = (a: string, b: string, t = 0.5): string => {
  const r = tryPlaceOn(a, b, t);
  if ('refused' in r) throw new Error(`refused: ${a}–${b}`);
  return r.id;
};
// the same with a random id (the behaviour before this fix), for the regression proof
const placeOnRandomId = (a: string, b: string, id: string, t = 0.5) => {
  const pa = P(a), pb = P(b);
  step(() => {
    S().addElement(pole(id, pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t));
    S().updateElements(splitSpanInCables(S().elements, a, b, id));
    S().splitConnectionDistance(a, b, id);
  });
};

/**
 * Drawn lateral position of every cable on every span, in a fixed geometric frame
 * (from the pole nearer the top-left to the other one): the path segment that is the
 * span shifted sideways gives the exact offset. Listed left → right.
 */
type Lane = { cable: string; off: number };
const layout = (elements: DrawingElement[] = S().elements): Record<string, Lane[]> => {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out: Record<string, Lane[]> = {};
  for (const c of elements.filter((e): e is CableElement => e.type === 'cable')) {
    const path = calculateCablePath(c, elements);
    for (let i = 0; i < c.poleIds.length - 1; i++) {
      const a = byId.get(c.poleIds[i])!, z = byId.get(c.poleIds[i + 1])!;
      const [t, u] = a.y < z.y || (a.y === z.y && a.x < z.x) ? [a, z] : [z, a];
      const dx = u.x - t.x, dy = u.y - t.y, L = Math.hypot(dx, dy);
      const nx = -dy / L, ny = dx / L;
      let off: number | null = null;
      for (let k = 0; k < path.length - 1 && off === null; k++) {
        const p = path[k], q = path[k + 1];
        for (const [s, e] of [[a, z], [z, a]] as const) {
          const ox = p.x - s.x, oy = p.y - s.y;
          if (Math.hypot(q.x - e.x - ox, q.y - e.y - oy) < 1e-6 && Math.abs(ox * dx + oy * dy) < 1e-6 * L) { off = ox * nx + oy * ny; break; }
        }
      }
      if (off === null) throw new Error(`span ${a.id}-${z.id} of ${c.id} not found in its path`);
      (out[`${t.id}|${u.id}`] ??= []).push({ cable: c.id, off: Math.round(off * 1e6) / 1e6 });
    }
  }
  for (const k in out) out[k].sort((x, y) => x.off - y.off);
  return out;
};
const lanes = (pair: [string, string]) => {
  const L = layout();
  return L[`${pair[0]}|${pair[1]}`] ?? L[`${pair[1]}|${pair[0]}`];
};
/** At the pole between two consecutive spans every cable continues straight (no jump to another lane). */
const continuousAt = (poleId: string) => {
  for (const c of S().elements.filter((e): e is CableElement => e.type === 'cable')) {
    const i = c.poleIds.indexOf(poleId);
    if (i <= 0 || i >= c.poleIds.length - 1) continue;
    const before = lanes([c.poleIds[i - 1], poleId]).find((l) => l.cable === c.id)!.off;
    const after = lanes([poleId, c.poleIds[i + 1]]).find((l) => l.cable === c.id)!.off;
    expect([c.id, after]).toEqual([c.id, before]);
  }
};
const SPACING = 8;
const evenlySpaced = (ls: Lane[]) => ls.slice(1).every((l, i) => Math.abs(l.off - ls[i].off - SPACING) < 1e-9);

// Distance labels: one per pole pair of any cable (SketchCanvas renderConnectionLabels);
// value = recorded distance (≈ when estimated) or the long-standing "1" when none is recorded;
// the frame (side and rotation) is the pair's id order.
const labels = () => {
  const keys = new Set<string>();
  for (const c of S().elements.filter((e): e is CableElement => e.type === 'cable'))
    for (let i = 0; i < c.poleIds.length - 1; i++) keys.add([c.poleIds[i], c.poleIds[i + 1]].sort().join('_'));
  return [...keys].sort().map((k) => ({ key: k, text: (S().distanceFlags[k]?.estimated ? '≈' : '') + (S().connectionDistances[k] ?? '1') }));
};
/** The side of a span's label: +1 / −1 = right / left of the geometric frame (top-left → other end). */
const labelSide = (x: string, y: string) => {
  const [lo, hi] = [x, y].sort(); const a = P(lo), b = P(hi);
  const geo = a.y < b.y || (a.y === b.y && a.x < b.x);
  return geo ? 1 : -1; // label is placed to the right of lo → hi
};

const COLOURS = ['#000000', '#10B981', '#3B82F6', '#3B82F6'];
/** Vertical line T – A – B (ids chosen by the caller), n parallel cables, directions per cable. */
const line = (ids: [string, string, string], n: number, dirs: ('f' | 'r')[] = [], dist: Record<string, string> = {}) => {
  const [t, a, b] = ids;
  const els: DrawingElement[] = [pole(t, 100, 0), pole(a, 100, 200), pole(b, 100, 440)];
  for (let i = 0; i < n; i++) els.push(cable(`c${i}`, dirs[i] === 'r' ? [b, a, t] : [t, a, b], COLOURS[i % 4], i));
  load(els, dist);
};

describe('the new pole id sorts between the span poles', () => {
  it('between two ordinary ids, either order of the arguments', () => {
    const id = splitPoleId('kp9', 'kp5', () => false)!;
    expect('kp5' < id && id < 'kp9').toBe(true);
    expect(id.startsWith('kp5-')).toBe(true);
  });
  it('ids that share a prefix, and a pole placed again and again next to the same pole', () => {
    let hi = 'ab';
    for (let i = 0; i < 6; i++) { const id = idBetween('a', hi, () => false)!; expect('a' < id && id < hi).toBe(true); hi = id; }
    let lo = 'a';
    for (let i = 0; i < 6; i++) { const id = idBetween(lo, 'ab', () => false)!; expect(lo < id && id < 'ab').toBe(true); lo = id; }
  });
  it('an id that is already used is never returned', () => {
    let n = 0; const rand = () => [0.111, 0.111, 0.222][n++ % 3];
    const used = new Set([idBetween('a', 'b', () => false, () => 0.111)!]);
    const id = idBetween('a', 'b', (x) => used.has(x), rand)!;
    expect(used.has(id)).toBe(false);
  });
  it('no id between (e.g. "a" and "a-") → null, the canvas then uses a random id as before', () => {
    expect(idBetween('a', 'a-', () => false)).toBeNull();
    expect(idBetween('b', 'a', () => false)).toBeNull();
    expect(idBetween('a', 'a', () => false)).toBeNull();
  });
});

describe('1–2. parallel cables keep order and spacing on both new spans', () => {
  for (const n of [1, 3, 4]) for (const dirs of [['f', 'f', 'f', 'f'], ['f', 'r', 'f', 'r']] as ('f' | 'r')[][]) {
    it(`${n} cable(s), directions ${dirs.slice(0, n).join('')}`, () => {
      if (n === 1 && dirs[1] === 'r') return;
      line(['kp2', 'kp5', 'kp9'], n, dirs, { kp5_kp9: '20' });
      const before = lanes(['kp5', 'kp9']);
      const other = lanes(['kp2', 'kp5']);
      const M = placeOn('kp5', 'kp9');
      expect(lanes(['kp5', M])).toEqual(before);
      expect(lanes([M, 'kp9'])).toEqual(before);
      expect(lanes(['kp2', 'kp5'])).toEqual(other); // span not involved: unchanged
      expect(evenlySpaced(lanes([M, 'kp9']))).toBe(true);
      continuousAt(M); continuousAt('kp5');
    });
  }
  it('regression proof: with a random id sorting below kp9, the far half used to be mirrored', () => {
    line(['kp2', 'kp5', 'kp9'], 4, [], { kp5_kp9: '20' });
    const before = lanes(['kp5', 'kp9']);
    placeOnRandomId('kp5', 'kp9', 'vd7o7axlx'); // the id from the reproduction (> kp9)
    expect(lanes(['vd7o7axlx', 'kp9']).map((l) => l.cable)).toEqual([...before].reverse().map((l) => l.cable));
  });
  it('route drawn against the id order (ids decrease along the line)', () => {
    line(['zz', 'mm', 'aa'], 4, ['f', 'r', 'f', 'f']);
    const before = lanes(['mm', 'aa']);
    const M = placeOn('mm', 'aa');
    expect(lanes(['mm', M])).toEqual(before);
    expect(lanes([M, 'aa'])).toEqual(before);
    continuousAt(M);
  });
  it('a branch at the far pole and a horizontal span: only the split span changes, into two identical copies', () => {
    load([pole('p1', 0, 0), pole('p2', 300, 0), pole('p3', 600, 0), pole('p4', 300, 300),
      cable('a', ['p1', 'p2', 'p3'], '#000', 0), cable('b', ['p1', 'p2', 'p3'], '#0f0', 1), cable('c', ['p3', 'p2', 'p1'], '#00f', 2),
      cable('br', ['p2', 'p4'], '#f00', 3), cable('br2', ['p4', 'p2'], '#f0f', 4)]);
    const all = layout();
    const M = placeOn('p1', 'p2', 0.3);
    const after = layout();
    expect(after[`p1|${M}`]).toEqual(all['p1|p2']);
    expect(after[`${M}|p2`]).toEqual(all['p1|p2']);
    for (const k of Object.keys(all).filter((k) => k !== 'p1|p2')) expect([k, after[k]]).toEqual([k, all[k]]);
  });
});

describe('3–4. very short span; pole near either end and in the middle', () => {
  for (const t of [0.08, 0.5, 0.92]) it(`4 cables on a 30-unit span, pole at ${t}`, () => {
    load([pole('kq1', 0, 0), pole('kq7', 0, 30), pole('kq3', 0, 250), ...[0, 1, 2, 3].map((i) => cable(`c${i}`, i % 2 ? ['kq3', 'kq7', 'kq1'] : ['kq1', 'kq7', 'kq3'], COLOURS[i], i))]);
    const before = lanes(['kq1', 'kq7']);
    const M = placeOn('kq1', 'kq7', t);
    expect(lanes(['kq1', M])).toEqual(before);
    expect(lanes([M, 'kq7'])).toEqual(before);
    expect(evenlySpaced(lanes(['kq1', M]))).toBe(true);
    continuousAt(M);
  });
});

describe('5. two poles one after the other', () => {
  it('second pole on one half, third on the other half: every span the same, ids in order', () => {
    line(['kp2', 'kp5', 'kp9'], 4, ['f', 'r', 'f', 'r'], { kp5_kp9: '20' });
    const before = lanes(['kp5', 'kp9']);
    const M1 = placeOn('kp5', 'kp9');
    const M2 = placeOn(M1, 'kp9', 0.5);
    const M3 = placeOn('kp5', M1, 0.5);
    expect(cableOf('c0').poleIds).toEqual(['kp2', 'kp5', M3, M1, M2, 'kp9']);
    expect(cableOf('c1').poleIds).toEqual(['kp9', M2, M1, M3, 'kp5', 'kp2']);
    expect(['kp5' < M3, M3 < M1, M1 < M2, M2 < 'kp9']).toEqual([true, true, true, true]);
    for (const pair of [['kp5', M3], [M3, M1], [M1, M2], [M2, 'kp9']] as [string, string][]) expect(lanes(pair)).toEqual(before);
    for (const m of [M1, M2, M3]) continuousAt(m);
  });
});

describe('8. distance labels after placing and deleting poles', () => {
  it('splitting 20: the old label goes, each new span gets ≈10, same side as the original label', () => {
    line(['kp2', 'kp5', 'kp9'], 4, ['f', 'r', 'f', 'r'], { kp5_kp9: '20' });
    const side = labelSide('kp5', 'kp9');
    const M = placeOn('kp5', 'kp9');
    expect(labels()).toEqual([{ key: 'kp2_kp5', text: '1' }, { key: [M, 'kp9'].sort().join('_'), text: '≈10' }, { key: ['kp5', M].sort().join('_'), text: '≈10' }].sort((x, y) => (x.key < y.key ? -1 : 1)));
    expect(labelSide('kp5', M)).toBe(side);
    expect(labelSide(M, 'kp9')).toBe(side);
    expect(S().connectionDistances.kp5_kp9).toBeUndefined();
  });
  it('regression proof: with a random id one label flipped to the other side', () => {
    line(['kp2', 'kp5', 'kp9'], 2, [], { kp5_kp9: '20' });
    const side = labelSide('kp5', 'kp9');
    placeOnRandomId('kp5', 'kp9', 'vd7o7axlx');
    expect(labelSide('vd7o7axlx', 'kp9')).toBe(-side);
  });
  it('a span with no recorded distance: both new spans have none either (no value invented)', () => {
    line(['kp2', 'kp5', 'kp9'], 2);
    const M = placeOn('kp2', 'kp5');
    expect(labels().map((l) => l.text)).toEqual(['1', '1', '1']);
    expect(Object.keys(S().connectionDistances)).toEqual([]);
    expect(labelSide('kp2', M)).toBe(labelSide(M, 'kp5'));
  });
});

describe('6. deleting the pole again', () => {
  it('both parts untouched: the original 20 comes back, one label, original layout', () => {
    line(['kp2', 'kp5', 'kp9'], 4, ['f', 'r', 'f', 'r'], { kp5_kp9: '20' });
    const before = layout(); const d0 = { ...S().connectionDistances };
    const M = placeOn('kp5', 'kp9');
    step(() => { S().deleteElement(M); });
    expect(layout()).toEqual(before);
    expect(S().connectionDistances).toEqual(d0);
    expect(labels()).toEqual([{ key: 'kp2_kp5', text: '1' }, { key: 'kp5_kp9', text: '20' }]);
  });
  it('after measuring one part (8): the merged span shows 8 + 10 = 18, estimated (one part was), never the old 20', () => {
    line(['kp2', 'kp5', 'kp9'], 4, [], { kp5_kp9: '20' });
    const before = layout();
    const M = placeOn('kp5', 'kp9');
    step(() => S().updateConnectionDistance(['kp5', M].sort().join('_'), '8'));
    step(() => { S().deleteElement(M); });
    expect(layout()).toEqual(before);
    expect(labels()).toEqual([{ key: 'kp2_kp5', text: '1' }, { key: 'kp5_kp9', text: '≈18' }]);
  });
  it('after measuring both parts (8 and 13): 21, measured', () => {
    line(['kp2', 'kp5', 'kp9'], 3, [], { kp5_kp9: '20' });
    const M = placeOn('kp5', 'kp9');
    step(() => S().updateConnectionDistance(['kp5', M].sort().join('_'), '8'));
    step(() => S().updateConnectionDistance([M, 'kp9'].sort().join('_'), '13'));
    step(() => { S().deleteElement(M); });
    expect(labels()).toEqual([{ key: 'kp2_kp5', text: '1' }, { key: 'kp5_kp9', text: '21' }]);
  });
});

describe('saving and export keep the new pole ids, layout and labels', () => {
  it('export → import → autosave draft: identical drawing; deleting the poles afterwards still restores 20', () => {
    line(['kp2', 'kp5', 'kp9'], 4, ['f', 'r', 'f', 'r'], { kp5_kp9: '20' });
    const L0 = layout();
    const M1 = placeOn('kp5', 'kp9'); const M2 = placeOn(M1, 'kp9', 0.8);
    const st = S(); const d1 = doc(); const L1 = layout(); const lb1 = labels();
    const j = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    expect(JSON.parse(j).version).toBe(1);
    const p = parseProjectFile(j);
    if (!p.ok) throw new Error('rejected');
    S().loadProject(p.data as Parameters<typeof initial.loadProject>[0]);
    expect(doc()).toBe(d1); expect(layout()).toEqual(L1); expect(labels()).toEqual(lb1);
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    if (!v.ok) throw new Error('draft rejected');
    S().loadProject(v.draft.data); historyGestureEnd();
    expect(doc()).toBe(d1);
    step(() => { S().deleteElement(M2); }); step(() => { S().deleteElement(M1); });
    expect(layout()).toEqual(L0);
    expect(S().connectionDistances).toEqual({ kp5_kp9: '20' });
  });
});

describe('7. undo / redo', () => {
  it('place → undo → redo, delete → undo → redo: drawing, layout and labels exactly restored each time', () => {
    line(['kp2', 'kp5', 'kp9'], 4, ['f', 'r', 'f', 'r'], { kp5_kp9: '20' });
    const d0 = doc(); const L0 = layout(); const lb0 = labels();
    const M = placeOn('kp5', 'kp9');
    const d1 = doc(); const L1 = layout(); const lb1 = labels();
    S().undo(); expect(doc()).toBe(d0); expect(layout()).toEqual(L0); expect(labels()).toEqual(lb0);
    S().redo(); expect(doc()).toBe(d1); expect(layout()).toEqual(L1); expect(labels()).toEqual(lb1);
    step(() => { S().deleteElement(M); });
    const d2 = doc();
    expect(layout()).toEqual(L0); expect(labels()).toEqual(lb0);
    S().undo(); expect(doc()).toBe(d1); expect(layout()).toEqual(L1); expect(labels()).toEqual(lb1);
    S().redo(); expect(doc()).toBe(d2); expect(layout()).toEqual(L0);
  });
});

describe('delete the mid pole, then place it again', () => {
  // a line with mixed directions and a branch at kp5, so that other spans can be watched
  const net = () => load([pole('kp2', 100, 0), pole('kp5', 100, 200), pole('kp9', 100, 440), pole('kq1', 340, 200),
    cable('c0', ['kp2', 'kp5', 'kp9'], COLOURS[0], 0), cable('c1', ['kp9', 'kp5', 'kp2'], COLOURS[1], 1), cable('c2', ['kp2', 'kp5', 'kp9'], COLOURS[2], 2), cable('c3', ['kp9', 'kp5', 'kp2'], COLOURS[3], 3),
    cable('br', ['kp5', 'kq1'], '#f00', 4), cable('br2', ['kq1', 'kp5'], '#f0f', 5)], { kp2_kp5: '35', kp5_kp9: '20', kp5_kq1: '12' });
  const others = (L: Record<string, Lane[]>) => Object.fromEntries(Object.entries(L).filter(([k]) => k !== 'kp5|kp9' && !k.split('|').some((p) => p !== 'kp5' && p !== 'kp9' && p !== 'kp2' && p !== 'kq1')));
  it('geometry, order, spacing, distances, labels and the other spans come back; placing again gives the same as the first time', () => {
    net();
    const L0 = layout(); const lb0 = labels(); const dist0 = { ...S().connectionDistances };
    const M = placeOn('kp5', 'kp9');
    const L1 = layout(); const lb1 = labels();
    step(() => { S().deleteElement(M); });
    expect(layout()).toEqual(L0);
    expect(labels()).toEqual(lb0);
    expect(S().connectionDistances).toEqual(dist0);
    expect(S().distanceFlags).toEqual({});
    expect(S().elements.some((e) => e.id === M)).toBe(false);
    const M2 = placeOn('kp5', 'kp9');
    const L2 = layout();
    expect(lanes(['kp5', M2])).toEqual(L0['kp5|kp9']);
    expect(lanes([M2, 'kp9'])).toEqual(L0['kp5|kp9']);
    expect(evenlySpaced(lanes([M2, 'kp9']))).toBe(true);
    continuousAt(M2);
    expect(others(L2)).toEqual(others(L0)); // kp2–kp5 and the branch kp5–kq1 untouched throughout
    expect(others(L1)).toEqual(others(L0));
    // the labels are those of the first placement, with the new pole's keys
    expect(labels().map((l) => l.text)).toEqual(lb1.map((l) => l.text));
    expect([labelSide('kp5', M2), labelSide(M2, 'kp9')]).toEqual([labelSide('kp5', 'kp9'), labelSide('kp5', 'kp9')]);
    expect(S().connectionDistances).toEqual({ kp2_kp5: '35', kp5_kq1: '12', [['kp5', M2].sort().join('_')]: '10', [[M2, 'kp9'].sort().join('_')]: '10' });
  });
  it('a part measured before the delete: the merged 8 + 10 = ≈18 is what the new halves split (≈9 + ≈9), never the old 20', () => {
    net();
    const M = placeOn('kp5', 'kp9');
    step(() => S().updateConnectionDistance(['kp5', M].sort().join('_'), '8'));
    step(() => { S().deleteElement(M); });
    expect(S().connectionDistances.kp5_kp9).toBe('18');
    expect(S().distanceFlags.kp5_kp9).toEqual({ estimated: true });
    const M2 = placeOn('kp5', 'kp9');
    const k1 = ['kp5', M2].sort().join('_'), k2 = [M2, 'kp9'].sort().join('_');
    expect([S().connectionDistances[k1], S().connectionDistances[k2]]).toEqual(['9', '9']);
    expect(labels().filter((l) => l.key === k1 || l.key === k2).map((l) => l.text)).toEqual(['≈9', '≈9']);
    expect(Object.values(S().connectionDistances)).not.toContain('20');
  });
  it('undo / redo across place → delete → place again: every state exactly restored', () => {
    net();
    const d0 = doc(); const L0 = layout();
    const M = placeOn('kp5', 'kp9'); const d1 = doc(); const L1 = layout();
    step(() => { S().deleteElement(M); }); const d2 = doc();
    const M2 = placeOn('kp5', 'kp9'); const d3 = doc(); const L3 = layout();
    S().undo(); expect(doc()).toBe(d2); expect(layout()).toEqual(L0);
    S().undo(); expect(doc()).toBe(d1); expect(layout()).toEqual(L1);
    S().undo(); expect(doc()).toBe(d0); expect(layout()).toEqual(L0);
    S().redo(); expect(doc()).toBe(d1);
    S().redo(); expect(doc()).toBe(d2);
    S().redo(); expect(doc()).toBe(d3); expect(layout()).toEqual(L3);
    expect(S().elements.some((e) => e.id === M2)).toBe(true);
  });
});

describe('when no id between can be made: the placement is refused, nothing changes', () => {
  it('the cases without an id between, and every candidate already used', () => {
    for (const [a, b] of [['a', 'a-'], ['a', 'a--'], ['a', 'a b'], ['a', 'a!x'], ['a', 'a,'], ['a', 'a']]) {
      expect([a, b, midPoleId(a, b, () => false)]).toEqual([a, b, { ok: false, message: MID_POLE_REFUSED }]);
      expect(midPoleId(b, a, () => false).ok).toBe(false);
    }
    expect(midPoleId('kp5', 'kp9', () => true)).toEqual({ ok: false, message: MID_POLE_REFUSED });
  });
  it('collisions: candidates already used are skipped; the one returned is free and between', () => {
    const seq = [0.25, 0.25, 0.25, 0.5]; let i = 0; const rand = () => seq[Math.min(i++, seq.length - 1)];
    const first = idBetween('kp5', 'kp9', () => false, () => 0.25)!;
    const used = new Set(['kp5', 'kp9', first]);
    const r = midPoleId('kp5', 'kp9', (x) => used.has(x), rand);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(used.has(r.id)).toBe(false); expect('kp5' < r.id && r.id < 'kp9').toBe(true); }
    expect(i).toBe(4); // three collisions, fourth try taken
  });
  it('a refused placement leaves the drawing, distances, labels and undo history exactly as they were', () => {
    load([pole('a', 0, 0), pole('a-', 0, 300), cable('c0', ['a', 'a-'], '#000', 0), cable('c1', ['a-', 'a'], '#0f0', 1)], { 'a_a-': '20' });
    S().commitHistory();
    const d0 = doc(); const h0 = S().history.length; const L0 = layout(); const n0 = S().elements.length;
    const r = tryPlaceOn('a', 'a-');
    expect(r).toEqual({ refused: MID_POLE_REFUSED });
    expect(doc()).toBe(d0); expect(S().history.length).toBe(h0); expect(layout()).toEqual(L0); expect(S().elements.length).toBe(n0);
    expect(labels()).toEqual([{ key: 'a_a-', text: '20' }]);
  });
});

describe('imported project with unusual pole ids', () => {
  const LONG = 'p'.repeat(300);
  const file = () => JSON.stringify({ version: 1, style: { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle',
    elements: [pole('a', 0, 0), pole('a-', 0, 300), pole('a b', 200, 0), pole('pole 1', 400, 0), pole('عمود٣', 400, 300), pole('x_y', 600, 0), pole(LONG, 600, 300), pole('Z9', 800, 0), pole('z9', 800, 300),
      cable('c1', ['a', 'a-'], '#000', 0), cable('c1b', ['a-', 'a'], '#0f0', 1), cable('c2', ['a', 'a b'], '#00f', 2), cable('c3', ['pole 1', 'عمود٣'], '#000', 3), cable('c3b', ['عمود٣', 'pole 1'], '#0f0', 4),
      cable('c4', ['x_y', LONG], '#000', 5), cable('c4b', [LONG, 'x_y'], '#0f0', 6), cable('c5', ['Z9', 'z9'], '#000', 7), cable('c5b', ['z9', 'Z9'], '#0f0', 8)],
    connectionDistances: { 'a_a-': '20', 'pole 1_عمود٣': '30' }, connectionLabelOffsets: {} });
  const open = () => { const p = parseProjectFile(file()); if (!p.ok) throw new Error(`rejected: ${JSON.stringify(p)}`); S().loadProject(p.data as Parameters<typeof initial.loadProject>[0]); historyGestureEnd(); };
  it('the file opens with every id as it is', () => {
    open();
    expect(S().elements.filter((e) => e.type === 'symbol').map((e) => e.id)).toEqual(['a', 'a-', 'a b', 'pole 1', 'عمود٣', 'x_y', LONG, 'Z9', 'z9']);
  });
  it('spans whose ids allow it get a pole with the same layout; the others are refused without any change', () => {
    open();
    for (const [x, y] of [['pole 1', 'عمود٣'], ['x_y', LONG], ['Z9', 'z9']] as [string, string][]) {
      const before = lanes([x, y]);
      const r = tryPlaceOn(x, y);
      expect('id' in r).toBe(true);
      if ('id' in r) { expect(lanes([x, r.id])).toEqual(before); expect(lanes([r.id, y])).toEqual(before); expect(r.id.includes('_') && !x.includes('_')).toBe(false); }
    }
    expect(S().connectionDistances['pole 1_عمود٣']).toBeUndefined();
    for (const [x, y] of [['a', 'a-'], ['a', 'a b']] as [string, string][]) {
      const d0 = doc(); const h0 = S().history.length;
      expect(tryPlaceOn(x, y)).toEqual({ refused: MID_POLE_REFUSED });
      expect(doc()).toBe(d0); expect(S().history.length).toBe(h0);
    }
    expect(S().connectionDistances['a_a-']).toBe('20');
  });
});
