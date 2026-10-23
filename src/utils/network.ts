import type { CableArcElement, CableElement, ConsumerElement, DrawingElement, SymbolElement } from '../types/drawing';
import { occurrenceIndex } from './cableArcs';
import { consumerLoad } from './loads';
import { splitSideKey, type SplitSide } from './splitStudy';

// ---------------------------------------------------------------------------
// Electrical topology of the drawing — a calculation layer only; it reads the
// drawing and changes nothing.
//
// Connection rules (what counts as electrically connected):
//   - along a cable: each span joins the cable's consecutive poles;
//   - at a pole, a cable that passes through is one connection point;
//   - at an ordinary pole, two cables are joined only when the drawing shows a
//     junction there: they have the same colour (the circuit) AND at least one of
//     them starts or ends at that pole (a branch drawn from a trunk pole, or a
//     cable continued by another one). Colour alone is not enough: two cables of
//     the same colour that both run through the pole cross without being joined
//     (warning "same-colour-crossing"; a Jumper joins them if they really are).
//     A cable ending where two or more same-colour cables run through cannot be
//     attributed to one of them → the network is "ambiguous" (not computed);
//     sharing a pole never joins different colours;
//   - a Jumper (cable_arc) joins the two cable ends it links at its pole,
//     whatever their colours;
//   - at a transformer, the cables that start or end there are fed from it (its
//     busbar). A cable that only runs THROUGH the transformer pole is not taken as
//     fed by it — the drawing does not say whether it is — so its network is
//     "ambiguous" until the user marks the transformer as the source (then the
//     user's choice applies) or draws the cable as ending there;
//   - at a pole the user chose as source, every cable at it is fed (explicit choice);
//   - each cable end can be set by the user (Stage 7.9, CableElement.endLinks):
//     'auto' (no setting) = the rules above; 'connected' = the same rules, the
//     junction is confirmed (it is not listed for review); 'isolated' = that end
//     is joined to nothing at its pole (not even a transformer / source pole).
//     A Jumper drawn on an isolated end still links it (it names both ends
//     explicitly) and is reported. Junctions made by the 'auto' rule are listed
//     (inferredJunctions) so they can be reviewed;
//   - pole-to-pole links read from version 2 files are not used (their meaning
//     is not defined) — reported as a warning;
//   - voltage-drop study with suggested split points (option studySplits, from
//     ElectricalSettings.studySuggestedSplits; off by default): at a suggested split
//     at an INTERIOR pole of a cable (CableElement.suggestedSplits, each visit of the
//     pole) the cable's two sides are separate. The side chosen in
//     splitConsumerSides keeps that connection point (consumers and the joins above,
//     unchanged); the other side is an open end there, joined only by a Jumper that
//     names that side. No side chosen: both sides are open; if anything at that pole
//     could belong to one of them (a consumer or a cable of its colour, a transformer,
//     a chosen source) the network is not computed (split-side-unassigned) — nothing
//     is guessed. Suggestions at a cable's first / last pole are not used here.
//
// Supply of a connected network:
//   - a pole the user marked as source wins (transformers inside the network are
//     then ordinary poles, with a warning); two marked sources → not computed;
//   - otherwise its only transformer; none → "no source"; more than one → not
//     computed (the user must choose; transformers are never merged into one
//     source automatically).
// A network that is not a tree from its source (a loop, or two same-colour
// cables between the same two poles) is not computed: it is reported instead.
// ---------------------------------------------------------------------------

export type CircuitStatus = 'ok' | 'no-source' | 'multiple-sources' | 'multiple-transformers' | 'non-radial' | 'ambiguous';

export type NetworkIssue =
  | { kind: 'parallel-spans'; poles: [string, string]; cableIds: string[] }
  | { kind: 'loop'; poleIds: string[] }
  | { kind: 'transformer-not-source'; poleId: string }
  | { kind: 'orphan-consumer'; consumerId: string; poleId: string; color: string }
  | { kind: 'legacy-jumper'; elementId: string }
  | { kind: 'missing-pole'; cableId: string; poleId: string }
  | { kind: 'passes-source-pole'; poleId: string; cableId: string }
  | { kind: 'same-colour-crossing'; poleId: string; cableIds: string[] }
  | { kind: 'ambiguous-junction'; poleId: string; cableIds: string[] }
  | { kind: 'invalid-load'; consumerId: string; poleId: string; label: string }
  | { kind: 'isolated-end-jumpered'; poleId: string; cableId: string }
  | { kind: 'connected-end-alone'; poleId: string; cableId: string }
  | { kind: 'three-phase-on-single-phase'; spanKey: string }
  | { kind: 'split-side-unassigned'; poleId: string; cableId: string; occurrence: number };

/** A junction the 'auto' rule made: a cable end joined to same-colour cables at a pole. */
export interface InferredJunction {
  poleId: string;
  cableId: string;
  end: 'start' | 'end';
  /** the other cables it was joined to there */
  withCableIds: string[];
}

/** One span as used by the calculation, oriented away from the source. */
export interface NetSpan {
  cableId: string;
  /** span index in the cable (poleIds[index] → poleIds[index + 1]) */
  index: number;
  spanId: string | undefined;
  /** upstream pole / downstream pole */
  fromPole: string;
  toPole: string;
  fromBus: string;
  toBus: string;
  color: string;
}

export interface BusLoad {
  /** single-phase current (phase unknown), A */
  single: number;
  /** balanced three-phase current, A per phase */
  three: number;
  consumerIds: string[];
  /** subscribers whose load value is not valid (not counted; makes the result not computable) */
  invalidConsumerIds: string[];
}

export interface Circuit {
  id: string;
  status: CircuitStatus;
  sourcePoleId?: string;
  sourceKind?: 'manual' | 'transformer';
  sourceBus?: string;
  /** buses of the network; for an 'ok' circuit in order from the source */
  buses: string[];
  /** spans; for an 'ok' circuit in order from the source, each oriented downstream */
  spans: NetSpan[];
  /** for 'ok': bus → index in spans of the span that feeds it */
  feedSpan: Map<string, number>;
  /** load connected at each bus */
  busLoad: Map<string, BusLoad>;
  /** for 'ok': load supplied through each span (everything downstream of it) */
  downstream: BusLoad[];
  issues: NetworkIssue[];
  poleIds: Set<string>;
  colors: Set<string>;
  /** junctions of this network made by the 'auto' rule (to review) */
  inferredJunctions: InferredJunction[];
}

export interface Network {
  circuits: Circuit[];
  /** bus of every connection point: `${cableId}#${index}` → bus id */
  busOfTerminal: Map<string, string>;
  /** pole of every bus */
  poleOfBus: Map<string, string>;
  /** circuit of every bus */
  circuitOfBus: Map<string, Circuit>;
  /** consumer → its bus (null: no cable of its colour at its pole) */
  consumerBus: Map<string, string | null>;
  issues: NetworkIssue[];
  /** every junction made by the 'auto' rule */
  inferredJunctions: InferredJunction[];
}

export const normColor = (c: string | undefined) => (c || '#000000').trim().toLowerCase();
export const terminalKey = (cableId: string, index: number) => `${cableId}#${index}`;
const isTransformer = (p: SymbolElement) => p.symbolId === 'transformer';

class DSU {
  private parent = new Map<string, string>();
  add(x: string) { if (!this.parent.has(x)) this.parent.set(x, x); }
  find(x: string): string {
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = x;
    while (c !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(rb < ra ? ra : rb, rb < ra ? rb : ra); }
}

export interface BuildNetworkOptions {
  /** calculate the suggested split points at interior poles as open points (the study) */
  studySplits?: boolean;
}

export const buildNetwork = (elements: DrawingElement[], opts: BuildNetworkOptions = {}): Network => {
  const poles = new Map<string, SymbolElement>();
  for (const e of elements) if (e.type === 'symbol') poles.set(e.id, e);
  const cables = elements.filter((e): e is CableElement => e.type === 'cable');
  const consumers = elements.filter((e): e is ConsumerElement => e.type === 'consumer');

  // study split points: cable → index in poleIds → side kept at the pole (null: not chosen)
  const splitAt = new Map<string, Map<number, SplitSide | null>>();
  if (opts.studySplits) for (const c of cables) {
    const ids = new Set(c.suggestedSplits ?? []);
    if (!ids.size) continue;
    const seen = new Map<string, number>();
    c.poleIds.forEach((pid, i) => {
      const occ = seen.get(pid) ?? 0; seen.set(pid, occ + 1);
      if (!ids.has(pid) || i === 0 || i === c.poleIds.length - 1) return;
      const m = splitAt.get(c.id) ?? new Map<number, SplitSide | null>();
      m.set(i, c.splitConsumerSides?.[splitSideKey(pid, occ)] ?? null);
      splitAt.set(c.id, m);
    });
  }
  /** connection point of one side of a pole visit: the visit's own one, or the open end of a split side */
  const keyAt = (cableId: string, i: number, side: SplitSide) => {
    const m = splitAt.get(cableId);
    if (!m || !m.has(i)) return terminalKey(cableId, i);
    return m.get(i) === side ? terminalKey(cableId, i) : `${terminalKey(cableId, i)}~${side}`;
  };
  const openEnds: { key: string; poleId: string }[] = [];
  const unassigned: { poleId: string; cable: CableElement; index: number; occurrence: number }[] = [];
  const issues: NetworkIssue[] = [];
  const dsu = new DSU();
  type Terminal = { key: string; color: string; cableId: string; isEnd: boolean; side?: 'start' | 'end'; link?: 'connected' | 'isolated' };
  const terminalsAtPole = new Map<string, Terminal[]>();
  const inferred: { key: string; j: InferredJunction }[] = [];
  // issues that make the network they belong to not computable, by connection point
  const blocking: { key: string; issue: NetworkIssue }[] = [];
  const warnings: { key: string; issue: NetworkIssue }[] = [];

  // connection points
  for (const c of cables) {
    const occ = new Map<string, number>();
    c.poleIds.forEach((pid, i) => {
      const occurrence = occ.get(pid) ?? 0; occ.set(pid, occurrence + 1);
      if (!poles.has(pid)) { issues.push({ kind: 'missing-pole', cableId: c.id, poleId: pid }); return; }
      const key = terminalKey(c.id, i);
      const split = splitAt.get(c.id);
      if (split?.has(i)) {
        // study split: the side not kept is an open end at this pole (not a connection point of the pole)
        const kept = split.get(i);
        for (const side of ['prev', 'next'] as const) if (side !== kept) { const k = keyAt(c.id, i, side); dsu.add(k); openEnds.push({ key: k, poleId: pid }); }
        if (!kept) { unassigned.push({ poleId: pid, cable: c, index: i, occurrence }); return; }
      }
      dsu.add(key);
      const list = terminalsAtPole.get(pid) ?? [];
      const isEnd = i === 0 || i === c.poleIds.length - 1;
      const side = i === 0 ? 'start' : i === c.poleIds.length - 1 ? 'end' : undefined;
      const link = i === 0 ? (c.endLinks?.start ?? (c.poleIds.length === 1 ? c.endLinks?.end : undefined)) : i === c.poleIds.length - 1 ? c.endLinks?.end : undefined;
      list.push({ key, color: normColor(c.strokeColor), cableId: c.id, isEnd, side, link });
      terminalsAtPole.set(pid, list);
    });
  }
  // a split without a chosen side: not computed when something at the pole could belong to either side
  for (const u of unassigned) {
    const pole = poles.get(u.poleId)!;
    const color = normColor(u.cable.strokeColor);
    const matters = isTransformer(pole) || !!pole.modifiers?.vdSource
      || (terminalsAtPole.get(u.poleId) ?? []).some((t) => t.color === color)
      || consumers.some((x) => x.poleId === u.poleId && normColor(x.color) === color);
    if (matters) for (const side of ['prev', 'next'] as const)
      blocking.push({ key: keyAt(u.cable.id, u.index, side), issue: { kind: 'split-side-unassigned', poleId: u.poleId, cableId: u.cable.id, occurrence: u.occurrence } });
  }

  // joins at poles (see the rules above)
  for (const [pid, all] of terminalsAtPole) {
    const pole = poles.get(pid)!;
    // an isolated end is joined to nothing here
    const list = all.filter((t) => t.link !== 'isolated');
    if (pole.modifiers?.vdSource) { for (let i = 1; i < list.length; i++) dsu.union(list[0].key, list[i].key); continue; }
    if (isTransformer(pole)) {
      const ends = list.filter((t) => t.isEnd);
      for (let i = 1; i < ends.length; i++) dsu.union(ends[0].key, ends[i].key);
      for (const t of list) if (!t.isEnd) blocking.push({ key: t.key, issue: { kind: 'passes-source-pole', poleId: pid, cableId: t.cableId } });
      continue;
    }
    const byColor = new Map<string, typeof list>();
    for (const t of list) byColor.set(t.color, [...(byColor.get(t.color) ?? []), t]);
    for (const group of byColor.values()) {
      if (group.length < 2) {
        if (group.length === 1 && group[0].link === 'connected' && new Set(all.filter((x) => x.color === group[0].color).map((x) => x.cableId)).size < 2)
          warnings.push({ key: group[0].key, issue: { kind: 'connected-end-alone', poleId: pid, cableId: group[0].cableId } });
        continue;
      }
      const ends = group.filter((t) => t.isEnd), through = group.filter((t) => !t.isEnd);
      if (!ends.length) {
        // same colour, all running through: crossing, not joined
        if (new Set(through.map((t) => t.cableId)).size > 1)
          for (const t of through) warnings.push({ key: t.key, issue: { kind: 'same-colour-crossing', poleId: pid, cableIds: [...new Set(through.map((x) => x.cableId))] } });
        continue;
      }
      for (let i = 1; i < ends.length; i++) dsu.union(ends[0].key, ends[i].key);
      if (new Set(through.map((t) => t.cableId)).size > 1) {
        // an end meets several through-cables of its colour: which one feeds it is not known
        for (const t of group) blocking.push({ key: t.key, issue: { kind: 'ambiguous-junction', poleId: pid, cableIds: [...new Set(group.map((x) => x.cableId))] } });
        continue;
      }
      for (const t of through) dsu.union(ends[0].key, t.key);
      // junctions made by the rule (not confirmed by the user): listed for review
      const cablesHere = [...new Set(group.map((x) => x.cableId))];
      if (cablesHere.length > 1) for (const t of ends) if (t.link === undefined)
        inferred.push({ key: t.key, j: { poleId: pid, cableId: t.cableId, end: t.side!, withCableIds: cablesHere.filter((c) => c !== t.cableId) } });
    }
  }
  // jumpers
  const cableById = new Map(cables.map((c) => [c.id, c]));
  for (const e of elements) {
    if (e.type === 'jumper') { issues.push({ kind: 'legacy-jumper', elementId: e.id }); continue; }
    if (e.type !== 'cable_arc') continue;
    const arc = e as CableArcElement;
    const ends = [arc.from, arc.to].map((end) => {
      const c = cableById.get(end.cableId);
      const i = c ? occurrenceIndex(c, arc.poleId, end.occurrence) : -1;
      // the side the Jumper names (the same point unless the visit is a study split)
      return c && i >= 0 && poles.has(arc.poleId) ? keyAt(c.id, i, end.side) : null;
    });
    if (ends[0] && ends[1]) {
      dsu.union(ends[0], ends[1]);
      for (const k of ends) {
        const t = terminalsAtPole.get(arc.poleId)?.find((x) => x.key === k);
        if (t?.link === 'isolated') warnings.push({ key: k, issue: { kind: 'isolated-end-jumpered', poleId: arc.poleId, cableId: t.cableId } });
      }
    }
  }

  const busOfTerminal = new Map<string, string>();
  const poleOfBus = new Map<string, string>();
  const liveBus = new Set<string>(); // buses with at least one connection point that is not isolated
  for (const [pid, list] of terminalsAtPole) for (const t of list) {
    const b = dsu.find(t.key);
    busOfTerminal.set(t.key, b);
    poleOfBus.set(b, pid);
    if (t.link !== 'isolated') liveBus.add(b);
  }
  // open ends of study splits: at their pole, but never a supply there
  for (const o of openEnds) {
    const b = dsu.find(o.key);
    busOfTerminal.set(o.key, b);
    if (!poleOfBus.has(b)) poleOfBus.set(b, o.poleId);
  }

  // spans (edges)
  interface Edge { cable: CableElement; index: number; a: string; b: string; busA: string; busB: string }
  const edges: Edge[] = [];
  for (const c of cables) {
    for (let i = 0; i < c.poleIds.length - 1; i++) {
      const ka = keyAt(c.id, i, 'next'), kb = keyAt(c.id, i + 1, 'prev');
      const busA = busOfTerminal.get(ka), busB = busOfTerminal.get(kb);
      if (!busA || !busB || busA === busB) continue;
      edges.push({ cable: c, index: i, a: c.poleIds[i], b: c.poleIds[i + 1], busA, busB });
    }
  }
  const adj = new Map<string, number[]>();
  const addAdj = (bus: string, ei: number) => { const l = adj.get(bus) ?? []; l.push(ei); adj.set(bus, l); };
  edges.forEach((e, ei) => { addAdj(e.busA, ei); addAdj(e.busB, ei); });
  for (const b of poleOfBus.keys()) if (!adj.has(b)) adj.set(b, []);

  // consumers → buses
  const consumerBus = new Map<string, string | null>();
  for (const cons of consumers) {
    const list = terminalsAtPole.get(cons.poleId) ?? [];
    const t = list.find((x) => x.color === normColor(cons.color));
    const bus = t ? busOfTerminal.get(t.key)! : null;
    consumerBus.set(cons.id, bus);
    if (!bus) issues.push({ kind: 'orphan-consumer', consumerId: cons.id, poleId: cons.poleId, color: cons.color });
  }
  const loadAt = new Map<string, BusLoad>();
  for (const cons of consumers) {
    const bus = consumerBus.get(cons.id);
    if (!bus) continue;
    const l = consumerLoad(cons);
    const bl = loadAt.get(bus) ?? { single: 0, three: 0, consumerIds: [], invalidConsumerIds: [] };
    if (l.invalid) {
      bl.invalidConsumerIds.push(cons.id);
      issues.push({ kind: 'invalid-load', consumerId: cons.id, poleId: cons.poleId, label: `${cons.label ?? ''}${l.invalid === 'count' ? ` ×${cons.count}` : ''}` });
    } else if (l.kind === 'single') bl.single += l.amps; else bl.three += l.amps;
    bl.consumerIds.push(cons.id);
    loadAt.set(bus, bl);
  }

  // connected networks
  const circuits: Circuit[] = [];
  const circuitOfBus = new Map<string, Circuit>();
  const seen = new Set<string>();
  const busesSorted = [...adj.keys()].sort();
  for (const start of busesSorted) {
    if (seen.has(start)) continue;
    const compBuses: string[] = [];
    const compEdges = new Set<number>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const b = stack.pop()!;
      compBuses.push(b);
      for (const ei of adj.get(b)!) {
        compEdges.add(ei);
        const e = edges[ei];
        const o = e.busA === b ? e.busB : e.busA;
        if (!seen.has(o)) { seen.add(o); stack.push(o); }
      }
    }
    const compPoles = new Set(compBuses.map((b) => poleOfBus.get(b)!));
    const edgeList = [...compEdges].sort((x, y) => x - y);
    const colors = new Set(edgeList.map((ei) => normColor(edges[ei].cable.strokeColor)));
    if (!edgeList.length) colors.clear();
    const circuit: Circuit = {
      id: `net:${start}`, status: 'ok', buses: compBuses, spans: [], feedSpan: new Map(), busLoad: new Map(),
      downstream: [], issues: [], poleIds: compPoles, colors, inferredJunctions: [],
    };
    for (const b of compBuses) { circuitOfBus.set(b, circuit); const l = loadAt.get(b); if (l) circuit.busLoad.set(b, l); }
    const inComp = new Set(compBuses);
    const seenIssue = new Set<string>();
    const addOnce = (i: NetworkIssue) => { const k = JSON.stringify(i); if (!seenIssue.has(k)) { seenIssue.add(k); circuit.issues.push(i); } };
    let ambiguous = false;
    for (const x of blocking) if (inComp.has(busOfTerminal.get(x.key)!)) { addOnce(x.issue); ambiguous = true; }
    for (const x of warnings) if (inComp.has(busOfTerminal.get(x.key)!)) addOnce(x.issue);
    for (const x of inferred) if (inComp.has(busOfTerminal.get(x.key)!)) circuit.inferredJunctions.push(x.j);
    const toSpan = (e: Edge, fromBus: string): NetSpan => {
      const forward = e.busA === fromBus;
      return {
        cableId: e.cable.id, index: e.index, spanId: e.cable.spanIds?.[e.index],
        fromPole: forward ? e.a : e.b, toPole: forward ? e.b : e.a,
        fromBus: forward ? e.busA : e.busB, toBus: forward ? e.busB : e.busA,
        color: e.cable.strokeColor,
      };
    };

    // source
    const sortedPoles = [...compPoles].sort();
    // a supply pole counts for this network only through a connection point that is
    // not isolated there (an isolated end at a transformer is not fed by it)
    const supplyHere = (p: string) => compBuses.some((b) => poleOfBus.get(b) === p && liveBus.has(b));
    const manual = sortedPoles.filter((p) => poles.get(p)!.modifiers?.vdSource && supplyHere(p));
    const transformers = sortedPoles.filter((p) => isTransformer(poles.get(p)!) && supplyHere(p));
    let sourcePole: string | undefined;
    if (manual.length > 1) circuit.status = 'multiple-sources';
    else if (manual.length === 1) {
      sourcePole = manual[0]; circuit.sourceKind = 'manual';
      for (const t of transformers) if (t !== sourcePole) circuit.issues.push({ kind: 'transformer-not-source', poleId: t });
    } else if (transformers.length === 1) { sourcePole = transformers[0]; circuit.sourceKind = 'transformer'; }
    else if (transformers.length > 1) circuit.status = 'multiple-transformers';
    else circuit.status = 'no-source';
    if (sourcePole) circuit.sourcePoleId = sourcePole;
    if (ambiguous && circuit.status === 'ok') circuit.status = 'ambiguous';

    // radial check (a tree has one span fewer than buses)
    if (edgeList.length > compBuses.length - 1) {
      const byPair = new Map<string, Edge[]>();
      for (const ei of edgeList) {
        const e = edges[ei];
        const k = [e.busA, e.busB].sort().join('|');
        byPair.set(k, [...(byPair.get(k) ?? []), e]);
      }
      let parallel = 0;
      for (const list of byPair.values()) if (list.length > 1) {
        parallel += list.length - 1;
        circuit.issues.push({ kind: 'parallel-spans', poles: [list[0].a, list[0].b].sort() as [string, string], cableIds: [...new Set(list.map((e) => e.cable.id))] });
      }
      if (edgeList.length - parallel > compBuses.length - 1) circuit.issues.push({ kind: 'loop', poleIds: sortedPoles });
      if (circuit.status === 'ok') circuit.status = 'non-radial';
    }

    if (circuit.status === 'ok' && sourcePole) {
      // tree from the source bus
      const src = compBuses.find((b) => poleOfBus.get(b) === sourcePole && liveBus.has(b))!;
      circuit.sourceBus = src;
      const order: string[] = [src];
      const visited = new Set([src]);
      for (let qi = 0; qi < order.length; qi++) {
        const b = order[qi];
        for (const ei of [...adj.get(b)!].sort((x, y) => x - y)) {
          const e = edges[ei];
          const o = e.busA === b ? e.busB : e.busA;
          if (visited.has(o)) continue;
          visited.add(o);
          order.push(o);
          circuit.feedSpan.set(o, circuit.spans.length);
          circuit.spans.push(toSpan(e, b));
        }
      }
      circuit.buses = order;
      // load downstream of each span (children first)
      const sub = new Map<string, BusLoad>();
      for (let i = order.length - 1; i >= 0; i--) {
        const b = order[i];
        const own = circuit.busLoad.get(b);
        const acc = sub.get(b) ?? { single: 0, three: 0, consumerIds: [], invalidConsumerIds: [] };
        if (own) { acc.single += own.single; acc.three += own.three; acc.consumerIds = [...own.consumerIds, ...acc.consumerIds]; acc.invalidConsumerIds = [...own.invalidConsumerIds, ...acc.invalidConsumerIds]; }
        sub.set(b, acc);
        const fi = circuit.feedSpan.get(b);
        if (fi !== undefined) {
          const parent = circuit.spans[fi].fromBus;
          const pacc = sub.get(parent) ?? { single: 0, three: 0, consumerIds: [], invalidConsumerIds: [] };
          pacc.single += acc.single; pacc.three += acc.three; pacc.consumerIds = [...pacc.consumerIds, ...acc.consumerIds]; pacc.invalidConsumerIds = [...pacc.invalidConsumerIds, ...acc.invalidConsumerIds];
          sub.set(parent, pacc);
        }
      }
      circuit.downstream = circuit.spans.map((s) => sub.get(s.toBus)!);
    } else {
      circuit.spans = edgeList.map((ei) => toSpan(edges[ei], edges[ei].busA));
    }
    // a lone connection point (a cable with a single pole) is not a network
    if (edgeList.length || circuit.busLoad.size) circuits.push(circuit);
  }

  return { circuits, busOfTerminal, poleOfBus, circuitOfBus, consumerBus, issues, inferredJunctions: inferred.map((x) => x.j) };
};
