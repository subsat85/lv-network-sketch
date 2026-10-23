import { describe, expect, it } from 'vitest';
import { ALL_SCOPE, cableLabel, colourGroups, groupCables, UNASSIGNED_SCOPE } from '../cableGroups';
import { normalizeElements, withSpanProps } from '../spanModel';
import { computeVoltageDrop } from '../voltageDrop';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import { deserializeProject, serializeProject, DEFAULT_STYLE } from '../projectSerialization';
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';

const RED = '#EF4444', BLUE = '#3B82F6';
const pole = (id: string, x = 0, y = 0, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string, x = 0, y = 0) => pole(id, x, y, { symbolId: 'transformer' });
const cable = (id: string, poleIds: string[], color = RED, extra: Partial<CableElement> = {}): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: color, fillColor: 'none', strokeWidth: 2, ...extra });
const sub = (id: string, poleId: string, color = RED): ConsumerElement => ({ id, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: '20', strokeColor: color, fillColor: color, strokeWidth: 2 });
const norm = (els: DrawingElement[]) => normalizeElements(els);
const scopeKeys = (els: DrawingElement[]) => groupCables(els).scopes.map((s) => [s.key, s.cableIds]);

describe('colour groups (one square per colour)', () => {
  it('cables of the same colour make one group with their count; case and spaces of the value do not split it', () => {
    const els = norm([tr('T'), pole('A'), pole('B'), pole('C'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'], ' #ef4444 '), cable('c3', ['A', 'C'], BLUE)]);
    const g = colourGroups(els);
    expect(g.map((x) => [x.key, x.cableIds, x.spans])).toEqual([['#ef4444', ['c1', 'c2'], 2], ['#3b82f6', ['c3'], 1]]);
    expect(new Set(g.map((x) => x.key)).size).toBe(g.length);
    expect(g[0].color).toBe(RED); // the first cable's own value is shown
  });

  it('a custom colour is a group like any other; colours no cable uses get no group', () => {
    const els = norm([tr('T'), pole('A'), pole('B'), cable('c1', ['T', 'A'], '#12AB9C'), cable('c2', ['A', 'B'], '#12ab9c')]);
    expect(colourGroups(els).map((x) => [x.key, x.cableIds])).toEqual([['#12ab9c', ['c1', 'c2']]]);
    expect(colourGroups(norm([tr('T'), pole('A')]))).toEqual([]);
  });

  it('restricted to a scope, only its cables are grouped', () => {
    const els = norm([tr('T'), pole('A'), pole('B'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'], BLUE)]);
    expect(colourGroups(els, ['c2']).map((x) => x.cableIds)).toEqual([['c2']]);
  });
});

describe('scopes by transformer (never from colour or position)', () => {
  it('two transformers with the same colour: two scopes, each with its own cables (ids kept, nothing merged)', () => {
    const els = norm([tr('T1'), pole('A'), tr('T2', 500), pole('B', 600), cable('a', ['T1', 'A']), cable('b', ['T2', 'B'])]);
    const G = groupCables(els);
    expect(G.scopes.map((s) => [s.key, s.kind, s.label, s.cableIds])).toEqual([['T1', 'transformer', 'محولة 1', ['a']], ['T2', 'transformer', 'محولة 2', ['b']]]);
    for (const s of G.scopes) expect(colourGroups(els, s.cableIds).map((x) => [x.key, x.cableIds])).toEqual([['#ef4444', s.cableIds]]);
    // all together: the same colour is one square (the view "all"), the cables are still two
    expect(colourGroups(els).map((x) => x.cableIds)).toEqual([['a', 'b']]);
  });

  it('a cable joined to the transformer only by the same-colour rule is not confirmed', () => {
    // T —c1— A, c2 starts at A (same colour, no confirmation): the auto rule joins it
    const els = norm([tr('T'), pole('A'), pole('B'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'])]);
    expect(scopeKeys(els)).toEqual([['T', ['c1']], [UNASSIGNED_SCOPE, ['c2']]]);
  });

  it('the same junction confirmed by the user, or made by a Jumper, gives the transformer', () => {
    const confirmed = norm([tr('T'), pole('A'), pole('B'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'], RED, { endLinks: { start: 'connected' } })]);
    expect(scopeKeys(confirmed)).toEqual([['T', ['c1', 'c2']]]);
    const jumper = norm([tr('T'), pole('A'), pole('B'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'], BLUE),
      { id: 'j', type: 'cable_arc', poleId: 'A', from: { cableId: 'c1', side: 'prev', occurrence: 0 }, to: { cableId: 'c2', side: 'next', occurrence: 0 }, x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 } as DrawingElement]);
    expect(scopeKeys(jumper)).toEqual([['T', ['c1', 'c2']]]);
  });

  it('no source, several transformers, an ambiguous junction or a cable through the transformer: not confirmed', () => {
    expect(scopeKeys(norm([pole('A'), pole('B'), cable('c', ['A', 'B'])]))).toEqual([[UNASSIGNED_SCOPE, ['c']]]);
    expect(scopeKeys(norm([tr('T1'), pole('A'), tr('T2'), cable('c', ['T1', 'A', 'T2'])]))).toEqual([[UNASSIGNED_SCOPE, ['c']]]);
    expect(scopeKeys(norm([pole('A'), tr('T'), pole('B'), cable('c', ['A', 'T', 'B'])]))).toEqual([[UNASSIGNED_SCOPE, ['c']]]);
    // two same-colour cables run through A and a third ends there: which one feeds it is not known
    const amb = norm([tr('T'), pole('A'), pole('B'), pole('C'), pole('D'), pole('E'), cable('x', ['T', 'A', 'B']), cable('y', ['C', 'A', 'D']), cable('z', ['A', 'E'], RED, { endLinks: { start: 'connected' } })]);
    expect(groupCables(amb).scopeOf.get('z')).toBe(UNASSIGNED_SCOPE);
  });

  it('a pole chosen as source is a scope of its own', () => {
    const els = norm([pole('S', 0, 0, { modifiers: { vdSource: true } }), pole('A'), cable('c', ['S', 'A'])]);
    expect(groupCables(els).scopes.map((s) => [s.key, s.kind, s.label])).toEqual([['S', 'manual', 'مصدر: عمود 1']]);
  });

  it('the position of the drawing does not matter', () => {
    const a = norm([tr('T1', 0, 0), pole('A', 100, 0), tr('T2', 400, 0), pole('B', 500, 0), cable('a', ['T1', 'A']), cable('b', ['T2', 'B'])]);
    const moved = a.map((e) => (e.type === 'symbol' ? { ...e, x: 1000 - e.x, y: e.y + 300 } : e));
    expect(scopeKeys(moved)).toEqual(scopeKeys(a));
  });

  it('no cables: nothing', () => {
    expect(groupCables(norm([tr('T')]))).toEqual({ scopes: [], scopeOf: new Map() });
    expect(ALL_SCOPE).toBe('all');
  });
});

describe('labels', () => {
  it('a cable is named by its first and last pole (arrow for right-to-left text) and its spans', () => {
    const els = norm([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B'])]);
    expect(cableLabel(els, els.find((e) => e.id === 'c') as CableElement)).toBe('محولة 1 ← عمود 2 · مقطعان');
    const one = norm([tr('T'), pole('A'), cable('d', ['T', 'A'])]);
    expect(cableLabel(one, one.find((e) => e.id === 'd') as CableElement)).toBe('محولة 1 ← عمود 1 · مقطع واحد');
  });
});

describe('the grouping is a view only', () => {
  const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, system: '3ph4w', dataSource: 'test' };
  const NET = () => normalizeElements([tr('T1'), pole('A', 100), pole('B', 200), pole('C', 200, 100), tr('T2', 600), pole('D', 700),
    cable('main', ['T1', 'A', 'B']), cable('br', ['A', 'C'], RED, { endLinks: { start: 'connected' } }), cable('b2', ['B', 'C'], BLUE), cable('far', ['T2', 'D']),
    sub('u1', 'B'), sub('u2', 'C'), sub('u3', 'D')]).map((e) => {
    if (e.type !== 'cable') return e;
    let c = e as CableElement; c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...AL95, poles: [p, c.poleIds[i + 1]] }); }); return c;
  });
  const dists = (els: DrawingElement[]) => { const d: Record<string, string> = {}; for (const e of els) if (e.type === 'cable') (e as CableElement).poleIds.slice(0, -1).forEach((p, i) => { d[[p, (e as CableElement).poleIds[i + 1]].sort().join('_')] = '80'; }); return d; };
  const S = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };

  it('grouping changes no element, id, span id or colour, and the voltage-drop results are the same', () => {
    const els = NET();
    const before = JSON.stringify(els);
    const vd0 = computeVoltageDrop(els, dists(els), S);
    const G = groupCables(els);
    for (const s of G.scopes) colourGroups(els, s.cableIds);
    colourGroups(els);
    expect(JSON.stringify(els)).toBe(before);
    const vd1 = computeVoltageDrop(els, dists(els), S);
    const flat = (v: typeof vd0) => JSON.stringify([...v.byPole.entries()].map(([p, l]) => [p, l.map((x) => [x.bus, x.status, x.percent])]));
    expect(flat(vd1)).toBe(flat(vd0));
    expect(G.scopes.map((s) => [s.key, s.cableIds])).toEqual([['T1', ['main', 'br']], ['T2', ['far']], [UNASSIGNED_SCOPE, ['b2']]]);
  });

  it('export → import keeps the elements and gives the same grouping (no field added to the file)', () => {
    const els = NET();
    const json = serializeProject(els, DEFAULT_STYLE, 1, 'circle', dists(els), {}, 'p1', 'test');
    expect(json).not.toMatch(/scope|colourGroup|cableGroup/i);
    const back = deserializeProject(json);
    expect(JSON.stringify(back.elements)).toBe(JSON.stringify(els));
    expect(scopeKeys(back.elements)).toEqual(scopeKeys(els));
  });

  it('an old project (no span ids, no end links) is grouped without changing it', () => {
    const old: DrawingElement[] = [tr('T'), pole('A'), pole('B'), cable('c1', ['T', 'A']), cable('c2', ['A', 'B'], BLUE)];
    const before = JSON.stringify(old);
    expect(scopeKeys(old)).toEqual([['T', ['c1']], [UNASSIGNED_SCOPE, ['c2']]]);
    expect(JSON.stringify(old)).toBe(before);
  });
});
