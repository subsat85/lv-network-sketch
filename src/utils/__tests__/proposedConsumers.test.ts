import { beforeEach, describe, expect, it } from 'vitest';
import { buildNetwork, consumerIncluded, Network } from '../network';
import { computeVoltageDrop } from '../voltageDrop';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL, readElectricalSettings } from '../electricalSettings';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { loadsByColor } from '../loads';
import { compareConnections, connectionCandidates, proposalLoadText } from '../proposedConsumers';
import { proposalGeometry } from '../proposalDrawing';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import type { CableElement, ConsumerElement, ConsumerProposal, DrawingElement, ElectricalSettings, SpanProps, SymbolElement } from '../../types/drawing';

// «مشترك مقترح»: a proposed subscriber, connected to the cable it names at its pole.
// Proposed (not confirmed): only in the study (studyProposedConsumers). Confirmed: always,
// as a permanent subscriber. Never connected by colour, never dropped silently.

const RED = '#ff0000', BLUE = '#0000ff';
const pole = (id: string, x = 0, y = 0, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x, y, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string, x = 0, y = 0) => pole(id, x, y, { symbolId: 'transformer' });
const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: RED, fillColor: 'none', strokeWidth: 2, ...extra });
const sub3 = (poleId: string, amps: number, color = RED): ConsumerElement => ({ id: `u3-${poleId}-${amps}-${color}`, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: String(amps), strokeColor: color, fillColor: color, strokeWidth: 2 });
const prop = (id: string, poleId: string, amps: number, p: Partial<ConsumerProposal> = {}, color = RED): ConsumerElement =>
  ({ ...sub3(poleId, amps, color), id, proposal: { status: 'proposed', ...p } });
const at = (cableId: string, occurrence = 0, side?: 'prev' | 'next') => ({ connection: side ? { cableId, occurrence, side } : { cableId, occurrence } });

const strip = (n: unknown) => JSON.stringify(n, (key, v) => (key === 'spanId' || key === 'spanIds' ? undefined : v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
const net = (els: DrawingElement[], includeProposedConsumers = false, studySplits = false) => buildNetwork(normalizeElements(els), { includeProposedConsumers, studySplits });
const fed = (n: Network, poleId: string) => { const l = n.circuits.filter((c) => c.status === 'ok' && c.poleIds.has(poleId)); expect(l).toHaveLength(1); return l[0]; };
const spanLoad = (n: Network, poleId: string, from: string, to: string) => { const c = fed(n, poleId); const i = c.spans.findIndex((s) => s.fromPole === from && s.toPole === to); expect(i).toBeGreaterThanOrEqual(0); return c.downstream[i].three; };

// T —— A —— B (red), 10 A at A, 20 A at B
const LINE = (...extra: DrawingElement[]) => [tr('T'), pole('A', 100), pole('B', 200), cable('main', ['T', 'A', 'B']), sub3('A', 10), sub3('B', 20), ...extra];

describe('1–4. proposing, confirming, and the official results', () => {
  it('1. the connection points at a pole: one per cable visit (two cables at A → two choices)', () => {
    const els = [...LINE(), pole('E', 100, 100), cable('br', ['A', 'E'], { strokeColor: BLUE })];
    const c = connectionCandidates(normalizeElements(els), 'A', DEFAULT_ELECTRICAL);
    expect(c.map((x) => [x.cableId, x.occurrence, x.side ?? null, x.color])).toEqual([['main', 0, null, RED], ['br', 0, null, BLUE]]);
    expect(connectionCandidates(normalizeElements([pole('Z')]), 'Z', DEFAULT_ELECTRICAL)).toEqual([]);
  });

  it('4. a proposed (not confirmed) subscriber does not change the official results, nor the load report', () => {
    const base = net(LINE());
    const withProp = net(LINE(prop('p', 'B', 50, at('main'))));
    expect(strip(withProp)).toBe(strip(base));
    expect(spanLoad(withProp, 'B', 'T', 'A')).toBe(30);
    const cons = (els: DrawingElement[]) => els.filter((e): e is ConsumerElement => e.type === 'consumer' && consumerIncluded(e));
    expect(loadsByColor(cons(LINE(prop('p', 'B', 50, at('main')))))).toEqual(loadsByColor(cons(LINE())));
  });

  it('3. in the study, or once confirmed, it is a permanent subscriber on the chosen cable', () => {
    expect(spanLoad(net(LINE(prop('p', 'B', 50, at('main'))), true), 'B', 'T', 'A')).toBe(80);
    const confirmed = net(LINE(prop('p', 'B', 50, { status: 'confirmed', ...at('main') })));
    expect(spanLoad(confirmed, 'B', 'T', 'A')).toBe(80);
    expect(spanLoad(confirmed, 'B', 'A', 'B')).toBe(70);
    // the confirmed one counts in the load report too
    const rep = loadsByColor(LINE(prop('p', 'B', 50, { status: 'confirmed', ...at('main') })).filter((e): e is ConsumerElement => e.type === 'consumer' && consumerIncluded(e)));
    expect(rep[0].threePhaseLoad).toBe(80);
  });

  it('3b. voltage drop with hand values: a confirmed 50 A at B (Al 95, 100 m spans)', () => {
    const ZPH = 0.38448 * 0.9 + 0.08 * Math.sqrt(1 - 0.81);
    const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, system: '3ph4w', dataSource: 'test' };
    const withProps = (els: DrawingElement[]) => normalizeElements(els).map((e) => {
      if (e.type !== 'cable') return e;
      let c = e; c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...AL95, poles: [p, c.poleIds[i + 1]] }); }); return c;
    });
    const S: ElectricalSettings = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };
    const D = { A_T: '100', A_B: '100' };
    const dropB = (els: DrawingElement[], s = S) => computeVoltageDrop(withProps(els), D, s).byPole.get('B')!.find((x) => x.status !== 'na')!.dropV!;
    expect(dropB(LINE())).toBeCloseTo(ZPH * 0.1 * (30 + 20), 9);
    expect(dropB(LINE(prop('p', 'B', 50, at('main'))))).toBeCloseTo(ZPH * 0.1 * (30 + 20), 9);                          // proposed: official unchanged
    expect(dropB(LINE(prop('p', 'B', 50, at('main'))), { ...S, studyProposedConsumers: true })).toBeCloseTo(ZPH * 0.1 * (80 + 70), 9); // study
    expect(dropB(LINE(prop('p', 'B', 50, { status: 'confirmed', ...at('main') })))).toBeCloseTo(ZPH * 0.1 * (80 + 70), 9); // confirmed
  });
});

describe('5. connection: explicit, never by colour', () => {
  // two red cables run THROUGH A (not joined there): T—A—B and T2—A—C
  const TWO = (...extra: DrawingElement[]) => [tr('T'), tr('T2', 0, 100), pole('A', 100, 50), pole('B', 200), pole('C', 200, 100),
    cable('c1', ['T', 'A', 'B']), cable('c2', ['T2', 'A', 'C']), ...extra];

  it('a subscriber proposed on the second cable loads that cable only', () => {
    const n = net(TWO(prop('p', 'A', 40, { status: 'confirmed', ...at('c2') })));
    expect(spanLoad(n, 'C', 'T2', 'A')).toBe(40);
    expect(spanLoad(n, 'B', 'T', 'A')).toBe(0);
    const n1 = net(TWO(prop('p', 'A', 40, { status: 'confirmed', ...at('c1') })));
    expect(spanLoad(n1, 'B', 'T', 'A')).toBe(40);
  });

  it('no cable chosen, or a cable that no longer passes the pole: the networks at that pole are not computed, and it is reported', () => {
    for (const p of [prop('p', 'A', 40, { status: 'confirmed' }), prop('p', 'A', 40, { status: 'confirmed', ...at('gone') }), prop('p', 'A', 40, { status: 'confirmed', ...at('c1', 3) })]) {
      const n = net(TWO(p));
      const atA = n.circuits.filter((c) => c.poleIds.has('A'));
      expect(atA.length).toBeGreaterThan(0);
      for (const c of atA) {
        expect(c.status).not.toBe('ok');
        expect(c.issues).toContainEqual({ kind: 'proposed-consumer-unconnected', consumerId: 'p', poleId: 'A' });
      }
    }
    // a proposed (not confirmed) one outside the study changes nothing, even unconnected
    expect(strip(net(TWO(prop('p', 'A', 40))))).toBe(strip(net(TWO())));
  });

  it('existing subscribers keep their rule (by colour) exactly as before', () => {
    expect(strip(net(TWO(sub3('A', 7))))).toBe(strip(buildNetwork(normalizeElements(TWO(sub3('A', 7))))));
  });
});

describe('6. with the confirmed electrical split study', () => {
  const SPLIT = (side: 'prev' | 'next' | undefined, ...extra: DrawingElement[]) => [tr('T'), pole('A', 100), pole('B', 200), pole('C', 300),
    cable('main', ['T', 'A', 'B', 'C'], { suggestedSplits: ['B'], ...(side ? { splitConsumerSides: { 'B#0': side } } : {}) }), sub3('C', 5), ...extra];

  it('the study lists the two sides at a split as separate connection points', () => {
    const c = connectionCandidates(normalizeElements(SPLIT('prev')), 'B', { studySuggestedSplits: true });
    expect(c.map((x) => [x.side, x.keptSide])).toEqual([['prev', true], ['next', false]]);
    expect(connectionCandidates(normalizeElements(SPLIT('prev')), 'B', { studySuggestedSplits: false }).map((x) => x.side ?? null)).toEqual([null]);
  });

  it('connected to the visit: follows the side kept at the pole; connected to a named side: that side', () => {
    const kept = net(SPLIT('prev', prop('p', 'B', 40, { status: 'confirmed', ...at('main') })), false, true);
    expect(spanLoad(kept, 'B', 'A', 'B')).toBe(40);
    const open = net(SPLIT('prev', prop('p', 'B', 40, { status: 'confirmed', ...at('main', 0, 'next') })), false, true);
    expect(spanLoad(open, 'A', 'A', 'B')).toBe(0);
    const down = open.circuits.find((c) => c.poleIds.has('C'))!;
    expect(down.status).toBe('no-source');
    expect([...down.busLoad.values()].reduce((s, l) => s + l.three, 0)).toBe(45);
  });

  it('a split whose side is not chosen yet: blocked by the split rule (not guessed), the proposal is not reported twice', () => {
    const n = net(SPLIT(undefined, prop('p', 'B', 40, { status: 'confirmed', ...at('main') })), false, true);
    const issues = n.circuits.flatMap((c) => c.issues);
    expect(issues.some((i) => i.kind === 'split-side-unassigned')).toBe(true);
    expect(issues.some((i) => i.kind === 'proposed-consumer-unconnected')).toBe(false);
    expect(n.circuits.every((c) => c.status !== 'ok')).toBe(true);
  });
});

describe('comparison and the recommended cable (rule approved by the user)', () => {
  const ZPH = 0.38448 * 0.9 + 0.08 * Math.sqrt(1 - 0.81);
  const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, system: '3ph4w', dataSource: 'test' };
  const withProps = (els: DrawingElement[]) => normalizeElements(els).map((e) => {
    if (e.type !== 'cable') return e;
    let c = e; c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...AL95, poles: [p, c.poleIds[i + 1]] }); }); return c;
  });
  const S: ElectricalSettings = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };
  // two feeders through A: c1 from T (already 60 A at B), c2 from T2 (lightly loaded)
  const els = () => withProps([tr('T'), tr('T2', 0, 100), pole('A', 100, 50), pole('B', 200), pole('C', 200, 100), cable('c1', ['T', 'A', 'B']), cable('c2', ['T2', 'A', 'C']), sub3('B', 60), sub3('C', 5)]);
  const D = { A_T: '100', A_B: '100', A_T2: '100', A_C: '100' };

  it('each cable is calculated with the subscriber there; the lightly loaded feeder is recommended', () => {
    const e = els();
    const draft = prop('new', 'A', 40);
    const cmp = compareConnections(e, D, S, {}, draft, connectionCandidates(e, 'A', S));
    const [r1, r2] = cmp.results;
    expect(r1.candidate.cableId).toBe('c1');
    // c1: T–A carries 60 + 40, A–B 60 → worst at B
    expect(r1.maxPercent! * 230 / 100).toBeCloseTo(ZPH * 0.1 * (100 + 60), 9);
    expect(r1.maxPercentBefore! * 230 / 100).toBeCloseTo(ZPH * 0.1 * (60 + 60), 9);
    // c2: T2–A carries 5 + 40, A–C 5 → worst at A (45 A × 0.1 km) vs C (45 + 5)
    expect(r2.maxPercent! * 230 / 100).toBeCloseTo(ZPH * 0.1 * (45 + 5), 9);
    expect(cmp.recommended?.candidate.cableId).toBe('c2');
    expect(r2.recommended).toBe(true);
    expect(r1.violations).toEqual([]);
    // the drawing itself is not changed by the comparison
    expect(e.some((x) => x.id === 'new')).toBe(false);
  });

  it('a connection that would put any pole of its network over the limit is not recommended', () => {
    const e = els();
    // c1 worst ≈ 160 A × 0.1 km × 0.381 Ω/km = 6.1 V = 2.65 %; c2 ≈ 50 A → 0.83 %: a 2.5 % limit excludes c1 only
    const tight = compareConnections(e, D, { ...S, limitPercent: 2.5, nearLimitFraction: 0.99 }, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(tight.results[0].violations.length).toBeGreaterThan(0);
    expect(tight.recommended?.candidate.cableId).toBe('c2');
    const none = compareConnections(e, D, { ...S, limitPercent: 0.1 }, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(none.recommended).toBeUndefined();
    expect(none.noRecommendation).toMatch(/تجاوز/);
  });

  it('a connection that would put a pole under the minimum phase voltage is not recommended (limit % alone would allow it)', () => {
    const e = els();
    // c1 worst ≈ 6.1 V → 223.9 V at B; c2 worst ≈ 1.9 V → 228.1 V. Limit 99 % (never reached), minimum phase voltage 225 V
    const r = compareConnections(e, D, { ...S, limitPercent: 99, minPhaseVoltage: 225 }, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(r.results[0].violations).toContain('B');
    expect(r.results[1].violations).toEqual([]);
    expect(r.recommended?.candidate.cableId).toBe('c2');
  });

  it('a connection that would put a pole under the minimum line voltage is not recommended', () => {
    const e = els();
    // three-phase loads only (no neutral current): line voltage = 400 − √3·ΔV; c1 at B ≈ 389.4 V, c2 ≈ 396.7 V
    const r = compareConnections(e, D, { ...S, limitPercent: 99, minPhaseVoltage: 1, minLineVoltage: 392 }, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(r.results[0].violations).toContain('B');
    expect(r.results[1].violations).toEqual([]);
    expect(r.recommended?.candidate.cableId).toBe('c2');
  });

  it('equal results: the first candidate in the listed order is recommended (and only one)', () => {
    // two identical feeders through A
    const e = withProps([tr('T'), tr('T2', 0, 100), pole('A', 100, 50), pole('B', 200), pole('C', 200, 100), cable('c1', ['T', 'A', 'B']), cable('c2', ['T2', 'A', 'C']), sub3('B', 5), sub3('C', 5)]);
    const r = compareConnections(e, D, S, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(r.results[0].maxPercent).toBeCloseTo(r.results[1].maxPercent!, 12);
    expect(r.recommended?.candidate.cableId).toBe('c1');
    expect(r.results.filter((x) => x.recommended)).toHaveLength(1);
  });

  it('a network that cannot be computed at all is never recommended', () => {
    // c2's transformer removed: c2's network has no source
    const e = withProps([tr('T'), pole('T2x', 0, 100), pole('A', 100, 50), pole('B', 200), pole('C', 200, 100), cable('c1', ['T', 'A', 'B']), cable('c2', ['T2x', 'A', 'C']), sub3('B', 60), sub3('C', 5)]);
    const r = compareConnections(e, { ...D, A_T2x: '100' }, S, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(r.results[1].computable).toBe(false);
    expect(r.recommended?.candidate.cableId).toBe('c1');
  });

  // T—A—B on c1 (with properties), a branch A—X WITHOUT properties carrying 200 A at X
  const PARTIAL = () => {
    const base = withProps([tr('T'), tr('T2', 0, 100), pole('A', 100, 50), pole('B', 200), pole('C', 200, 100), cable('c1', ['T', 'A', 'B']), cable('c2', ['T2', 'A', 'C']), sub3('B', 60), sub3('C', 5)]);
    return [...base, pole('X', 100, 150), ...normalizeElements([pole('X', 100, 150), cable('br', ['A', 'X'], { strokeColor: '#00aa00' })]).filter((e) => e.type === 'cable'), sub3('X', 200, '#00aa00')] as DrawingElement[];
  };

  it('review case: a network computed only in part (a branch with missing data) is never recommended, and says why', () => {
    // one cable through B: the subscriber joins c1's network; c1 also feeds a red branch B—X with no properties and 200 A at X
    const e = [...withProps([tr('T'), pole('A', 100), pole('B', 200), cable('c1', ['T', 'A', 'B']), sub3('B', 5)]),
      pole('X', 200, 100), ...normalizeElements([pole('B', 200), pole('X', 200, 100), cable('br', ['B', 'X'])]).filter((x) => x.type === 'cable'), sub3('X', 200)] as DrawingElement[];
    const r = compareConnections(e, { A_T: '100', A_B: '100', B_X: '100' }, S, {}, prop('new', 'B', 10), connectionCandidates(e, 'B', S).filter((c) => c.cableId === 'c1'));
    const x = r.results[0];
    expect(x.computable).toBe(false);
    expect(x.incompletePoleIds).toEqual(['X']);
    expect(x.reason).toBe('جزء من الشبكة غير قابل للحساب (بيانات ناقصة) — لا يمكن التحقق من جميع المشتركين');
    expect(x.maxPercent).toBeUndefined();      // no "maximum drop" shown as if it were final
    expect(x.recommended).toBeUndefined();
    expect(r.recommended).toBeUndefined();
    expect(r.noRecommendation).toBe('لا توجد نقطة ربط قابلة للحساب');
  });

  it('missing data in ANOTHER network does not exclude a candidate whose own network is complete', () => {
    // the green branch A—X (no properties) is its own network: neither c1 nor c2 is connected to it
    const e = PARTIAL();
    const r = compareConnections(e, { ...D, A_X: '100' }, S, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S).filter((c) => c.cableId !== 'br'));
    expect(r.results.map((x) => [x.candidate.cableId, x.computable, x.incompletePoleIds ?? null])).toEqual([['c1', true, null], ['c2', true, null]]);
    expect(r.recommended?.candidate.cableId).toBe('c2');
    // connected to the incomplete branch itself: not computable (its own network)
    const own = compareConnections(e, { ...D, A_X: '100' }, S, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S).filter((c) => c.cableId === 'br'));
    expect(own.results[0].computable).toBe(false);
  });

  it('a complete network stays comparable: values, violations and the recommendation as before', () => {
    const e = els();
    const r = compareConnections(e, D, S, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(r.results.every((x) => x.computable && x.incompletePoleIds === undefined && x.maxPercent !== undefined)).toBe(true);
    expect(r.results[1].maxPercent! * 230 / 100).toBeCloseTo(ZPH * 0.1 * (45 + 5), 9);
    expect(r.recommended?.candidate.cableId).toBe('c2');
  });

  it('missing data: not computable, no recommendation, the reason is given', () => {
    const e = normalizeElements([tr('T'), pole('A', 100), cable('c1', ['T', 'A'])]);
    const cmp = compareConnections(e, {}, S, {}, prop('new', 'A', 40), connectionCandidates(e, 'A', S));
    expect(cmp.results[0].computable).toBe(false);
    expect(cmp.results[0].reason).toBeTruthy();
    expect(cmp.recommended).toBeUndefined();
  });

  it('the load text and the drawing: «مشترك» box with the load in A, a jumper to the chosen cable', () => {
    expect(proposalLoadText({ variant: 'square', label: '63', count: 1 })).toBe('3φ 63 A');
    expect(proposalLoadText({ variant: 'circle', label: '', count: 2 })).toBe('1φ ×2 8 A');
    const e = normalizeElements(LINE(prop('p', 'A', 40, at('main'))));
    const g = proposalGeometry(e, e.find((x) => x.id === 'p') as ConsumerElement, 20)!;
    expect(g.amps).toBe(40);
    expect(g.connected).toBe(true);
    expect(g.jumper!.color).toBe(RED);
    // the box is away from the cables (they run left / right of A): above or below
    expect(Math.abs(g.box.cy - 0)).toBeGreaterThan(20);
    const lost = normalizeElements(LINE(prop('p', 'A', 40, at('gone'))));
    expect(proposalGeometry(lost, lost.find((x) => x.id === 'p') as ConsumerElement, 20)!.connected).toBe(false);
  });
});

describe('7–8. undo / redo, save, draft, import / export, old projects', () => {
  const S = () => useDrawingStore.getState();
  const initial = S();
  beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
  const STYLE = { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
  const load = (els: DrawingElement[]) => { S().loadProject({ elements: els, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: {}, connectionLabelOffsets: {} } as Parameters<typeof initial.loadProject>[0]); historyGestureEnd(); };
  const step = (fn: () => void) => { S().saveHistory(); fn(); S().saveHistory(); };
  const p = () => S().elements.find((e) => e.id === 'p') as ConsumerElement | undefined;

  it('add, edit, confirm, move, delete: one undo step each; undo / redo restore every state', () => {
    load(LINE());
    step(() => S().addElement(prop('p', 'B', 50, at('main'))));
    step(() => S().updateElement('p', { label: '63' }));
    step(() => S().updateElement('p', { proposal: { ...p()!.proposal!, status: 'confirmed' } }));
    step(() => S().updateElement('p', { proposal: { ...p()!.proposal!, boxOffset: { x: 10, y: -60 } } }));
    step(() => S().deleteElement('p'));
    expect(p()).toBeUndefined();
    S().undo(); expect(p()!.proposal!.boxOffset).toEqual({ x: 10, y: -60 });
    S().undo(); expect(p()!.proposal!.boxOffset).toBeUndefined(); expect(p()!.proposal!.status).toBe('confirmed');
    S().undo(); expect(p()!.proposal!.status).toBe('proposed');
    S().undo(); expect(p()!.label).toBe('50');
    S().undo(); expect(p()).toBeUndefined();
    for (let i = 0; i < 5; i++) S().redo();
    expect(p()).toBeUndefined();
    S().undo(); expect(p()!.proposal).toEqual({ status: 'confirmed', connection: { cableId: 'main', occurrence: 0 }, boxOffset: { x: 10, y: -60 } });
  });

  it('cancelling an edit changes nothing (no step); the study switch is one step', () => {
    load(LINE(prop('p', 'B', 50, at('main'))));
    const h0 = S().history.length; const before = JSON.stringify(S().elements);
    S().saveHistory(); S().saveHistory(); // a sheet opened and closed without saving
    expect(S().history.length).toBe(h0); expect(JSON.stringify(S().elements)).toBe(before);
    step(() => S().updateElectricalSettings({ studyProposedConsumers: true }));
    expect(S().history.length).toBe(h0 + 1);
    S().undo(); expect(S().electrical.studyProposedConsumers).toBeUndefined();
  });

  it('export → import (twice) and the autosave draft keep the proposal, its status, cable, box and the study switch', () => {
    load(LINE(prop('p', 'B', 50, { status: 'confirmed', ...at('main'), boxOffset: { x: 5, y: 70 } })));
    step(() => S().updateElectricalSettings({ studyProposedConsumers: true }));
    const st = S();
    let json = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    for (let i = 0; i < 2; i++) {
      const r = parseProjectFile(json); expect(r.ok).toBe(true);
      const d = (r as { data: { elements: DrawingElement[]; electrical: ElectricalSettings } }).data;
      expect(d.electrical.studyProposedConsumers).toBe(true);
      expect((d.elements.find((e) => e.id === 'p') as ConsumerElement).proposal).toEqual({ status: 'confirmed', connection: { cableId: 'main', occurrence: 0 }, boxOffset: { x: 5, y: 70 } });
      expect(d.elements.filter((e) => e.type === 'consumer')).toHaveLength(3);
      json = serializeProject(d.elements, st.style, 1, 'circle', {}, {}, null, 'x', 1, 1, d.electrical, {});
    }
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    expect(v.ok).toBe(true);
    const dd = (v as { draft: { data: { elements: DrawingElement[]; electrical: ElectricalSettings } } }).draft.data;
    expect((dd.elements.find((e) => e.id === 'p') as ConsumerElement).proposal?.status).toBe('confirmed');
    expect(dd.electrical.studyProposedConsumers).toBe(true);
  });

  it('old projects: no proposals, no switch → off and results exactly as before; malformed proposal data is rejected clearly', () => {
    expect(readElectricalSettings({ phaseVoltage: 230 }).settings.studyProposedConsumers).toBeUndefined();
    expect(readElectricalSettings({ studyProposedConsumers: 1 }).invalid).toContain('studyProposedConsumers');
    expect(strip(buildNetwork(normalizeElements(LINE())))).toBe(strip(net(LINE())));
    for (const bad of [{ status: 'maybe' }, { status: 'proposed', connection: { cableId: 'main', occurrence: -1 } }, { status: 'proposed', connection: { cableId: 'main', occurrence: 0, side: 'up' } }, { status: 'proposed', boxOffset: { x: 'a', y: 0 } }, 'yes']) {
      const file = JSON.stringify({ version: 1, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', elements: [...LINE().filter((e) => e.type !== 'consumer'), { ...sub3('B', 5), proposal: bad }], connectionDistances: {}, connectionLabelOffsets: {} });
      const r = parseProjectFile(file);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toMatch(/proposal/);
    }
  });

  it('deleting the pole removes its proposed subscribers too (as any subscriber); deleting the chosen cable reports it', () => {
    load([...LINE(prop('p', 'B', 50, { status: 'confirmed', ...at('main') })), pole('D', 300), cable('ext', ['B', 'D'], { strokeColor: BLUE })]);
    step(() => S().updateElement('p', { proposal: { ...p()!.proposal!, connection: { cableId: 'ext', occurrence: 0 } } }));
    step(() => S().deleteElement('ext'));
    const n = buildNetwork(S().elements);
    expect(n.circuits.filter((c) => c.poleIds.has('B')).every((c) => c.issues.some((i) => i.kind === 'proposed-consumer-unconnected'))).toBe(true);
    step(() => S().deleteElement('B'));
    expect(p()).toBeUndefined();
    S().undo(); expect(p()).toBeDefined();
  });
});
