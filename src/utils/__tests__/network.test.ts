import { describe, expect, it } from 'vitest';
import { buildNetwork, Circuit } from '../network';
import { normalizeElements } from '../spanModel';
import type { CableArcElement, CableElement, ConsumerElement, DrawingElement, SymbolElement } from '../../types/drawing';

const RED = '#ff0000', BLUE = '#0000ff';
const pole = (id: string, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string) => pole(id, { symbolId: 'transformer' });
const src = (id: string) => pole(id, { modifiers: { vdSource: true } });
const cable = (id: string, poleIds: string[], color = RED): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: color, fillColor: 'none', strokeWidth: 2 });
let k = 0;
const sub = (poleId: string, color = RED, variant: 'circle' | 'square' = 'circle', count = 1, label = ''): ConsumerElement =>
  ({ id: `u${++k}`, type: 'consumer', x: 0, y: 0, poleId, color, count, variant, label, strokeColor: color, fillColor: color, strokeWidth: 2 });
const arc = (id: string, poleId: string, a: [string, 'prev' | 'next'], b: [string, 'prev' | 'next']): CableArcElement =>
  ({ id, type: 'cable_arc', poleId, from: { cableId: a[0], side: a[1], occurrence: 0 }, to: { cableId: b[0], side: b[1], occurrence: 0 }, x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 });

const net = (els: DrawingElement[]) => buildNetwork(normalizeElements(els));
const only = (els: DrawingElement[]) => { const n = net(els); expect(n.circuits).toHaveLength(1); return n.circuits[0]; };
const span = (c: Circuit, from: string, to: string) => {
  const i = c.spans.findIndex((s) => s.fromPole === from && s.toPole === to);
  expect(i, `span ${from}→${to}`).toBeGreaterThanOrEqual(0);
  return { span: c.spans[i], load: c.downstream[i] };
};

describe('source and downstream loads', () => {
  it('a transformer is taken as the source; each span carries everything downstream of it', () => {
    const c = only([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B']), sub('A', RED, 'circle', 2), sub('B', RED, 'square', 1, '63')]);
    expect(c.status).toBe('ok');
    expect([c.sourcePoleId, c.sourceKind]).toEqual(['T', 'transformer']);
    expect(span(c, 'T', 'A').load).toMatchObject({ single: 8, three: 63 });
    expect(span(c, 'A', 'B').load).toMatchObject({ single: 0, three: 63 });
  });
  it('a cable drawn towards the transformer is oriented away from it', () => {
    const c = only([tr('T'), pole('A'), pole('B'), cable('c', ['B', 'A', 'T']), sub('B')]);
    expect(span(c, 'T', 'A').span.index).toBe(1);
    expect(span(c, 'A', 'B').load.single).toBe(4);
  });
  it('a branch (new cable of the same colour from a trunk pole) adds its loads to the trunk spans before it', () => {
    const c = only([tr('T'), pole('A'), pole('B'), pole('C'), cable('t', ['T', 'A', 'B']), cable('br', ['A', 'C']), sub('B'), sub('C', RED, 'circle', 3)]);
    expect(span(c, 'T', 'A').load.single).toBe(16);
    expect(span(c, 'A', 'B').load.single).toBe(4);
    expect(span(c, 'A', 'C').load.single).toBe(12);
  });
  it('a cable of another colour at the same pole is not connected by sharing the pole', () => {
    const n = net([tr('T'), pole('A'), pole('B'), cable('t', ['T', 'A']), cable('x', ['A', 'B'], BLUE), sub('B', BLUE)]);
    const blue = n.circuits.find((c) => c.colors.has(BLUE))!;
    expect(blue.status).toBe('no-source');
    const red = n.circuits.find((c) => c.colors.has(RED))!;
    expect(red.status).toBe('ok');
    expect(red.downstream.every((d) => d.single === 0)).toBe(true);
  });
  it('… but a Jumper between them connects them', () => {
    const c = only([tr('T'), pole('A'), pole('B'), cable('t', ['T', 'A']), cable('x', ['A', 'B'], BLUE), arc('j', 'A', ['t', 'prev'], ['x', 'next']), sub('B', BLUE)]);
    expect(c.status).toBe('ok');
    expect(span(c, 'T', 'A').load.single).toBe(4);
  });
  it('circuits of different colours leaving one transformer are fed from it, each with its own loads', () => {
    const c = only([tr('T'), pole('A'), pole('B'), cable('r', ['T', 'A']), cable('b', ['T', 'B'], BLUE), sub('A'), sub('B', BLUE, 'square')]);
    expect(span(c, 'T', 'A').load).toMatchObject({ single: 4, three: 0 });
    expect(span(c, 'T', 'B').load).toMatchObject({ single: 0, three: 32 });
  });
  it('span identity: the calculation refers to the span id stored on the cable', () => {
    const els = normalizeElements([tr('T'), pole('A'), cable('c', ['T', 'A'])]);
    const c = buildNetwork(els).circuits[0];
    expect(c.spans[0].spanId).toBe((els[2] as CableElement).spanIds![0]);
  });
});

describe('choosing the source', () => {
  it('no transformer and no chosen pole: no source, nothing is computed', () => {
    const c = only([pole('A'), pole('B'), cable('c', ['A', 'B']), sub('B')]);
    expect(c.status).toBe('no-source');
    expect(c.downstream).toEqual([]);
  });
  it('a pole chosen by the user is the source', () => {
    const c = only([src('A'), pole('B'), cable('c', ['A', 'B']), sub('B')]);
    expect([c.status, c.sourcePoleId, c.sourceKind]).toEqual(['ok', 'A', 'manual']);
  });
  it('two transformers in one connected network: not computed until a source is chosen', () => {
    expect(only([tr('T1'), tr('T2'), pole('A'), cable('c', ['T1', 'A', 'T2'])]).status).toBe('multiple-transformers');
  });
  it('a chosen pole overrides the transformers; they are reported as not being the source', () => {
    const c = only([tr('T1'), src('A'), pole('B'), cable('c', ['T1', 'A', 'B'])]);
    expect([c.status, c.sourcePoleId]).toEqual(['ok', 'A']);
    expect(c.issues).toContainEqual({ kind: 'transformer-not-source', poleId: 'T1' });
    expect(span(c, 'A', 'T1').span.cableId).toBe('c');
  });
  it('two chosen poles in one network: not computed', () => {
    expect(only([src('A'), src('B'), cable('c', ['A', 'B'])]).status).toBe('multiple-sources');
  });
  it('separate networks each use their own transformer', () => {
    const n = net([tr('T1'), pole('A'), tr('T2'), pole('B'), cable('c1', ['T1', 'A']), cable('c2', ['T2', 'B'])]);
    expect(n.circuits.map((c) => [c.status, c.sourcePoleId]).sort()).toEqual([['ok', 'T1'], ['ok', 'T2']]);
  });
});

describe('networks that are not radial', () => {
  it('two cables of the same colour between the same two poles are reported as parallel spans, not computed', () => {
    const c = only([tr('T'), pole('A'), cable('p1', ['T', 'A']), cable('p2', ['A', 'T']), sub('A')]);
    expect(c.status).toBe('non-radial');
    expect(c.issues).toContainEqual({ kind: 'parallel-spans', poles: ['A', 'T'], cableIds: ['p1', 'p2'] });
    expect(c.issues.some((i) => i.kind === 'loop')).toBe(false);
  });
  it('parallel cables of different colours are separate circuits (each computed)', () => {
    const c = only([tr('T'), pole('A'), cable('p1', ['T', 'A']), cable('p2', ['T', 'A'], BLUE), sub('A'), sub('A', BLUE)]);
    expect(c.status).toBe('ok');
    expect(c.spans.filter((s) => s.fromPole === 'T' && s.toPole === 'A')).toHaveLength(2);
    expect(c.downstream.map((d) => d.single)).toEqual([4, 4]);
  });
  it('a ring is detected and not computed', () => {
    const c = only([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B', 'T'])]);
    expect(c.status).toBe('non-radial');
    expect(c.issues.some((i) => i.kind === 'loop')).toBe(true);
  });
});

describe('warnings', () => {
  it('a subscriber whose colour has no cable at its pole is reported and not counted', () => {
    const n = net([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', BLUE)]);
    expect(n.issues.some((i) => i.kind === 'orphan-consumer')).toBe(true);
    expect(n.circuits[0].downstream[0].single).toBe(0);
  });
  it('pole-to-pole links from version 2 files are not used, and reported', () => {
    const legacy = { id: 'L', type: 'jumper', fromPoleId: 'A', toPoleId: 'B', x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 } as DrawingElement;
    const n = net([tr('T'), pole('A'), pole('B'), cable('c', ['T', 'A']), cable('d', ['B', 'A'], BLUE), legacy]);
    expect(n.issues).toContainEqual({ kind: 'legacy-jumper', elementId: 'L' });
    expect(n.circuits.find((c) => c.colors.has(BLUE))!.status).toBe('no-source');
  });
  it('colour comparison ignores letter case (#FF0000 = #ff0000)', () => {
    const c = only([tr('T'), pole('A'), cable('c', ['T', 'A'], '#FF0000'), sub('A', '#ff0000')]);
    expect(c.downstream[0].single).toBe(4);
  });
});

// ---- Stage 7.8: the connection must rest on the drawing's structure, not on the colour alone ----
describe('7.8 structural connection rules', () => {
  it('two same-colour cables that both run THROUGH a pole cross without being joined (warning, no loads mixed)', () => {
    const n = net([tr('T'), pole('X'), pole('Y'), pole('P'), pole('Q'), cable('fed', ['T', 'X', 'Y']), cable('other', ['P', 'X', 'Q']), sub('Q', RED, 'circle', 5)]);
    const fed = n.circuits.find((c) => c.spans.some((s) => s.cableId === 'fed'))!;
    expect(fed.spans.some((s) => s.cableId === 'other')).toBe(false);
    expect(fed.downstream.every((d) => d.single === 0)).toBe(true);
    expect(fed.issues).toContainEqual({ kind: 'same-colour-crossing', poleId: 'X', cableIds: ['fed', 'other'] });
    expect(n.circuits.find((c) => c.spans.some((s) => s.cableId === 'other'))!.status).toBe('no-source');
  });
  it('a cable that only runs through the transformer pole is not taken as fed by it: its network is "ambiguous"', () => {
    const n = net([tr('T'), pole('A'), pole('Q'), pole('R'), cable('red', ['T', 'A']), cable('blue', ['Q', 'T', 'R'], BLUE), sub('R', BLUE)]);
    const red = n.circuits.find((c) => c.spans.some((s) => s.cableId === 'red'))!;
    const blue = n.circuits.find((c) => c.spans.some((s) => s.cableId === 'blue'))!;
    expect(red).not.toBe(blue);
    expect(red.status).toBe('ok');
    expect(blue.status).toBe('ambiguous');
    expect(blue.issues).toContainEqual({ kind: 'passes-source-pole', poleId: 'T', cableId: 'blue' });
  });
  it('… once the user marks that transformer as the source, the through-cable is fed on both sides', () => {
    const c = only([pole('T', { symbolId: 'transformer', modifiers: { vdSource: true } }), pole('Q'), pole('R'), cable('blue', ['Q', 'T', 'R'], BLUE), sub('R', BLUE), sub('Q', BLUE)]);
    expect([c.status, c.sourcePoleId, c.sourceKind]).toEqual(['ok', 'T', 'manual']);
    expect(c.downstream.map((d) => d.single).sort()).toEqual([4, 4]);
  });
  it('a cable ending where two same-colour cables run through cannot be attributed: "ambiguous", not guessed', () => {
    const n = net([tr('T'), pole('X'), pole('Y'), pole('P'), pole('Q'), pole('B'), cable('t1', ['T', 'X', 'Y']), cable('t2', ['P', 'X', 'Q']), cable('br', ['X', 'B']), sub('B')]);
    // nothing is joined at X, and every network touching X is reported instead of computed
    expect(n.circuits).toHaveLength(3);
    for (const c of n.circuits) {
      expect(c.status).not.toBe('ok');
      expect(c.issues.some((i) => i.kind === 'ambiguous-junction')).toBe(true);
    }
    expect(n.circuits.find((c) => c.spans.some((s) => s.cableId === 't1'))!.status).toBe('ambiguous');
  });
  it('kept: a branch drawn from a trunk pole, a trunk continued by a second cable, a cable starting at the transformer', () => {
    const c = only([tr('T'), pole('A'), pole('B'), pole('C'), pole('D'), cable('t', ['T', 'A', 'B']), cable('cont', ['B', 'C']), cable('br', ['A', 'D']), sub('C'), sub('D', RED, 'circle', 2)]);
    expect(c.status).toBe('ok');
    expect(span(c, 'T', 'A').load.single).toBe(12);
    expect(span(c, 'B', 'C').load.single).toBe(4);
  });
  it('a subscriber with an invalid load value is reported and carried as invalid (never as a negative current)', () => {
    const n = net([tr('T'), pole('A'), cable('c', ['T', 'A']), sub('A', RED, 'square', 1, '-40'), sub('A', RED, 'circle', 1)]);
    const c = n.circuits[0];
    expect(c.downstream[0]).toMatchObject({ three: 0, single: 4 });
    expect(c.downstream[0].invalidConsumerIds).toHaveLength(1);
    expect(n.issues.some((i) => i.kind === 'invalid-load')).toBe(true);
  });
});

// ---- Stage 7.9: cable end links ----
const withEnds = (c: CableElement, endLinks: CableElement['endLinks']): CableElement => ({ ...c, endLinks });
describe('7.9 cable end links (auto / connected / isolated)', () => {
  const base = (link?: CableElement['endLinks']) => [tr('T'), pole('X'), pole('Y'), pole('Z'), cable('fed', ['T', 'X', 'Y']), withEnds(cable('other', ['Z', 'X']), link), sub('Z', RED, 'circle', 5)];
  it('auto (no setting): the end at X is joined as before, and listed as an inferred junction to review', () => {
    const n = net(base());
    const c = n.circuits[0];
    expect(n.circuits).toHaveLength(1);
    expect(span(c, 'X', 'Z').load.single).toBe(20);
    expect(c.inferredJunctions).toEqual([{ poleId: 'X', cableId: 'other', end: 'end', withCableIds: ['fed'] }]);
  });
  it('connected: same result, but the junction is confirmed (no longer listed)', () => {
    const n = net(base({ end: 'connected' }));
    expect(span(n.circuits[0], 'X', 'Z').load.single).toBe(20);
    expect(n.circuits[0].inferredJunctions).toEqual([]);
  });
  it('isolated (the audit case): the cable is not joined; the fed network carries none of its load; its own network has no source', () => {
    const n = net(base({ end: 'isolated' }));
    const fed = n.circuits.find((c) => c.spans.some((s) => s.cableId === 'fed'))!;
    const other = n.circuits.find((c) => c.spans.some((s) => s.cableId === 'other'))!;
    expect(fed).not.toBe(other);
    expect(fed.downstream.every((d) => d.single === 0)).toBe(true);
    expect(other.status).toBe('no-source');
  });
  it('isolated at a transformer: that end is not fed', () => {
    const n = net([tr('T'), pole('A'), withEnds(cable('c', ['T', 'A']), { start: 'isolated' }), sub('A')]);
    expect(n.circuits[0].status).toBe('no-source');
  });
  it('an ambiguous junction stays ambiguous even when the end is set to connected (no connection is invented)', () => {
    const n = net([tr('T'), pole('X'), pole('Y'), pole('P'), pole('Q'), pole('B'), cable('t1', ['T', 'X', 'Y']), cable('t2', ['P', 'X', 'Q']), withEnds(cable('br', ['X', 'B']), { start: 'connected' }), sub('B')]);
    for (const c of n.circuits) expect(c.status).not.toBe('ok');
    expect(n.circuits.some((c) => c.issues.some((i) => i.kind === 'ambiguous-junction'))).toBe(true);
  });
  it('… but isolating that end removes the ambiguity for the through-cables', () => {
    const n = net([tr('T'), pole('X'), pole('Y'), pole('P'), pole('Q'), pole('B'), cable('t1', ['T', 'X', 'Y']), cable('t2', ['P', 'X', 'Q']), withEnds(cable('br', ['X', 'B']), { start: 'isolated' }), sub('B')]);
    expect(n.circuits.find((c) => c.spans.some((s) => s.cableId === 't1'))!.status).toBe('ok');
    expect(n.circuits.find((c) => c.spans.some((s) => s.cableId === 'br'))!.status).toBe('no-source');
  });
  it('a Jumper still links an isolated end (explicit) and that is reported', () => {
    const n = net([tr('T'), pole('A'), pole('B'), cable('t', ['T', 'A']), withEnds(cable('x', ['A', 'B'], BLUE), { start: 'isolated' }), arc('j', 'A', ['t', 'prev'], ['x', 'next']), sub('B', BLUE)]);
    expect(n.circuits[0].status).toBe('ok');
    expect(n.circuits[0].issues.some((i) => i.kind === 'isolated-end-jumpered')).toBe(true);
  });
  it('a branch keeps working without any Jumper or setting', () => {
    const c = only([tr('T'), pole('A'), pole('B'), pole('C'), cable('t', ['T', 'A', 'B']), cable('br', ['A', 'C']), sub('C', RED, 'circle', 3)]);
    expect([c.status, span(c, 'T', 'A').load.single]).toEqual(['ok', 12]);
  });
});
