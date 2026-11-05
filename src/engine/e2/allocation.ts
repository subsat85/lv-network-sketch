// E2: the Single-Phase Load Allocation Method (a project setting, ElectricalSettings.singlePhaseMode).
//
// The drawing stores no phase for a single-phase subscriber. This module builds the E2 input that
// says which phase each one is on — the PhaseAllocation the engine already takes (phases.ts) —
// from the method the project chose. It computes no electrical value and changes no equation:
// the sweep (sweep.ts) solves the network with this allocation exactly as with any other.
//
// Common rules (both methods):
//   - a single-phase subscriber with `count` = n is placed unit by unit (one subscriber = one unit);
//     the counts on a, b and c always add up to n — no load is lost or counted twice;
//   - three-phase subscribers are not allocated (their load is on the three phases, unchanged);
//   - everything fed through a single-phase span (1ph2w) must sit on that span's phase: the whole
//     single-phase branch below its upstream-most 1ph2w span is ONE block that takes one phase;
//   - a subscriber whose load is not valid is left without a phase (E2 already refuses it);
//   - the allocation is marked 'unverified' (it is a method, not the distribution on site), so
//     every result it reaches is provisional ('allocation-unverified'), with the method named.
//
// Worst Case ('worst'): the phases worstCase.ts chose for each unit and block (all on phase a when
//   no chooser is given). Criterion: the highest phase-to-neutral drop (%) at any node of the circuit.
//   All on one phase is the worst only when the condition of worstCase.ts holds on every span the
//   single-phase loads use (Re((Zp+ZN)e^{-jφ}) ≥ Re(ZN e^{-jφ} e^{∓j120°})); for very reactive spans at
//   a high power factor it does not (a mixed distribution can be worse), and worstCase.ts then checks
//   every distribution, or searches and says that no guarantee is available.
//
// Equal Phase Current ('balanced'): the units (and blocks) are taken from the one farthest from the
//   source (path length, then number of spans) to the nearest; each is put on the phase whose nominal
//   current, summed over every span from it to the source, is the lowest so far (ties: a, then b, then c).
//   So the nominal currents are balanced on every span, not only in total: a branch with three
//   subscribers gets one on each phase, and the currents of the branches add up span by span.

import type { ElectricalSettings } from '../../types/drawing';
import { toNetwork } from '../adapter';
import type { ProjectDocument } from '../model';
import { PHASES, type AllocationSource, type Phase, type PhaseAllocation } from './phases';

export type AllocationMethod = ElectricalSettings['singlePhaseMode'];
/** the allocation source each method writes (phases.ts) */
export const METHOD_SOURCE: Record<AllocationMethod, AllocationSource> = { worst: 'method-worst-case', balanced: 'method-equal-current' };
const UNVERIFIED = { status: 'unverified' as const };

/** one unit of single-phase load to place (a subscriber, or a whole single-phase branch) */
export interface AllocationItem {
  /** the consumers (and how many of their units) the item carries */
  members: { consumerId: string; units: number }[];
  /** nominal current of the item, A */
  amps: number;
  /** span keys from the item up to the source */
  path: string[];
  /** a single-phase branch: its upstream-most 1ph2w span */
  blockSpan?: string;
  distanceM: number;
  hops: number;
  order: number;
}
type Unit = AllocationItem;
/** Worst Case: the phase of each item of a circuit (in the items' order); all on a when not given */
export type WorstCaseChooser = (circuitId: string, items: readonly AllocationItem[]) => readonly Phase[];

/** The PhaseAllocation of a document for a method (read only; nothing is written). */
export const allocateSinglePhase = (doc: ProjectDocument, settings: ElectricalSettings, method: AllocationMethod, choose?: WorstCaseChooser): PhaseAllocation => {
  const { network } = toNetwork(doc, settings);
  const source = METHOD_SOURCE[method];
  const consumers: PhaseAllocation['consumers'] = {};
  const singlePhaseSpans: PhaseAllocation['singlePhaseSpans'] = {};

  for (const c of network.circuits) {
    // the span feeding each bus (an 'ok' circuit's branches are oriented from the source)
    const feed = new Map(c.branches.map((b) => [b.toBus, b]));
    const pathOf = (bus: string): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (let b = feed.get(bus); b && !seen.has(b.key); b = feed.get(b.fromBus)) { seen.add(b.key); out.push(b.key); }
      return out;
    };
    const branchByKey = new Map(c.branches.map((b) => [b.key, b]));
    const distOf = (path: string[]) => path.reduce((m, k) => m + (branchByKey.get(k)?.lengthM.value ?? 0), 0);
    /** the upstream-most 1ph2w span on a path, if any */
    const blockOf = (path: string[]): string | undefined => {
      let top: string | undefined;
      for (const k of path) if (branchByKey.get(k)?.system.value === '1ph2w') top = k;
      return top;
    };

    const items: Unit[] = [];
    const blocks = new Map<string, Unit>();
    let order = 0;
    for (const bus of c.buses) {
      const path = pathOf(bus.id);
      const block = blockOf(path);
      for (const l of bus.loads) {
        if (l.kind !== 'single' || l.amps.status === 'invalid' || l.amps.value === undefined) continue;
        const each = l.ampsEach.value ?? 0;
        if (block) {
          let b = blocks.get(block);
          if (!b) {
            const up = path.slice(path.indexOf(block));
            b = { members: [], amps: 0, path: up, blockSpan: block, distanceM: distOf(path), hops: path.length, order: order++ };
            blocks.set(block, b);
            items.push(b);
          }
          b.members.push({ consumerId: l.consumerId, units: l.count });
          b.amps += l.count * each;
          b.distanceM = Math.max(b.distanceM, distOf(path));
          b.hops = Math.max(b.hops, path.length);
        } else {
          for (let u = 0; u < l.count; u++) items.push({ members: [{ consumerId: l.consumerId, units: 1 }], amps: each, path, distanceM: distOf(path), hops: path.length, order: order++ });
        }
      }
    }
    // the 1ph2w spans of the circuit: every one below a block takes the block's phase (set below);
    // a 1ph2w span with no subscriber behind it carries no current: it is given phase a (any phase
    // gives the same result)
    const counts = new Map<string, Record<Phase, number>>();
    const put = (it: Unit, p: Phase) => {
      for (const m of it.members) {
        const r = counts.get(m.consumerId) ?? { a: 0, b: 0, c: 0 };
        r[p] += m.units;
        counts.set(m.consumerId, r);
      }
      if (it.blockSpan) for (const br of c.branches) if (br.system.value === '1ph2w' && blockOf(pathOf(br.toBus)) === it.blockSpan) singlePhaseSpans[br.key] = { phase: p, source, verification: UNVERIFIED };
    };

    if (method === 'worst') {
      // all on phase a, or the phases the Worst Case search chose (worstCase.ts)
      const phases = choose ? choose(c.id, items) : undefined;
      items.forEach((it, i) => put(it, phases?.[i] ?? 'a'));
    } else {
      const cur = new Map<string, Record<Phase, number>>(c.branches.map((b) => [b.key, { a: 0, b: 0, c: 0 }]));
      const sorted = [...items].sort((x, y) => y.distanceM - x.distanceM || y.hops - x.hops || x.order - y.order);
      for (const it of sorted) {
        let best: Phase = 'a', bestCost = Infinity;
        for (const p of PHASES) {
          const cost = it.path.reduce((s, k) => s + (cur.get(k)?.[p] ?? 0), 0);
          if (cost < bestCost - 1e-9) { best = p; bestCost = cost; }
        }
        for (const k of it.path) cur.get(k)![best] += it.amps;
        put(it, best);
      }
    }
    for (const br of c.branches) if (br.system.value === '1ph2w' && !singlePhaseSpans[br.key]) singlePhaseSpans[br.key] = { phase: 'a', source, verification: UNVERIFIED };
    for (const [id, r] of counts) consumers[id] = { ...r, source, verification: UNVERIFIED };
  }
  return { consumers, singlePhaseSpans };
};
