import { describe, expect, it } from 'vitest';
import { arcGeometry, autoJointArcs, createArc } from '../cableArcs';
import { createCableType, editCableType, latestRevision } from '../cableTypeModel';
import { linkSpanCable } from '../spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';
import { serializeProject, DEFAULT_STYLE } from '../projectSerialization';
import type { CableArcElement, CableElement, DrawingElement } from '../../types/drawing';
import type { CableTypeData } from '../../types/cableType';

// The automatic joint mark: the existing Jumper drawing, shown (display only) where two spans meet at a
// pole and each is linked to a different library cable. ALL VALUES SYNTHETIC.

const v = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'unverified' } }) as never;
const data = (name: string, s: number): CableTypeData => ({
  name, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: s }, neutral: { material: 'al', sectionMm2: 70 },
  r: v(0.2145, 'unspecified'), x: v(0.0716, 'ac-50hz'), rn: v(0.4126, 'unspecified'), xn: v(0.0754, 'ac-50hz'), source: { name: 'synthetic' },
} as CableTypeData);
const T120 = createCableType('ct120', data('ABC 3x120+70 (synthetic)', 120), { now: 1 });
const C120 = latestRevision(T120);
const C120b = latestRevision(editCableType(T120, { name: 'ABC 3x120+70 rev B (synthetic)' }, { now: 2 }).history); // same type, revision 2
const C70 = latestRevision(createCableType('ct70', data('ABC 3x70+54 (synthetic)', 70), { now: 3 }));

const pole = (id: string, x: number, y: number, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x, y, width: 40, height: 40, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 }) as DrawingElement;
type C = { id: string; poles: string[]; color?: string; links: (ReturnType<typeof latestRevision> | null)[]; endLinks?: CableElement['endLinks'] };
const net = (poles: [string, number, number, string?][], cables: C[], extra: DrawingElement[] = []) => {
  let els = normalizeElements([...poles.map(([id, x, y, s]) => pole(id, x, y, s)),
    ...cables.map((c, j) => ({ id: c.id, type: 'cable', x: 0, y: 0, poleIds: c.poles, cableIndex: j, offset: 0, strokeColor: c.color ?? '#e11d48', fillColor: 'none', strokeWidth: 2, ...(c.endLinks ? { endLinks: c.endLinks } : {}) }) as CableElement), ...extra]);
  for (const c of cables) c.links.forEach((rev, i) => {
    if (!rev) return;
    els = els.map((e) => { if (e.id !== c.id) return e; const k = e as CableElement; const { id, props } = spanAt(k, i); return withSpanProps(k, id!, linkSpanCable(props, [k.poleIds[i], k.poleIds[i + 1]], rev, 1)); });
  });
  return els;
};
const marks = (els: DrawingElement[]) => autoJointArcs(els).map((a) => `${a.poleId}:${a.from.cableId}.${a.from.side}${a.from.occurrence}-${a.to.cableId}.${a.to.side}${a.to.occurrence}`);
const line: [string, number, number, string?][] = [['P0', 0, 0], ['P1', 0, 150], ['P2', 0, 300], ['P3', 0, 450]];

describe('automatic joint marks (display only, from the drawing)', () => {
  it('one cable through a pole, 3x120 on one side and 3x70 on the other: one mark at that pole', () => {
    expect(marks(net(line, [{ id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], links: [C120, C120, C70] }]))).toEqual(['P2:k.next0-k.prev0']);
  });
  it('the same cable on both sides: no mark; another revision of the same cable: no mark', () => {
    expect(marks(net(line, [{ id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], links: [C120, C120, C120] }]))).toEqual([]);
    expect(marks(net(line, [{ id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], links: [C120, C120b, C120] }]))).toEqual([]);
  });
  it('a span without a library link: no mark', () => {
    expect(marks(net(line, [{ id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], links: [C120, null, C70] }]))).toEqual([]);
  });
  it('a cable continued by another one (end -> start) with a different cable: one mark', () => {
    expect(marks(net(line, [{ id: 'a', poles: ['P0', 'P1'], links: [C120] }, { id: 'b', poles: ['P1', 'P2', 'P3'], links: [C70, C70] }]))).toEqual(['P1:a.prev0-b.next0']);
  });
  it('two cable ends that meet at the pole, one marked «isolated» there: no mark (not connected)', () => {
    expect(marks(net(line, [{ id: 'a', poles: ['P0', 'P1'], links: [C120], endLinks: { end: 'isolated' } }, { id: 'b', poles: ['P1', 'P2'], links: [C70] }]))).toEqual([]);
  });
  it('a branching pole (three spans of the colour): no mark', () => {
    expect(marks(net([...line, ['X', 150, 150]], [{ id: 'k', poles: ['P0', 'P1', 'P2'], links: [C120, C70] }, { id: 'x', poles: ['P1', 'X'], links: [C70] }]))).toEqual([]);
  });
  it('a transformer: no mark (the cables are fed from its busbar)', () => {
    expect(marks(net([['T', 0, 0, 'transformer'], ['A', 0, 150], ['B', 0, -150]], [{ id: 'k', poles: ['B', 'T', 'A'], links: [C120, C70] }]))).toEqual([]);
  });
  it('cables of other colours at the pole do not count: one mark per colour where its own two spans differ', () => {
    const els = net(line, [
      { id: 'k', poles: ['P0', 'P1', 'P2'], links: [C120, C70] },
      { id: 'm', poles: ['P0', 'P1', 'P2'], color: '#2563eb', links: [C120, C120] },
      { id: 'n', poles: ['P0', 'P1', 'P2'], color: '#10b981', links: [C70, C120] },
    ]);
    expect(marks(els)).toEqual(['P1:k.next0-k.prev0', 'P1:n.next0-n.prev0']);
  });
  it('a ring drawn as one cable (3x120 A–B–C–D, 3x70 D–A): a mark at D (inside the cable) and one at A (where it closes)', () => {
    const els = net([['A', 0, 0], ['B', 150, 0], ['C', 150, 150], ['D', 0, 150]], [{ id: 'k', poles: ['A', 'B', 'C', 'D', 'A'], links: [C120, C120, C120, C70] }]);
    expect(marks(els)).toEqual(['A:k.next0-k.prev1', 'D:k.next0-k.prev0']);
  });
  it('a Jumper drawn by the user on the same two points: no second mark (and the user\'s Jumper is kept)', () => {
    const base = net(line, [{ id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], links: [C120, C120, C70] }]);
    const r = createArc(base, 'P2', { cableId: 'k', side: 'prev', occurrence: 0 }, { cableId: 'k', side: 'next', occurrence: 0 }, 'j1');
    expect(r.ok).toBe(true);
    const els = [...base, (r as { arc: CableArcElement }).arc];
    expect(marks(els)).toEqual([]);
    expect(els.filter((e) => e.type === 'cable_arc').map((e) => e.id)).toEqual(['j1']);
  });
  it('drawn with the Jumper geometry; a Jumper of the user elsewhere on the pole keeps its place', () => {
    const els0 = net([...line, ['X', 150, 300]], [{ id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], links: [C120, C120, C70] }, { id: 'x', poles: ['P2', 'X'], color: '#2563eb', links: [C70] }]);
    const r = createArc(els0, 'P2', { cableId: 'k', side: 'prev', occurrence: 0 }, { cableId: 'x', side: 'next', occurrence: 0 }, 'j1');
    const els = [...els0, (r as { arc: CableArcElement }).arc];
    const [auto] = autoJointArcs(els);
    expect(auto.type).toBe('cable_arc');
    const g = arcGeometry(els, auto, 20)!;
    expect(g).not.toBeNull();
    expect(g.dotRadius).toBeCloseTo(arcGeometry(els, els.find((e) => e.id === 'j1') as CableArcElement, 20)!.dotRadius, 9);
    // the user's Jumper: the same geometry with or without the automatic mark
    const manual = els.find((e) => e.id === 'j1') as CableArcElement;
    expect(arcGeometry(els, manual, 20)!.d).toBe(arcGeometry(els0.concat(manual), manual, 20)!.d);
  });
  it('nothing is added to the drawing or the saved project; the same marks every time (no duplicates)', () => {
    const els = net(line, [{ id: 'k', poles: ['P0', 'P1', 'P2', 'P3'], links: [C120, C70, C120] }]);
    const before = JSON.stringify(els);
    const a = autoJointArcs(els), b = autoJointArcs(els);
    expect(JSON.stringify(els)).toBe(before);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
    expect(a.length).toBe(2);
    const saved = serializeProject(els, DEFAULT_STYLE, 1, 'circle', {}, {}, null, 'synthetic');
    expect(saved).not.toContain('auto-joint');
    expect(saved).not.toContain('cable_arc');
  });
});
