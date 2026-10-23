import { beforeEach, describe, expect, it } from 'vitest';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import { arrowIntoPole, cableEndArrow, getCircleSegmentIntersection, pruneSuggestedSplits, suggestedSplitArrows, SUGGESTED_SPLIT_COLOR, toggleSuggestedSplit } from '../cableArrows';
import { calculateCablePath } from '../cableLayout';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { computeVoltageDrop } from '../voltageDrop';
import { effectiveSettings } from '../electricalSettings';
import { buildNetwork } from '../network';
import type { CableElement, ConsumerElement, DrawingElement, Point, SymbolElement } from '../../types/drawing';

// «نقطة فصل مقترحة»: the cable start / end arrowhead in red, bound to one cable and one of its poles.

const S = () => useDrawingStore.getState();
const initial = S();
beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
const pole = (id: string, x: number, y = 0, symbolId = 'lv-pole'): SymbolElement => ({ id, type: 'symbol', symbolId, x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, lineStyle: 'zigzag', strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2, ...extra });
const consumer = (id: string, poleId: string): ConsumerElement => ({ id, type: 'consumer', x: 0, y: 0, poleId, color: '#ff0000', count: 4, variant: 'circle', label: '', strokeColor: '#ff0000', fillColor: '#ff0000', strokeWidth: 2 });
const STYLE = { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
const R = 20; // POLE_RADIUS × poleSizeScale 1
const cableOf = (id: string) => S().elements.find((e) => e.id === id) as CableElement;
const load = (elements: DrawingElement[], connectionDistances: Record<string, string> = {}) => { S().loadProject({ elements, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances, connectionLabelOffsets: {} } as Parameters<typeof initial.loadProject>[0]); historyGestureEnd(); };
const toggle = (cableId: string, poleId: string) => { const patch = toggleSuggestedSplit(cableOf(cableId), poleId); if (!patch) return false; S().saveHistory(); S().updateElement(cableId, patch); S().saveHistory(); return true; };
const NET = () => [pole('T', 0, 0, 'transformer'), pole('A', 300, 0), pole('B', 600, 0), pole('C', 300, 300), cable('main', ['T', 'A', 'B']), cable('branch', ['A', 'C'], { strokeColor: '#0000ff' }), consumer('u', 'B'), consumer('v', 'C')];
const DIST = { A_T: '100', A_B: '80', A_C: '60' };

// the arrowMode code as it was inline in SketchCanvas / PreviewCanvas before it moved to cableArrows.ts
const oldInlineArrow = (el: CableElement, finalPoints: Point[], elements: DrawingElement[], radius: number) => {
  if (!(el.arrowMode && el.arrowMode !== 'none')) return null;
  const isStart = el.arrowMode === 'start';
  const poleId = isStart ? el.poleIds[0] : el.poleIds[el.poleIds.length - 1];
  const p = elements.find((e) => e.id === poleId);
  if (!p) return null;
  let arrowPos: Point | null = null; let angle = 0;
  const tracePoints = isStart ? finalPoints : [...finalPoints].reverse();
  for (let i = 0; i < tracePoints.length - 1; i++) {
    const p1 = tracePoints[i]; const p2 = tracePoints[i + 1];
    const intersection = getCircleSegmentIntersection(p1, p2, { x: p.x, y: p.y }, radius);
    if (intersection) { arrowPos = intersection; angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI + 180; break; }
  }
  return arrowPos ? { pos: arrowPos, angle } : null;
};

describe('the start / end arrow is unchanged by the refactor', () => {
  it('cableEndArrow gives exactly the old inline result (start, end, none, straight, zigzag, parallel cables)', () => {
    const els: DrawingElement[] = [pole('P1', 0, 0), pole('P2', 200, 50), pole('P3', 380, 260), pole('P4', 90, 400),
      cable('c1', ['P1', 'P2', 'P3'], { arrowMode: 'start' }), cable('c2', ['P1', 'P2', 'P3'], { arrowMode: 'end', strokeColor: '#00f' }),
      cable('c3', ['P3', 'P4'], { arrowMode: 'end', lineStyle: 'straight' }), cable('c4', ['P4', 'P1'], { arrowMode: 'none' }), cable('c5', ['P2', 'P4'])];
    for (const el of els.filter((e): e is CableElement => e.type === 'cable')) {
      const path = calculateCablePath(el, els);
      for (const r of [R, R * 1.5, R * 0.7]) expect(cableEndArrow(el, path, els, r)).toEqual(oldInlineArrow(el, path, els, r));
    }
    expect(cableEndArrow(els[4] as CableElement, calculateCablePath(els[4] as CableElement, els), els, R)).not.toBeNull();
  });
});

describe('placing the mark', () => {
  it('only on a pole of that cable; toggling adds and removes it', () => {
    const c = cable('main', ['T', 'A', 'B']);
    expect(toggleSuggestedSplit(c, 'C')).toBeNull();
    expect(toggleSuggestedSplit(c, 'A')).toEqual({ suggestedSplits: ['A'] });
    expect(toggleSuggestedSplit({ ...c, suggestedSplits: ['A'] }, 'A')).toEqual({ suggestedSplits: undefined });
    expect(toggleSuggestedSplit({ ...c, suggestedSplits: ['A'] }, 'B')).toEqual({ suggestedSplits: ['A', 'B'] });
  });

  it('a pole with two cables: the mark goes on the chosen cable only', () => {
    load(NET(), DIST);
    expect(toggle('branch', 'A')).toBe(true);
    expect(cableOf('branch').suggestedSplits).toEqual(['A']);
    expect(cableOf('main').suggestedSplits).toBeUndefined();
    const els = S().elements;
    expect(suggestedSplitArrows(cableOf('main'), calculateCablePath(cableOf('main'), els), els, R)).toEqual([]);
    expect(suggestedSplitArrows(cableOf('branch'), calculateCablePath(cableOf('branch'), els), els, R)).toHaveLength(1);
  });

  it('at an end pole: one arrow, at the same place and angle as that end\'s start / end arrow', () => {
    load([pole('P1', 0, 0), pole('P2', 300, 60), pole('P3', 600, 0), cable('c', ['P1', 'P2', 'P3'])]);
    toggle('c', 'P1'); toggle('c', 'P3');
    const els = S().elements; const c = cableOf('c'); const path = calculateCablePath(c, els);
    const arrows = suggestedSplitArrows(c, path, els, R);
    expect(arrows.map((a) => a.key)).toEqual(['P1:0:start', 'P3:2:end']);
    expect({ pos: arrows[0].pos, angle: arrows[0].angle }).toEqual(cableEndArrow({ ...c, arrowMode: 'start' }, path, els, R));
    expect({ pos: arrows[1].pos, angle: arrows[1].angle }).toEqual(cableEndArrow({ ...c, arrowMode: 'end' }, path, els, R));
  });

  it('at a transformer end: no arrow, exactly as the existing start / end arrow (the cable starts at the transformer edge)', () => {
    load(NET(), DIST);
    const c = { ...cableOf('main'), suggestedSplits: ['T'] }; const els = S().elements; const path = calculateCablePath(c, els);
    expect(cableEndArrow({ ...c, arrowMode: 'start' }, path, els, R)).toBeNull();
    expect(suggestedSplitArrows(c, path, els, R)).toEqual([]);
  });

  it('at a pole in the middle: two arrows, one on each side, on the pole circle and pointing into the pole', () => {
    const els: DrawingElement[] = [pole('P1', 0, 0), pole('P2', 300, 40), pole('P3', 520, 300), cable('c', ['P1', 'P2', 'P3'], { suggestedSplits: ['P2'] })];
    const c = els[3] as CableElement; const path = calculateCablePath(c, els);
    const arrows = suggestedSplitArrows(c, path, els, R);
    expect(arrows.map((a) => a.key)).toEqual(['P2:1:before', 'P2:1:after']);
    for (const a of arrows) {
      expect(Math.hypot(a.pos.x - 300, a.pos.y - 40)).toBeCloseTo(R, 6);              // on the circle
      const dir = { x: Math.cos(a.angle * Math.PI / 180), y: Math.sin(a.angle * Math.PI / 180) };
      const toCenter = { x: 300 - a.pos.x, y: 40 - a.pos.y };
      expect(dir.x * toCenter.x + dir.y * toCenter.y).toBeGreaterThan(0);              // points into the pole
    }
    // the "before" arrow sits on the P1 side, the "after" one on the P3 side
    const d = (p: Point, q: SymbolElement) => Math.hypot(p.x - q.x, p.y - q.y);
    expect(d(arrows[0].pos, els[0] as SymbolElement)).toBeLessThan(d(arrows[1].pos, els[0] as SymbolElement));
    expect(d(arrows[1].pos, els[2] as SymbolElement)).toBeLessThan(d(arrows[0].pos, els[2] as SymbolElement));
    expect(SUGGESTED_SPLIT_COLOR).toBe('red');
  });

  it('the arrow helper itself: no crossing → no arrow', () => {
    expect(arrowIntoPole([{ x: 100, y: 100 }, { x: 200, y: 100 }], { x: 0, y: 0 }, R)).toBeNull();
  });
});

describe('the mark follows the pole and the cable', () => {
  it('moving the pole keeps the mark, and the arrow moves with the pole', () => {
    load(NET(), DIST); toggle('main', 'A');
    const before = suggestedSplitArrows(cableOf('main'), calculateCablePath(cableOf('main'), S().elements), S().elements, R);
    S().updateElement('A', { x: 320, y: 40 }); historyGestureEnd();
    expect(cableOf('main').suggestedSplits).toEqual(['A']);
    const after = suggestedSplitArrows(cableOf('main'), calculateCablePath(cableOf('main'), S().elements), S().elements, R);
    expect(after).toHaveLength(2);
    for (const a of after) expect(Math.hypot(a.pos.x - 320, a.pos.y - 40)).toBeCloseTo(R, 6);
    expect(after[0].pos).not.toEqual(before[0].pos);
  });

  it('a new pole put on a span keeps the mark on its pole; a pole taken off the cable drops its mark', () => {
    load(NET(), DIST); toggle('main', 'A'); toggle('main', 'B');
    S().updateElements([{ id: 'main', changes: { poleIds: ['T', 'A', 'X', 'B'] } }]); historyGestureEnd();
    expect(cableOf('main').suggestedSplits).toEqual(['A', 'B']);
    S().updateElements([{ id: 'main', changes: { poleIds: ['T', 'A'] } }]); historyGestureEnd();
    expect(cableOf('main').suggestedSplits).toEqual(['A']);
    expect(pruneSuggestedSplits(cable('x', ['P1', 'P2'], { suggestedSplits: ['P2', 'P9', 'P2'] })).suggestedSplits).toEqual(['P2']);
    expect(pruneSuggestedSplits(cable('x', ['P1'], { suggestedSplits: ['P9'] })).suggestedSplits).toBeUndefined();
  });

  it('deleting a marked pole in the middle removes that mark; other marks and the other cable are untouched', () => {
    load([pole('P1', 0, 0), pole('P2', 200, 0), pole('P3', 400, 0), pole('P4', 600, 0), pole('Q', 200, 200), cable('c', ['P1', 'P2', 'P3', 'P4']), cable('d', ['P2', 'Q'], { strokeColor: '#00f' })],
      { P1_P2: '50', P2_P3: '50', P3_P4: '50', P2_Q: '30' });
    toggle('c', 'P3'); toggle('c', 'P4'); toggle('d', 'Q');
    const res = S().deleteElement('P3'); historyGestureEnd();
    expect(res.ok).toBe(true);
    expect(cableOf('c').poleIds).not.toContain('P3');
    expect(cableOf('c').suggestedSplits).toEqual(['P4']);
    expect(cableOf('d').suggestedSplits).toEqual(['Q']);
    S().undo(); expect(cableOf('c').suggestedSplits).toEqual(['P3', 'P4']);
  });
});

describe('undo / redo, save, export / import, autosave', () => {
  it('each toggle is one undo step; undo / redo restore it', () => {
    load(NET(), DIST);
    const h0 = S().history.length;
    toggle('main', 'A');
    expect(S().history.length).toBe(h0 + 1);
    S().undo(); expect(cableOf('main').suggestedSplits).toBeUndefined();
    S().redo(); expect(cableOf('main').suggestedSplits).toEqual(['A']);
    toggle('main', 'A'); expect(cableOf('main').suggestedSplits).toBeUndefined();
    S().undo(); expect(cableOf('main').suggestedSplits).toEqual(['A']);
  });

  it('export → import and the autosave draft keep the mark (file stays version 1)', () => {
    load(NET(), DIST); toggle('main', 'A'); toggle('branch', 'C');
    const st = S();
    const json = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    expect(JSON.parse(json).version).toBe(1);
    const p = parseProjectFile(json); expect(p.ok).toBe(true);
    const els = (p as { data: { elements: DrawingElement[] } }).data.elements;
    expect((els.find((e) => e.id === 'main') as CableElement).suggestedSplits).toEqual(['A']);
    expect((els.find((e) => e.id === 'branch') as CableElement).suggestedSplits).toEqual(['C']);
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    expect(v.ok).toBe(true);
    expect(((v as { draft: { data: { elements: DrawingElement[] } } }).draft.data.elements.find((e) => e.id === 'main') as CableElement).suggestedSplits).toEqual(['A']);
  });

  it('a malformed suggestedSplits in a file is rejected with a clear message', () => {
    const bad = JSON.stringify({ version: 1, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', elements: [pole('A', 0), pole('B', 100), { ...cable('c', ['A', 'B']), suggestedSplits: 'A' }], connectionDistances: {}, connectionLabelOffsets: {} });
    const p = parseProjectFile(bad);
    expect(p.ok).toBe(false);
    expect(JSON.stringify(p)).toMatch(/suggestedSplits/);
  });
});

describe('nothing electrical changes', () => {
  it('connections, lengths and voltage-drop results are identical with and without marks', () => {
    load(NET(), DIST);
    S().updateElectricalSettings({ conductorTempC: 70 });
    const vd = () => computeVoltageDrop(S().elements, S().connectionDistances, effectiveSettings(S().electrical), S().distanceFlags);
    // the whole network model (Maps included) of the drawing
    const net = () => JSON.stringify(buildNetwork(S().elements), (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
    const v0 = JSON.stringify(vd()); const n0 = net(); const d0 = JSON.stringify(S().connectionDistances); const poles0 = JSON.stringify(S().elements.filter((e) => e.type === 'cable').map((c) => (c as CableElement).poleIds));
    toggle('main', 'A'); toggle('main', 'B'); toggle('branch', 'A');
    expect(JSON.stringify(vd())).toBe(v0);
    expect(net()).toBe(n0);
    expect(n0.length).toBeGreaterThan(200); // a real network was compared
    expect(JSON.stringify(S().connectionDistances)).toBe(d0);
    expect(JSON.stringify(S().elements.filter((e) => e.type === 'cable').map((c) => (c as CableElement).poleIds))).toBe(poles0);
    expect(cableOf('main').arrowMode).toBeUndefined(); // the cable's own start / end setting is not touched
  });
});
