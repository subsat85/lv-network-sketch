import { describe, expect, it } from 'vitest';
import { cableChoices, cablesNear, isAmbiguous } from '../cableHits';
import { calculateCablePath } from '../cableLayout';
import { normalizeElements, withSpanProps } from '../spanModel';
import { computeVoltageDrop } from '../voltageDrop';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';

const pole = (id: string, x: number, y: number, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string, x: number, y: number) => pole(id, x, y, { symbolId: 'transformer' });
const cable = (id: string, poleIds: string[], color: string, offset = 0): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset, lineStyle: 'straight', strokeColor: color, fillColor: 'none', strokeWidth: 2 });
const norm = (els: DrawingElement[]) => normalizeElements(els);

// three cables along the same poles, a few units apart (as drawn for parallel cables), and one far away
const NET = () => norm([tr('T', 0, 0), pole('A', 200, 0), pole('B', 400, 0), pole('F1', 0, 300), pole('F2', 200, 300),
  cable('c1', ['T', 'A', 'B'], '#EF4444', 0), cable('c2', ['T', 'A'], '#EF4444', 6), cable('c3', ['A', 'B'], '#3B82F6', -6), cable('far', ['F1', 'F2'], '#10B981')]);

describe('which cables a touch can mean', () => {
  it('a touch on a cable alone: one hit, not ambiguous (the current behaviour applies)', () => {
    const hits = cablesNear(NET(), { x: 100, y: 300 }, 14, 'far');
    expect(hits.map((h) => h.cableId)).toEqual(['far']);
    expect(isAmbiguous(hits)).toBe(false);
  });

  it('three cables close together: all within reach, nearest first, each with its own span', () => {
    const els = NET();
    const at = (id: string) => calculateCablePath(els.find((e) => e.id === id) as CableElement, els);
    // a point on c2 between T and A
    const p2 = at('c2'); const q = { x: (p2[0].x + p2[p2.length - 1].x) / 2, y: (p2[0].y + p2[p2.length - 1].y) / 2 };
    const hits = cablesNear(els, q, 14, 'c2');
    expect(isAmbiguous(hits)).toBe(true);
    expect(hits[0].cableId).toBe('c2');
    expect(new Set(hits.map((h) => h.cableId))).toEqual(new Set(['c1', 'c2']));
    expect(hits.find((h) => h.cableId === 'c1')!.span).toMatchObject({ index: 0, fromId: 'T', toId: 'A' });
    // between A and B: c1 and c3
    const h2 = cablesNear(els, { x: 300, y: 0 }, 14, 'c1');
    expect(new Set(h2.map((h) => h.cableId))).toEqual(new Set(['c1', 'c3']));
    expect(h2.find((h) => h.cableId === 'c1')!.span).toMatchObject({ index: 1, fromId: 'A', toId: 'B' });
    expect(h2.find((h) => h.cableId === 'c3')!.span).toMatchObject({ index: 0, fromId: 'A', toId: 'B' });
  });

  it('three or more at one point: every one is offered', () => {
    const els = norm([pole('A', 0, 0), pole('B', 300, 0), cable('x', ['A', 'B'], '#000000', 0), cable('y', ['A', 'B'], '#000000', 5), cable('z', ['A', 'B'], '#000000', -5), cable('w', ['A', 'B'], '#000000', 10)]);
    const hits = cablesNear(els, { x: 150, y: 0 }, 14, 'x');
    expect(hits.map((h) => h.cableId).sort()).toEqual(['w', 'x', 'y', 'z']);
  });

  it('the reach is a screen distance: a precise pointer (6 units) or zooming in separates cables a finger cannot', () => {
    const els = NET();
    expect(cablesNear(els, { x: 300, y: 0 }, 14, 'c1').length).toBe(2);
    // c3 is about 6 units away from c1: within a finger's reach, not within a mouse's at zoom 2 (6 px = 3 units)
    expect(cablesNear(els, { x: 300, y: 0 }, 3, 'c1').map((h) => h.cableId)).toEqual(['c1']);
  });

  it('the touched cable is always listed, even when its own hit area is wider than the reach', () => {
    const els = NET();
    expect(cablesNear(els, { x: 100, y: 309 }, 2, 'far').map((h) => h.cableId)).toEqual(['far']);
  });
});

describe('rows of the choice', () => {
  it('colour, first and last pole, spans, and the span under the touch', () => {
    const els = NET();
    const rows = cableChoices(els, cablesNear(els, { x: 300, y: 0 }, 14, 'c1'));
    const c1 = rows.find((r) => r.cableId === 'c1')!, c3 = rows.find((r) => r.cableId === 'c3')!;
    expect([c1.color, c1.ends, c1.spans, c1.spanHere, c1.extra]).toEqual(['#EF4444', 'محولة 1 ← عمود 2', 'مقطعان', 'عمود 1 ← عمود 2', null]);
    expect([c3.color, c3.ends, c3.spans, c3.spanHere, c3.extra]).toEqual(['#3B82F6', 'عمود 1 ← عمود 2', 'مقطع واحد', 'عمود 1 ← عمود 2', null]);
  });

  it('same colour and same poles: told apart by their number, not hidden', () => {
    const els = norm([pole('A', 0, 0), pole('B', 300, 0), cable('x', ['A', 'B'], '#EF4444', 0), cable('y', ['A', 'B'], '#ef4444', 5)]);
    const rows = cableChoices(els, cablesNear(els, { x: 150, y: 2 }, 14, 'x'));
    expect(rows.map((r) => r.extra).sort()).toEqual(['كيبل رقم 1', 'كيبل رقم 2']);
    expect(new Set(rows.map((r) => r.cableId)).size).toBe(2);
  });
});

describe('a view only', () => {
  const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, system: '3ph4w', dataSource: 'test' };
  it('finding and listing cables changes no element and no voltage-drop result', () => {
    const els = NET().map((e) => {
      if (e.type !== 'cable') return e;
      let c = e as CableElement; c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...AL95, poles: [p, c.poleIds[i + 1]] }); }); return c;
    }).concat([{ id: 'u', type: 'consumer', x: 0, y: 0, poleId: 'B', color: '#EF4444', count: 1, variant: 'square', label: '30', strokeColor: '#EF4444', fillColor: '#EF4444', strokeWidth: 2 } as ConsumerElement]);
    const d: Record<string, string> = { A_T: '50', A_B: '60', F1_F2: '40' };
    const S = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };
    const before = JSON.stringify(els);
    const flat = () => JSON.stringify([...computeVoltageDrop(els, d, S).byPole.entries()].map(([p, l]) => [p, l.map((x) => [x.bus, x.status, x.percent])]));
    const vd0 = flat();
    for (const p of [{ x: 300, y: 0 }, { x: 100, y: 3 }, { x: 100, y: 300 }]) cableChoices(els, cablesNear(els, p, 14));
    expect(JSON.stringify(els)).toBe(before);
    expect(flat()).toBe(vd0);
  });
});
