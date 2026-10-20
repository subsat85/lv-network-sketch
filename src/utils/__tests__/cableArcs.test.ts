import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import { arcGeometry, arcPick, ArcPickState, createArc, endPosition, isArcValid, listConnectionPoints, resolveEnd } from '../cableArcs';
import { calculateCablePath } from '../cableLayout';
import { pathSegmentSpans } from '../cableSegments';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { initAutosave, DraftStorage } from '../autosave';
import type { CableArcElement, CableArcEnd, CableElement, DrawingElement, SymbolElement } from '../../types/drawing';
// Stage 7: loading / importing gives every cable span ids (fixtures here are put
// into the store directly, without them), so compare without that field.
const noSpanIds = <T,>(els: T[]): T[] => els.map((e) => { const { spanIds: _s, ...rest } = e as { spanIds?: unknown }; return rest as T; });

// ---- fixtures -------------------------------------------------------------------------
const R = 20; // pole radius used by the canvas at scale 1
const pole = (id: string, x: number, y: number): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000000', fillColor: '#FFFFFF', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color: string): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: color, fillColor: 'transparent', strokeWidth: 2 });
const end = (cableId: string, side: 'prev' | 'next', occurrence = 0): CableArcEnd => ({ cableId, side, occurrence });
const k = (p: CableArcEnd) => `${p.cableId}:${p.side}:${p.occurrence}`;

// Pole P with: trunk t A→P→B, a parallel trunk t2 A→P→B, branch br P→C (ends at P),
// incoming cable in D→P (ends at P).
const network = (): DrawingElement[] => [
  pole('A', 100, 300), pole('P', 300, 300), pole('B', 500, 300), pole('C', 300, 100), pole('D', 300, 500),
  cable('t', ['A', 'P', 'B'], '#FF0000'), cable('t2', ['A', 'P', 'B'], '#0000FF'),
  cable('br', ['P', 'C'], '#00AA00'), cable('in', ['D', 'P'], '#AA00AA'),
];
const S = () => useDrawingStore.getState();
const load = (els: DrawingElement[]) => {
  useDrawingStore.setState({ ...useDrawingStore.getState(), elements: els, history: [], redoStack: [], pendingStep: null, connectionDistances: {}, connectionLabelOffsets: {} }, true);
};
const arcsOf = (els: DrawingElement[]) => els.filter((e): e is CableArcElement => e.type === 'cable_arc');
const mk = (els: DrawingElement[], a: CableArcEnd, b: CableArcEnd, id = 'arc1') => {
  const r = createArc(els, 'P', a, b, id);
  if (!r.ok) throw new Error((r as { reason: string }).reason);
  return r.arc;
};
const add = (a: CableArcEnd, b: CableArcEnd, id = 'arc1') => { S().addElement(mk(S().elements, a, b, id)); S().commitHistory(); return id; };
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

beforeEach(() => { historyGestureEnd(); load(network()); });

// ---- 1 ---------------------------------------------------------------------------------
describe('connection points of a pole', () => {
  it('1. every incoming, outgoing, branch and parallel cable side is listed and numbered 1..n', () => {
    const pts = listConnectionPoints(S().elements, 'P', R);
    expect(pts.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(pts.map((p) => k(p.end)))).toEqual(new Set(['t:prev:0', 't:next:0', 't2:prev:0', 't2:next:0', 'br:next:0', 'in:prev:0']));
    for (const p of pts) {
      expect(Math.abs(dist(p.position, { x: 300, y: 300 }) - R)).toBeLessThan(0.01); // on the pole circle
      expect(resolveEnd(S().elements, 'P', p.end)).not.toBeNull();
    }
    // numbering is clockwise from north: br (north, to C) is 1, then east (t/t2 next), south (in), west (t/t2 prev)
    expect(pts[0].end).toEqual(end('br', 'next'));
    expect(pts.find((p) => p.end.cableId === 'in')!.number).toBe(4);
    // towardId tells the neighbour on that side
    expect(pts.find((p) => k(p.end) === 't:prev:0')!.towardId).toBe('A');
  });
  it('a pole visited twice by one cable gets separate points per visit', () => {
    load([pole('A', 0, 0), pole('P', 200, 0), pole('B', 200, 200), cable('loop', ['A', 'P', 'B', 'P'], '#000')]);
    expect(new Set(listConnectionPoints(S().elements, 'P', R).map((p) => k(p.end)))).toEqual(new Set(['loop:prev:0', 'loop:next:0', 'loop:prev:1']));
  });
  it('a pole with no cables has no points', () => {
    load([pole('P', 0, 0)]);
    expect(listConnectionPoints(S().elements, 'P', R)).toEqual([]);
  });
});

// ---- 2–7 ------------------------------------------------------------------------------
describe('creating arcs', () => {
  const pick = (st: ArcPickState, e: CableArcEnd) => arcPick(st, { type: 'pick', end: e });
  it('2. first point, then second point → one arc between exactly those two', () => {
    let r = arcPick(null, { type: 'start', poleId: 'P' });
    r = pick(r.state, end('t', 'prev'));
    expect(r.create).toBeUndefined();
    expect(r.state?.first).toEqual(end('t', 'prev'));
    r = pick(r.state, end('br', 'next'));
    expect(r.create).toEqual({ from: end('t', 'prev'), to: end('br', 'next') });
    expect(r.state).toEqual({ poleId: 'P', first: null }); // ready for the next arc
    const arc = mk(S().elements, r.create!.from, r.create!.to);
    expect(arc).toMatchObject({ type: 'cable_arc', poleId: 'P', from: end('t', 'prev'), to: end('br', 'next') });
    expect(isArcValid(S().elements, arc)).toBe(true);
  });
  it('3. two points on the same side (parallel cables both towards A)', () => {
    expect(isArcValid(S().elements, mk(S().elements, end('t', 'prev'), end('t2', 'prev')))).toBe(true);
  });
  it('4. two points on opposite sides (one cable passing through)', () => {
    const arc = mk(S().elements, end('t', 'prev'), end('t', 'next'));
    const g = arcGeometry(S().elements, arc, R)!;
    expect(g.a.x).toBeLessThan(300); expect(g.b.x).toBeGreaterThan(300);
    // goes round the pole instead of through it
    expect(dist(g.apex, { x: 300, y: 300 })).toBeGreaterThan(R);
  });
  it('5. two different cables (incoming end and branch)', () => {
    expect(isArcValid(S().elements, mk(S().elements, end('in', 'prev'), end('br', 'next')))).toBe(true);
  });
  it('6. several arcs on the same pole stay separate', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    add(end('t', 'next'), end('br', 'next'), 'a2');
    add(end('in', 'prev'), end('t2', 'next'), 'a3');
    const arcs = arcsOf(S().elements);
    expect(arcs).toHaveLength(3);
    const geos = arcs.map((a) => arcGeometry(S().elements, a, R)!);
    expect(new Set(geos.map((g) => g.d)).size).toBe(3);
    // two arcs sharing the br point bulge differently
    expect(dist(geos[0].apex, geos[1].apex)).toBeGreaterThan(1);
    // two arcs in (almost) the same direction — parallel cables to the same branch — are pushed apart
    add(end('t2', 'prev'), end('br', 'next'), 'a4');
    const g1 = arcGeometry(S().elements, arcsOf(S().elements).find((a) => a.id === 'a1')!, R)!;
    const g4 = arcGeometry(S().elements, arcsOf(S().elements).find((a) => a.id === 'a4')!, R)!;
    expect(dist(g1.apex, g4.apex)).toBeGreaterThan(R * 0.5);
    expect(createArc(S().elements, 'P', end('br', 'next'), end('t', 'prev'), 'dup')).toEqual({ ok: false, reason: 'duplicate' });
  });
  it('7. parallel cables have distinct, separately addressable points', () => {
    const pts = listConnectionPoints(S().elements, 'P', R);
    const a = pts.find((p) => k(p.end) === 't:prev:0')!, b = pts.find((p) => k(p.end) === 't2:prev:0')!;
    expect(dist(a.position, b.position)).toBeGreaterThan(3);
    expect(a.number).not.toBe(b.number);
    // each point follows its own cable's drawn run
    const arc = mk(S().elements, a.end, b.end);
    const g = arcGeometry(S().elements, arc, R)!;
    expect(dist(g.a, a.position)).toBeLessThan(1e-6);
    expect(dist(g.b, b.position)).toBeLessThan(1e-6);
  });
});

// ---- 8, 9 ------------------------------------------------------------------------------
describe('invalid picks and cancelling', () => {
  it('8. a point cannot be linked to itself', () => {
    expect(createArc(S().elements, 'P', end('t', 'prev'), end('t', 'prev'), 'x')).toEqual({ ok: false, reason: 'same-point' });
    let r = arcPick({ poleId: 'P', first: null }, { type: 'pick', end: end('t', 'prev') });
    r = arcPick(r.state, { type: 'pick', end: end('t', 'prev') }); // tapping the first point again
    expect(r.create).toBeUndefined();
    expect(r.state).toEqual({ poleId: 'P', first: null });
  });
  it('9. cancelling or switching pole leaves no half-made arc', () => {
    let r = arcPick(null, { type: 'start', poleId: 'P' });
    r = arcPick(r.state, { type: 'pick', end: end('t', 'prev') });
    expect(arcPick(r.state, { type: 'cancel' })).toEqual({ state: null });
    expect(arcPick(r.state, { type: 'start', poleId: 'B' })).toEqual({ state: { poleId: 'B', first: null } });
    expect(arcPick(null, { type: 'pick', end: end('t', 'prev') })).toEqual({ state: null });
    expect(arcsOf(S().elements)).toHaveLength(0);
  });
  it('ends that do not exist are refused', () => {
    expect(createArc(S().elements, 'P', end('br', 'prev'), end('t', 'prev'), 'x')).toEqual({ ok: false, reason: 'invalid' }); // br starts at P: no prev side
    expect(createArc(S().elements, 'P', end('nope', 'next'), end('t', 'prev'), 'x')).toEqual({ ok: false, reason: 'invalid' });
    expect(createArc(S().elements, 'P', end('t', 'next', 1), end('t', 'prev'), 'x')).toEqual({ ok: false, reason: 'invalid' });
  });
});

// ---- 10, 11 ----------------------------------------------------------------------------
describe('colour', () => {
  it('10. defaults to the first point\'s cable colour', () => {
    expect(mk(S().elements, end('br', 'next'), end('t', 'prev')).strokeColor).toBe('#00AA00');
    expect(mk(S().elements, end('t', 'prev'), end('br', 'next')).strokeColor).toBe('#FF0000');
  });
  it('11. arc colour and cable colour are independent after creation', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    S().updateElement('a1', { strokeColor: '#123456' }); S().commitHistory(); // what the style panel does
    expect(S().elements.find((e) => e.id === 't')!.strokeColor).toBe('#FF0000');
    S().updateElement('t', { strokeColor: '#ABCDEF' }); S().commitHistory();
    expect(S().elements.find((e) => e.id === 'a1')!.strokeColor).toBe('#123456');
  });
});

// ---- 12 --------------------------------------------------------------------------------
describe('arcs follow their connection points', () => {
  it('12a. moving the pole moves the arc ends with it', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    const before = arcGeometry(S().elements, arcsOf(S().elements)[0], R)!;
    S().updateElement('P', { x: 350, y: 280 }); S().commitHistory();
    const arc = arcsOf(S().elements)[0];
    const after = arcGeometry(S().elements, arc, R)!;
    expect(dist(after.a, before.a)).toBeGreaterThan(10);
    expect(after.a).toEqual(endPosition(S().elements, 'P', end('t', 'prev'), R));
    expect(Math.abs(dist(after.a, { x: 350, y: 280 }) - R)).toBeLessThan(0.01);
  });
  it('12b. re-layout (another cable added on the same span) keeps the arc on its own cable', () => {
    add(end('t2', 'prev'), end('br', 'next'), 'a1');
    const before = endPosition(S().elements, 'P', end('t2', 'prev'), R)!;
    S().addElement(cable('t3', ['A', 'P'], '#999999')); S().commitHistory(); // offsets on A–P change
    const arc = arcsOf(S().elements)[0];
    expect(arc.from).toEqual(end('t2', 'prev'));
    const g = arcGeometry(S().elements, arc, R)!;
    const now = endPosition(S().elements, 'P', end('t2', 'prev'), R)!;
    expect(g.a).toEqual(now);
    expect(dist(now, before)).toBeGreaterThan(0.5); // its cable moved, the end moved with it
    // and it is not the point of the new or the other cable
    expect(dist(now, endPosition(S().elements, 'P', end('t3', 'prev'), R)!)).toBeGreaterThan(1);
  });
  it('12c. inserting a pole into the span keeps the arc on the same cable side', () => {
    add(end('t', 'next'), end('br', 'next'), 'a1');
    S().addElement(pole('M', 400, 300));
    S().updateElement('t', { poleIds: ['A', 'P', 'M', 'B'] }); S().commitHistory();
    const arc = arcsOf(S().elements)[0];
    expect(arc).toBeDefined();
    expect(resolveEnd(S().elements, 'P', arc.from)!.towardId).toBe('M');
  });
});

// ---- 13 --------------------------------------------------------------------------------
describe('deleting what an arc depends on', () => {
  const noBroken = () => arcsOf(S().elements).every((a) => isArcValid(S().elements, a));
  it('13a. deleting the arc\'s pole removes its arcs; undo brings everything back', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    const before = JSON.stringify(S().elements);
    S().deleteElement('P'); S().commitHistory();
    expect(arcsOf(S().elements)).toHaveLength(0);
    S().undo();
    expect(JSON.stringify(S().elements)).toBe(before);
  });
  it('13b. deleting a cable removes only the arcs that used it', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    add(end('t2', 'prev'), end('in', 'prev'), 'a2');
    S().deleteElement('br'); S().commitHistory();
    expect(arcsOf(S().elements).map((a) => a.id)).toEqual(['a2']);
    expect(noBroken()).toBe(true);
  });
  it('13c. deleting the end pole of a side removes arcs on that side (no re-linking to the nearest point)', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');  // t towards A
    add(end('t', 'next'), end('in', 'prev'), 'a2');  // t towards B
    S().deleteElement('A'); S().commitHistory();     // t is now P–B: its prev side at P is gone
    expect(arcsOf(S().elements).map((a) => a.id)).toEqual(['a2']);
    expect(noBroken()).toBe(true);
  });
  it('13d. deleting an interior pole: the cable continues on the same side, so the arc stays', () => {
    load([pole('E', 0, 300), pole('F', 150, 300), pole('P', 300, 300), pole('C', 300, 100), cable('long', ['E', 'F', 'P'], '#FF0000'), cable('br', ['P', 'C'], '#00AA00')]);
    add(end('long', 'prev'), end('br', 'next'), 'a1');
    S().deleteElement('F'); S().commitHistory();
    const arc = arcsOf(S().elements)[0];
    expect(arc).toBeDefined();
    expect(resolveEnd(S().elements, 'P', arc.from)!.towardId).toBe('E');
  });
  it('deleting the arc itself (toolbar delete) removes only the arc', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    const others = S().elements.filter((e) => e.id !== 'a1');
    S().deleteElement('a1'); S().commitHistory();
    expect(S().elements).toEqual(others);
  });
});

// ---- 14–16 -----------------------------------------------------------------------------
describe('saving, restoring, importing', () => {
  it('14. autosave draft → reload restores arcs with their ends and colour', async () => {
    vi.useFakeTimers();
    const data = new Map<string, unknown>();
    const storage: DraftStorage = { get: async (key) => structuredClone(data.get(key)) as never, set: async (key, v) => { data.set(key, structuredClone(v)); }, del: async (key) => { data.delete(key); } };
    const guard = { v: null as string | null, get() { return this.v; }, set(x: string) { this.v = x; }, clear() { this.v = null; } };
    const h = await initAutosave({ storage, guard, rendered: async () => true, lifecycle: null, debounceMs: 50 });
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    S().updateElement('a1', { strokeColor: '#123456' });
    await vi.advanceTimersByTimeAsync(100); await h.idle(); h.stop();
    const saved = JSON.stringify(noSpanIds(S().elements));
    load([]);
    const h2 = await initAutosave({ storage, guard, rendered: async () => true, lifecycle: null }); h2.stop();
    vi.useRealTimers();
    expect(JSON.stringify(noSpanIds(S().elements))).toBe(saved);
    expect(arcsOf(S().elements)[0]).toMatchObject({ from: end('t', 'prev'), to: end('br', 'next'), strokeColor: '#123456' });
  });
  it('15. export → import keeps arcs; files with broken or malformed arcs are refused', () => {
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    const s = S();
    const json = serializeProject(s.elements, s.style, s.poleSizeScale, s.consumerVariant, s.connectionDistances, s.connectionLabelOffsets, null, 'Arcs', 1, 1);
    const r = parseProjectFile(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(arcsOf(r.data.elements)).toEqual(arcsOf(s.elements));
    const file = JSON.parse(json);
    const variant = (fn: (a: Record<string, unknown>) => void) => { const f = structuredClone(file); fn(f.elements.find((e: { type: string }) => e.type === 'cable_arc')); return parseProjectFile(JSON.stringify(f)); };
    expect(variant((a) => { (a.from as Record<string, unknown>).cableId = 'ghost'; }).ok).toBe(false);   // cable gone
    expect(variant((a) => { (a.to as Record<string, unknown>).side = 'prev'; }).ok).toBe(false);         // br has no prev side at P
    expect(variant((a) => { a.poleId = 'B'; }).ok).toBe(false);                                         // t prev exists at B, but br does not touch B
    expect(variant((a) => { delete a.to; }).ok).toBe(false);                                            // malformed
    expect(variant((a) => { (a.from as Record<string, unknown>).occurrence = 1.5; }).ok).toBe(false);
    const bad = variant((a) => { (a.from as Record<string, unknown>).cableId = 'ghost'; });
    if (!bad.ok) expect((bad as { errors: string[] }).errors.join(' ')).toContain('a1');
  });
  it('16. projects without arcs open exactly as before', () => {
    const old = { elements: network(), style: { strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 }, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: { A_P: '10' } };
    const r = parseProjectFile(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (r.ok) {
      S().loadProject(r.data);
      expect(noSpanIds(S().elements)).toEqual(network());
      expect(S().connectionDistances).toEqual({ A_P: '10' });
    }
  });
  it('loading a draft/project with a stale arc drops just that arc (never guesses an end)', () => {
    const els = [...network(), { ...mk(network(), end('t', 'prev'), end('br', 'next'), 'ok') }, { id: 'stale', type: 'cable_arc', poleId: 'P', from: end('gone', 'prev'), to: end('br', 'next'), x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 } as CableArcElement];
    S().loadProject({ elements: els, style: S().style, poleSizeScale: 1, consumerVariant: 'circle' });
    expect(arcsOf(S().elements).map((a) => a.id)).toEqual(['ok']);
  });
});

// ---- 17, 18 ----------------------------------------------------------------------------
describe('arcs do not change cables', () => {
  it('17/18. cable paths, span lookup and distances are identical with and without arcs', () => {
    const plain = network();
    const withArcs = [...plain, mk(plain, end('t', 'prev'), end('br', 'next'), 'a1'), mk(plain, end('t', 'next'), end('in', 'prev'), 'a2')];
    for (const c of plain.filter((e): e is CableElement => e.type === 'cable')) {
      expect(calculateCablePath(c, withArcs)).toEqual(calculateCablePath(c, plain));
      expect(pathSegmentSpans(c, withArcs)).toEqual(pathSegmentSpans(c, plain));
    }
    load(withArcs);
    S().updateConnectionDistance('A_P', '42'); S().commitHistory();
    expect(S().connectionDistances).toEqual({ A_P: '42' });
    expect(arcsOf(S().elements)).toHaveLength(2);
  });
});

// ---- 19 + history -------------------------------------------------------------------------
describe('other tools and undo/redo', () => {
  it('19. adding / recolouring / deleting an arc are single undo steps; freehand path add/delete untouched', () => {
    const h0 = S().history.length;
    add(end('t', 'prev'), end('br', 'next'), 'a1');
    expect(S().history).toHaveLength(h0 + 1);
    S().updateElement('a1', { strokeColor: '#111111' }); S().commitHistory();
    S().deleteElement('a1'); S().commitHistory();
    expect(S().history).toHaveLength(h0 + 3);
    S().undo(); expect(S().elements.find((e) => e.id === 'a1')!.strokeColor).toBe('#111111');
    S().undo(); expect(S().elements.find((e) => e.id === 'a1')!.strokeColor).toBe('#FF0000');
    S().undo(); expect(arcsOf(S().elements)).toHaveLength(0);
    S().redo(); expect(arcsOf(S().elements)).toHaveLength(1);
    // a freehand path on top does not touch arcs
    S().addElement({ id: 'p', type: 'path', x: 0, y: 0, points: [{ x: 1, y: 1 }], strokeColor: '#000', fillColor: 'none', strokeWidth: 2 });
    S().deleteElement('p'); S().commitHistory();
    expect(arcsOf(S().elements)).toHaveLength(1);
  });
});
