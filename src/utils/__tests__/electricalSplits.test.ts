import { beforeEach, describe, expect, it } from 'vitest';
import { buildNetwork, Circuit, Network } from '../network';
import { computeVoltageDrop } from '../voltageDrop';
import { normalizeElements, withSpanProps } from '../spanModel';
import { DEFAULT_ELECTRICAL, readElectricalSettings } from '../electricalSettings';
import { parseProjectFile, serializeProject } from '../projectSerialization';
import { buildDraft, validateDraft } from '../autosave';
import { pruneSplitSides, setSplitConsumerSide, splitSideKey, studySplitPoints, endSplitPoints } from '../splitStudy';
import { toggleSuggestedSplit } from '../cableArrows';
import { useDrawingStore, historyGestureEnd } from '../../store/drawingStore';
import type { CableArcElement, CableElement, ConsumerElement, DrawingElement, ElectricalSettings, SpanProps, SymbolElement } from '../../types/drawing';

// Voltage-drop study with suggested split points: a suggestion at an interior pole is an
// electrical open point while ElectricalSettings.studySuggestedSplits is on. The side kept at
// the pole (splitConsumerSides) keeps its consumers and connections; the other side is an open end.

const RED = '#ff0000', BLUE = '#0000ff';
const pole = (id: string, extra: Partial<SymbolElement> = {}): SymbolElement => ({ id, type: 'symbol', symbolId: 'lv-pole', x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2, ...extra });
const tr = (id: string) => pole(id, { symbolId: 'transformer' });
const src = (id: string) => pole(id, { modifiers: { vdSource: true } });
const cable = (id: string, poleIds: string[], extra: Partial<CableElement> = {}): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: RED, fillColor: 'none', strokeWidth: 2, ...extra });
// deterministic ids, so two drawings built separately can be compared result for result
const sub3 = (poleId: string, amps: number, color = RED): ConsumerElement => ({ id: `u3-${poleId}-${amps}-${color}`, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: String(amps), strokeColor: color, fillColor: color, strokeWidth: 2 });
const arc = (id: string, poleId: string, a: [string, 'prev' | 'next'], b: [string, 'prev' | 'next']): CableArcElement =>
  ({ id, type: 'cable_arc', poleId, from: { cableId: a[0], side: a[1], occurrence: 0 }, to: { cableId: b[0], side: b[1], occurrence: 0 }, x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 });
/** a suggested split at `poleId`, with the side kept at the pole (or none) */
const split = (poleId: string, side?: 'prev' | 'next', occurrence = 0): Partial<CableElement> => ({ suggestedSplits: [poleId], ...(side ? { splitConsumerSides: { [splitSideKey(poleId, occurrence)]: side } } : {}) });

const net = (els: DrawingElement[], studySplits = true) => buildNetwork(normalizeElements(els), { studySplits });
// span ids are generated when a drawing is normalised: left out when comparing two drawings
const strip = (n: unknown) => JSON.stringify(n, (key, v) => (key === 'spanId' || key === 'spanIds' ? undefined : v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
const circuitWith = (n: Network, poleId: string, pred: (c: Circuit) => boolean = () => true) => n.circuits.filter((c) => c.poleIds.has(poleId) && pred(c));
const spanLoad = (c: Circuit, from: string, to: string) => {
  const i = c.spans.findIndex((s) => s.fromPole === from && s.toPole === to);
  expect(i, `span ${from}→${to} in ${c.id}`).toBeGreaterThanOrEqual(0);
  return c.downstream[i];
};
const fedCircuit = (n: Network, poleId: string) => { const l = n.circuits.filter((c) => c.status === 'ok' && c.poleIds.has(poleId)); expect(l).toHaveLength(1); return l[0]; };

// T —— A —— B —— C (one red cable), 3φ consumers 10 A at A, 63 A at B, 32 A at C
const LINE = (extra: Partial<CableElement> = {}) => [tr('T'), pole('A'), pole('B'), pole('C'), cable('main', ['T', 'A', 'B', 'C'], extra), sub3('A', 10), sub3('B', 63), sub3('C', 32)];

describe('A. network topology', () => {
  it('1. a radial network without any suggestion: identical with the study on or off', () => {
    expect(strip(net(LINE(), true))).toBe(strip(net(LINE(), false)));
    const c = fedCircuit(net(LINE()), 'C');
    expect(spanLoad(c, 'T', 'A').three).toBe(105);
  });

  it('2. a suggestion alone (study off) changes nothing; a side choice alone changes nothing either', () => {
    expect(strip(net(LINE(split('B', 'prev')), false))).toBe(strip(net(LINE(), false)));
    expect(strip(net(LINE(split('B')), false))).toBe(strip(net(LINE(), false)));
  });

  it('3. study on, split at B: the two sides of B are separate networks', () => {
    const n = net(LINE(split('B', 'prev')));
    const up = fedCircuit(n, 'T');
    expect(up.poleIds.has('C')).toBe(false);
    const down = circuitWith(n, 'C');
    expect(down).toHaveLength(1);
    expect(down[0]).not.toBe(up);
    expect(down[0].status).toBe('no-source');
  });

  it('4. consumers at B kept with the side towards A (prev): they load the upstream network', () => {
    const n = net(LINE(split('B', 'prev')));
    const up = fedCircuit(n, 'T');
    expect(spanLoad(up, 'T', 'A').three).toBe(73);   // 10 + 63
    expect(spanLoad(up, 'A', 'B').three).toBe(63);
    const down = circuitWith(n, 'C')[0];
    expect([...down.busLoad.values()].reduce((s, l) => s + l.three, 0)).toBe(32); // only C
  });

  it('5. consumers at B kept with the side towards C (next): the upstream network ends with an open end at B', () => {
    const n = net(LINE(split('B', 'next')));
    const up = fedCircuit(n, 'T');
    expect(spanLoad(up, 'T', 'A').three).toBe(10);
    expect(spanLoad(up, 'A', 'B').three).toBe(0);
    const down = circuitWith(n, 'C')[0];
    expect(down.status).toBe('no-source');
    expect([...down.busLoad.values()].reduce((s, l) => s + l.three, 0)).toBe(95); // 63 at B + 32 at C
  });

  it('6. no side chosen while consumers are at B: not computed, reported, nothing guessed', () => {
    const n = net(LINE(split('B')));
    for (const c of n.circuits) expect(c.status).not.toBe('ok');
    const issues = n.circuits.flatMap((c) => c.issues).filter((i) => i.kind === 'split-side-unassigned');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toEqual({ kind: 'split-side-unassigned', poleId: 'B', cableId: 'main', occurrence: 0 });
    // the consumers at B are not counted in any computed result
    const atB = sub3('B', 63).id;
    expect(n.circuits.filter((c) => c.status === 'ok').some((c) => [...c.busLoad.values()].some((l) => l.consumerIds.includes(atB)))).toBe(false);
  });

  it('6b. no side chosen but nothing at B could belong to a side: both sides open, no blocking issue', () => {
    const n = net([tr('T'), pole('A'), pole('B'), pole('C'), cable('main', ['T', 'A', 'B', 'C'], split('B')), sub3('A', 10), sub3('C', 32)]);
    const up = fedCircuit(n, 'T');
    expect(spanLoad(up, 'T', 'A').three).toBe(10);
    expect(n.circuits.some((c) => c.issues.some((i) => i.kind === 'split-side-unassigned'))).toBe(false);
    expect(circuitWith(n, 'C')[0].status).toBe('no-source');
  });

  it('7. a suggestion at a cable end is not used by the study; endLinks «isolated» keeps working as before', () => {
    expect(strip(net(LINE(split('C', 'prev'))))).toBe(strip(net(LINE())));
    expect(strip(net(LINE(split('T'))))).toBe(strip(net(LINE())));
    const iso = net([tr('T'), pole('A'), cable('c', ['T', 'A'], { endLinks: { start: 'isolated' }, ...split('T') }), sub3('A', 5)]);
    expect(iso.circuits[0].status).toBe('no-source');
    expect(endSplitPoints(cable('c', ['T', 'A', 'B'], { suggestedSplits: ['T', 'A', 'B'] })).map((p) => p.poleId)).toEqual(['T', 'B']);
  });

  it('8. two split points on one cable: three sections', () => {
    const els = [tr('T'), pole('A'), pole('B'), pole('C'), pole('D'), cable('main', ['T', 'A', 'B', 'C', 'D'], { suggestedSplits: ['B', 'C'], splitConsumerSides: { 'B#0': 'prev', 'C#0': 'next' } }), sub3('A', 10), sub3('B', 20), sub3('C', 30), sub3('D', 40)];
    const n = net(els);
    const up = fedCircuit(n, 'T');
    expect(spanLoad(up, 'T', 'A').three).toBe(30); // A + B
    const mid = n.circuits.filter((c) => c.spans.some((s) => (s.fromPole === 'B' && s.toPole === 'C') || (s.fromPole === 'C' && s.toPole === 'B')));
    expect(mid).toHaveLength(1);
    expect(mid[0].status).toBe('no-source');
    expect([...mid[0].busLoad.values()].reduce((s, l) => s + l.three, 0)).toBe(0); // B's consumers went up, C's went down
    const last = n.circuits.filter((c) => c.poleIds.has('D'));
    expect([...last[0].busLoad.values()].reduce((s, l) => s + l.three, 0)).toBe(70); // C + D
  });

  it('9. a split on one cable does not cut another cable at the same pole', () => {
    // main T—A—B—C is split at B; branch br starts at A; another feeder t2 from T passes through B (blue)
    const els = [tr('T'), pole('A'), pole('B'), pole('C'), pole('E'), pole('F'),
      cable('main', ['T', 'A', 'B', 'C'], split('B', 'prev')), cable('br', ['A', 'E']), cable('t2', ['T', 'B', 'F'], { strokeColor: BLUE }),
      sub3('C', 32), sub3('E', 7), sub3('F', 11, BLUE)];
    const n = net(els);
    const red = fedCircuit(n, 'E');
    expect(spanLoad(red, 'T', 'A').three).toBe(7);         // the branch still fed; C cut off
    const blue = fedCircuit(n, 'F');
    expect(spanLoad(blue, 'B', 'F').three).toBe(11);
    expect(spanLoad(blue, 'T', 'B').three).toBe(11);       // the blue cable runs through B unaffected
  });

  it('10. colours: only the split cable\'s colour is affected; the kept side still joins its same-colour branch at the pole', () => {
    // branch from B (red) joins the kept side; a blue cable through B stays as it was
    const base = (side: 'prev' | 'next') => [tr('T'), pole('A'), pole('B'), pole('C'), pole('G'), cable('main', ['T', 'A', 'B', 'C'], split('B', side)), cable('brB', ['B', 'G']), sub3('G', 5), sub3('C', 32)];
    const kp = net(base('prev'));
    expect(spanLoad(fedCircuit(kp, 'G'), 'T', 'A').three).toBe(5);   // branch at B fed from upstream, C not
    const kn = net(base('next'));
    const up = fedCircuit(kn, 'T');
    expect(spanLoad(up, 'T', 'A').three).toBe(0);                    // the branch went with the downstream side
    expect(circuitWith(kn, 'G')[0].status).toBe('no-source');
  });

  it('11. a Jumper reconnects only the side it names; without it nothing reconnects the open side', () => {
    // feeder 2 (T2 — Q — B) ends at B; the open side of main at B (towards C) is linked to it by a Jumper
    const els = (withJumper: boolean) => [tr('T'), tr('T2'), pole('A'), pole('B'), pole('C'), pole('Q'),
      cable('main', ['T', 'A', 'B', 'C'], split('B', 'prev')), cable('f2', ['T2', 'Q', 'B'], { strokeColor: BLUE }), sub3('B', 63), sub3('C', 32),
      ...(withJumper ? [arc('j', 'B', ['main', 'next'], ['f2', 'prev'])] : [])];
    const without = net(els(false));
    expect(circuitWith(without, 'C')[0].status).toBe('no-source');
    const withJ = net(els(true));
    const fed2 = fedCircuit(withJ, 'C');
    expect(fed2.sourcePoleId).toBe('T2');
    expect(spanLoad(fed2, 'T2', 'Q').three).toBe(32);   // C only: B's consumers stay on the side kept (fed from T)
    expect(spanLoad(fedCircuit(withJ, 'A'), 'T', 'A').three).toBe(63);
  });

  it('11b. a split at a transformer pole the cable passes keeps the existing rule for that point (not fed, reported)', () => {
    const n = net([pole('X'), tr('T'), pole('A'), cable('main', ['X', 'T', 'A'], split('T', 'next')), sub3('A', 5)]);
    expect(n.circuits.some((c) => c.issues.some((i) => i.kind === 'passes-source-pole'))).toBe(true);
    expect(n.circuits.every((c) => c.status !== 'ok')).toBe(true);
  });

  it('12. a section without a source is identified as such', () => {
    const n = net(LINE(split('A', 'prev')));
    const down = circuitWith(n, 'C')[0];
    expect(down.status).toBe('no-source');
    expect(down.sourcePoleId).toBeUndefined();
  });

  it('13. sources on both sides: each section is fed from its own transformer (without the split: two transformers, not computed)', () => {
    const els = (s?: Partial<CableElement>) => [tr('T1'), pole('A'), pole('B'), pole('C'), tr('T2'), cable('main', ['T1', 'A', 'B', 'C', 'T2'], s), sub3('A', 10), sub3('B', 63), sub3('C', 32)];
    expect(net(els()).circuits[0].status).toBe('multiple-transformers');
    const n = net(els(split('B', 'prev')));
    const s1 = fedCircuit(n, 'T1'), s2 = fedCircuit(n, 'T2');
    expect([s1.sourcePoleId, s2.sourcePoleId]).toEqual(['T1', 'T2']);
    expect(spanLoad(s1, 'T1', 'A').three).toBe(73);
    expect(spanLoad(s2, 'T2', 'C').three).toBe(32);
    expect(spanLoad(s2, 'C', 'B').three).toBe(0);
  });

  it('14. stale / invalid side references: ignored by the network, dropped on the next edit', () => {
    // a side for a pole that is not suggested, for a visit that does not exist, for a cable end
    const c = cable('main', ['T', 'A', 'B', 'C'], { suggestedSplits: ['B'], splitConsumerSides: { 'A#0': 'prev', 'B#3': 'next', 'C#0': 'prev' } });
    const n = net([tr('T'), pole('A'), pole('B'), pole('C'), c, sub3('B', 63)]);
    expect(n.circuits.some((x) => x.issues.some((i) => i.kind === 'split-side-unassigned'))).toBe(true); // B#0 has no valid side
    expect(pruneSplitSides(c, c).splitConsumerSides).toBeUndefined();
  });
});

describe('B. voltage-drop calculation (hand-checked)', () => {
  // Al 95 mm² at 70 °C: R = 0.38448 Ω/km; cos φ 0.9: R cos φ + X sin φ = 0.380903 Ω/km (as voltageDrop.test.ts)
  const ZPH = 0.38448 * 0.9 + 0.08 * Math.sqrt(1 - 0.81);
  const AL95: Omit<SpanProps, 'poles'> = { cableKind: 'abc', material: 'al', crossSectionMm2: 95, neutralCrossSectionMm2: 95, neutralMaterial: 'al', xOhmPerKm: 0.08, system: '3ph4w', dataSource: 'test' };
  const SET = (study: boolean): ElectricalSettings => ({ ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70, studySuggestedSplits: study });
  const withProps = (els: DrawingElement[]) => normalizeElements(els).map((e) => {
    if (e.type !== 'cable') return e;
    let c = e; c.poleIds.slice(0, -1).forEach((p, i) => { c = withSpanProps(c, c.spanIds![i], { ...AL95, poles: [p, c.poleIds[i + 1]] }); }); return c;
  });
  const D = { A_T: '100', A_B: '100', B_C: '100', C_T2: '100' };
  const at = (r: ReturnType<typeof computeVoltageDrop>, p: string) => r.byPole.get(p) ?? [];
  const okAt = (r: ReturnType<typeof computeVoltageDrop>, p: string) => { const l = at(r, p).filter((x) => x.status !== 'na'); expect(l, `computed result at ${p}`).toHaveLength(1); return l[0]; };

  it('without a split: currents and drops of the whole line (reference)', () => {
    const r = computeVoltageDrop(withProps(LINE()), D, SET(true));
    // T–A 105 A, A–B 95 A, B–C 32 A; each 0.1 km
    expect(okAt(r, 'C').dropV).toBeCloseTo(ZPH * 0.1 * (105 + 95 + 32), 9);
  });

  it('split at B, consumers kept towards A: B carries only its own load; C is not supplied (no normal result)', () => {
    const r = computeVoltageDrop(withProps(LINE(split('B', 'prev'))), D, SET(true));
    expect(okAt(r, 'A').dropV).toBeCloseTo(ZPH * 0.1 * 73, 9);
    expect(okAt(r, 'B').dropV).toBeCloseTo(ZPH * 0.1 * (73 + 63), 9);
    expect(at(r, 'C').every((x) => x.status === 'na' && x.reason === 'network')).toBe(true);
    expect(at(r, 'C').every((x) => x.dropV === undefined && x.phaseV === undefined)).toBe(true);
  });

  it('split at B, consumers kept towards C: the upstream spans carry only A; B and C are not supplied', () => {
    const r = computeVoltageDrop(withProps(LINE(split('B', 'next'))), D, SET(true));
    expect(okAt(r, 'A').dropV).toBeCloseTo(ZPH * 0.1 * 10, 9);
    // the open end at B (fed side, no load): the drop of A + 0
    expect(okAt(r, 'B').dropV).toBeCloseTo(ZPH * 0.1 * 10, 9);
    expect(at(r, 'C').every((x) => x.status === 'na')).toBe(true);
    expect(at(r, 'B').filter((x) => x.status === 'na').length).toBe(1); // B on the unsupplied side
  });

  it('a second transformer beyond the split feeds its section; the side choice moves B\'s 63 A between them', () => {
    const els = (side: 'prev' | 'next') => withProps([tr('T'), pole('A'), pole('B'), pole('C'), tr('T2'), cable('main', ['T', 'A', 'B', 'C', 'T2'], split('B', side)), sub3('A', 10), sub3('B', 63), sub3('C', 32)]);
    const p = computeVoltageDrop(els('prev'), D, SET(true));
    expect(okAt(p, 'C').dropV).toBeCloseTo(ZPH * 0.1 * 32, 9);                       // from T2: T2–C 32 A
    // B: one result fed from T (its consumers kept on T's side: A–B carries 63 A) and the open end fed from T2 (C–B 0 A)
    const bp = at(p, 'B').filter((x) => x.status !== 'na').map((x) => x.dropV!).sort((a, b) => a - b);
    expect(bp).toHaveLength(2);
    expect(bp[0]).toBeCloseTo(ZPH * 0.1 * 32, 9);
    expect(bp[1]).toBeCloseTo(ZPH * 0.1 * (73 + 63), 9);
    const n = computeVoltageDrop(els('next'), D, SET(true));
    expect(okAt(n, 'A').dropV).toBeCloseTo(ZPH * 0.1 * 10, 9);                       // from T: A only
    expect(okAt(n, 'C').dropV).toBeCloseTo(ZPH * 0.1 * 95, 9);                       // from T2: T2–C 95 A
    const bFromT2 = at(n, 'B').find((x) => x.status !== 'na' && Math.abs(x.dropV! - ZPH * 0.1 * (95 + 63)) < 1e-9);
    expect(bFromT2).toBeDefined();                                                   // C–B 63 A
  });

  it('study off: results identical to a drawing without suggestions', () => {
    const a = computeVoltageDrop(withProps(LINE(split('B', 'prev'))), D, SET(false));
    const b = computeVoltageDrop(withProps(LINE()), D, SET(false));
    expect(strip(a.byPole)).toBe(strip(b.byPole));
  });

  it('no side chosen with consumers at B: nothing is computed and the reason is reported', () => {
    const r = computeVoltageDrop(withProps(LINE(split('B'))), D, SET(true));
    expect([...r.byPole.values()].flat().every((x) => x.status === 'na')).toBe(true);
    expect(r.issues.some((i) => i.kind === 'split-side-unassigned')).toBe(true);
  });
});

describe('C. persistence and editing', () => {
  const S = () => useDrawingStore.getState();
  const initial = S();
  beforeEach(() => { useDrawingStore.setState({ ...initial }, true); historyGestureEnd(); });
  const STYLE = { strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
  const load = (els: DrawingElement[]) => { S().loadProject({ elements: els, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', connectionDistances: {}, connectionLabelOffsets: {} } as Parameters<typeof initial.loadProject>[0]); historyGestureEnd(); };
  const main = () => S().elements.find((e) => e.id === 'main') as CableElement;
  const step = (fn: () => void) => { S().saveHistory(); fn(); S().saveHistory(); };

  it('the study switch and a side choice are one undo step each; undo / redo restore them', () => {
    load(LINE({ suggestedSplits: ['B'] }));
    step(() => S().updateElectricalSettings({ studySuggestedSplits: true }));
    step(() => S().updateElement('main', setSplitConsumerSide(main(), 'B', 0, 'next')));
    expect(main().splitConsumerSides).toEqual({ 'B#0': 'next' });
    S().undo(); expect(main().splitConsumerSides).toBeUndefined(); expect(S().electrical.studySuggestedSplits).toBe(true);
    S().undo(); expect(S().electrical.studySuggestedSplits).toBeUndefined();
    S().redo(); S().redo(); expect(S().electrical.studySuggestedSplits).toBe(true); expect(main().splitConsumerSides).toEqual({ 'B#0': 'next' });
  });

  it('export → import, and the autosave draft, keep the study switch and the sides (no duplicates on repeat)', () => {
    load(LINE({ suggestedSplits: ['B'], splitConsumerSides: { 'B#0': 'prev' } }));
    step(() => S().updateElectricalSettings({ studySuggestedSplits: true }));
    const st = S();
    let json = serializeProject(st.elements, st.style, st.poleSizeScale, st.consumerVariant, st.connectionDistances, st.connectionLabelOffsets, null, 'x', 1, 1, st.electrical, st.distanceFlags);
    for (let i = 0; i < 2; i++) { // twice through import / export
      const p = parseProjectFile(json); expect(p.ok).toBe(true);
      const d = (p as { data: { elements: DrawingElement[]; electrical: ElectricalSettings } }).data;
      expect(d.electrical.studySuggestedSplits).toBe(true);
      expect((d.elements.find((e) => e.id === 'main') as CableElement).splitConsumerSides).toEqual({ 'B#0': 'prev' });
      json = serializeProject(d.elements, st.style, 1, 'circle', {}, {}, null, 'x', 1, 1, d.electrical, {});
    }
    const v = validateDraft(JSON.parse(JSON.stringify(buildDraft(S()))));
    expect(v.ok).toBe(true);
    const dd = (v as { draft: { data: { elements: DrawingElement[]; electrical: ElectricalSettings } } }).draft.data;
    expect(dd.electrical.studySuggestedSplits).toBe(true);
    expect((dd.elements.find((e) => e.id === 'main') as CableElement).splitConsumerSides).toEqual({ 'B#0': 'prev' });
  });

  it('old projects: no switch → off; a malformed switch or side record is rejected with a clear message', () => {
    expect(readElectricalSettings({ phaseVoltage: 230 }).settings.studySuggestedSplits).toBeUndefined();
    expect(readElectricalSettings({ studySuggestedSplits: 'yes' }).invalid).toContain('studySuggestedSplits');
    const bad = JSON.stringify({ version: 1, style: STYLE, poleSizeScale: 1, consumerVariant: 'circle', elements: [pole('A'), pole('B'), pole('C'), { ...cable('c', ['A', 'B', 'C']), suggestedSplits: ['B'], splitConsumerSides: { 'B#0': 'left' } }], connectionDistances: {}, connectionLabelOffsets: {} });
    const p = parseProjectFile(bad);
    expect(p.ok).toBe(false);
    expect(JSON.stringify(p)).toMatch(/splitConsumerSides/);
  });

  it('removing the suggestion removes its side choice; deleting the split pole leaves no cut behind', () => {
    load([...LINE({ suggestedSplits: ['B', 'C'], splitConsumerSides: { 'B#0': 'prev' } }), pole('D'), cable('ext', ['C', 'D'])]);
    step(() => S().updateElement('main', toggleSuggestedSplit(main(), 'B')!));
    expect(main().suggestedSplits).toEqual(['C']);
    expect(main().splitConsumerSides).toBeUndefined();
    step(() => S().updateElement('main', { ...toggleSuggestedSplit(main(), 'B')!, ...setSplitConsumerSide({ ...main(), suggestedSplits: ['C', 'B'] }, 'B', 0, 'next') }));
    expect(main().splitConsumerSides).toEqual({ 'B#0': 'next' });
    const res = S().deleteElement('B'); historyGestureEnd();
    expect(res.ok).toBe(true);
    expect(main().poleIds).not.toContain('B');
    expect(main().suggestedSplits ?? []).not.toContain('B');
    expect(main().splitConsumerSides).toBeUndefined();
    S().undo(); expect(main().splitConsumerSides).toEqual({ 'B#0': 'next' });
  });

  it('editing the cable: a pole added elsewhere keeps the choice; when the split pole becomes the cable end, the choice is dropped', () => {
    load(LINE({ suggestedSplits: ['B'], splitConsumerSides: { 'B#0': 'prev' } }));
    S().updateElements([{ id: 'main', changes: { poleIds: ['T', 'A', 'X', 'B', 'C'] } }]); historyGestureEnd();
    expect(main().splitConsumerSides).toEqual({ 'B#0': 'prev' });
    S().updateElements([{ id: 'main', changes: { poleIds: ['T', 'A', 'X', 'B'] } }]); historyGestureEnd();
    expect(main().splitConsumerSides).toBeUndefined();            // B is now the last pole: not a study split
    expect(main().suggestedSplits).toEqual(['B']);                 // the drawing mark itself stays
  });

  it('a cable visiting the same pole twice: each visit is its own split point (occurrence)', () => {
    const c = cable('loop', ['T', 'A', 'B', 'A', 'C'], { suggestedSplits: ['A'] });
    expect(studySplitPoints(c).map((p) => [p.poleId, p.occurrence, p.index, p.prevPoleId, p.nextPoleId])).toEqual([['A', 0, 1, 'T', 'B'], ['A', 1, 3, 'B', 'C']]);
    const patch = setSplitConsumerSide(c, 'A', 1, 'next');
    expect(patch.splitConsumerSides).toEqual({ 'A#1': 'next' });
    // adding another visit of A renumbers the visits: the choice is dropped (must be made again), not moved
    expect(pruneSplitSides({ ...c, ...patch }, { ...c, ...patch, poleIds: ['T', 'A', 'B', 'A', 'C', 'A', 'D'] }).splitConsumerSides).toBeUndefined();
  });
});
