// E2: Worst Case — the phase distribution of the single-phase subscribers with the highest
// phase-to-neutral drop (%) at any node of a circuit, and how sure that is.
//
// Nothing here changes an equation: every distribution is evaluated by E2 itself (build.ts and
// sweep.ts, exactly as for any other allocation). This module only decides which allocation input
// to give it, and says how the worst one was found:
//
//   'condition'  — the condition below holds on every span the single-phase loads use: putting all
//                  of them on one phase is the worst distribution (one E2 run).
//   'exhaustive' — the condition does not hold, and the circuit is small enough: every possible
//                  distribution was evaluated with E2; the highest one is used (exact).
//   'searched'   — the condition does not hold and the circuit is too large to enumerate: the best
//                  found by a search (the linear-model optimum for each node, then improving moves,
//                  every step evaluated with E2). The worst is NOT guaranteed; the results say so.
//   'not-needed' — nothing to choose (no single-phase load, or the circuit cannot be calculated).
//
// The condition (linear model of the sweep, ideal symmetric source; phase angle φ = acos pf):
// a unit of current on the phase p being checked lowers |Vpn| by Re((Zp + ZN)·e^{−jφ}) on each span
// it shares with the node; a unit on another phase changes it through the neutral by
// Re(ZN·e^{−jφ}·e^{∓j120°}). When, on every span,
//     Re((Zp + ZN)·e^{−jφ}) ≥ max(Re(ZN·e^{−jφ}·e^{−j120°}), Re(ZN·e^{−jφ}·e^{+j120°})),
// every unit adds the most to the drop of phase p when it is on p itself, at every node at once:
// all of them on one phase is the worst distribution (the three phases are equivalent by symmetry).
// With equal angles for Zp and ZN this is tan(∠Z − φ) ≤ (1 + 1.5k) / (0.866 k), k = |ZN| / |Zp|:
// at least 60° for any k, about 71° for k = 1 (the final review found the first counter-example at 72°).

import type { ElectricalSettings } from '../../types/drawing';
import type { ProjectDocument } from '../model';
import { allocateSinglePhase, type AllocationItem } from './allocation';
import { mul, polar, add } from './complex';
import type { CircuitResult, E2Circuit, SolveSettings } from './model';
import type { Phase, PhaseAllocation } from './phases';
import { solveCircuit } from './sweep';

export type WorstCaseGuarantee = 'condition' | 'exhaustive' | 'searched' | 'not-needed';
export interface WorstCaseCheck { guarantee: WorstCaseGuarantee; /** E2 runs used to decide */ evaluations: number }

/** at most this many distributions are enumerated (exhaustive); larger circuits are searched */
export const WORST_CASE_EXHAUSTIVE_LIMIT = 729;
/** at most this many E2 runs per circuit for the search */
export const WORST_CASE_SEARCH_LIMIT = 300;

const ROT: Record<Phase, number> = { a: 0, b: -120, c: 120 };
const P3: readonly Phase[] = ['a', 'b', 'c'];
const worstOf = (r: CircuitResult): number => {
  let w = -Infinity;
  for (const n of r.nodes) for (const p of P3) { const q = n.dropPercent[p]; if (q.value !== undefined && q.value > w) w = q.value; }
  return w;
};

/**
 * The Worst Case allocation of a document: for each circuit, the phases of its single-phase items,
 * and how the worst was found. `build` gives E2's circuits for an allocation (build.ts).
 */
export const worstCaseAllocation = (
  doc: ProjectDocument, settings: ElectricalSettings, build: (a: PhaseAllocation) => E2Circuit[], solve: SolveSettings,
  limits: { exhaustive: number; search: number } = { exhaustive: WORST_CASE_EXHAUSTIVE_LIMIT, search: WORST_CASE_SEARCH_LIMIT },
): { allocation: PhaseAllocation; checks: Record<string, WorstCaseCheck> } => {
  // the items of each circuit (subscriber units and single-phase branches), in the allocation's order
  const itemsOf = new Map<string, readonly AllocationItem[]>();
  allocateSinglePhase(doc, settings, 'worst', (id, items) => { itemsOf.set(id, items); return items.map(() => 'a' as const); });
  const chosen = new Map<string, Phase[]>();
  const allocationWith = (over?: { id: string; phases: readonly Phase[] }) =>
    allocateSinglePhase(doc, settings, 'worst', (id, items) => (over && id === over.id ? over.phases : chosen.get(id) ?? items.map(() => 'a' as const)));
  const base = build(allocationWith());
  const checks: Record<string, WorstCaseCheck> = {};
  const phi = Math.acos(solve.pf);
  const rot = (p: Phase) => polar(1, (ROT[p] * Math.PI) / 180 - phi);

  for (const circuit of base) {
    const items = itemsOf.get(circuit.id) ?? [];
    const first = solveCircuit(circuit, solve);
    if (!items.length || first.solve.status === 'not-run' || first.solve.status === 'unavailable') { checks[circuit.id] = { guarantee: 'not-needed', evaluations: 1 }; continue; }
    const spans = new Map(circuit.spans.map((s) => [s.key, s]));
    const used = new Set(items.flatMap((it) => it.path));
    // the condition, on every span the single-phase loads use
    const holds = [...used].every((k) => {
      const s = spans.get(k);
      const zp = s?.zPhase.z, zn = s?.zNeutral.z;
      if (!zp || !zn) return true; // no neutral needed / no current: nothing to compare
      const same = mul(add(zp, zn), rot('a')).re;
      return same >= Math.max(mul(zn, rot('b')).re, mul(zn, rot('c')).re) - 1e-12;
    });
    if (holds) { checks[circuit.id] = { guarantee: 'condition', evaluations: 1 }; continue; }

    // evaluate a distribution of this circuit with E2
    let evaluations = 1;
    const evaluate = (phases: readonly Phase[]): number => {
      evaluations++;
      const c = build(allocationWith({ id: circuit.id, phases })).find((x) => x.id === circuit.id);
      return c ? worstOf(solveCircuit(c, solve)) : -Infinity;
    };
    let best = { phases: items.map(() => 'a' as Phase), w: worstOf(first) };
    const consider = (phases: Phase[]) => { const w = evaluate(phases); if (w > best.w + 1e-12) best = { phases, w }; };

    // groups: the units of one subscriber (interchangeable) or one single-phase branch
    const groups = new Map<string, number[]>();
    items.forEach((it, i) => { const k = it.blockSpan ? `block:${it.blockSpan}` : `c:${it.members[0].consumerId}`; groups.set(k, [...(groups.get(k) ?? []), i]); });
    const gs = [...groups.values()];
    const options = gs.map((idx) => {
      if (items[idx[0]].blockSpan) return P3.map((p) => [p]);
      const out: Phase[][] = [];
      const n = idx.length;
      for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) out.push([...Array(a).fill('a'), ...Array(b).fill('b'), ...Array(n - a - b).fill('c')]);
      return out;
    });
    const space = options.reduce((t, o) => t * o.length, 1);
    if (space <= limits.exhaustive) {
      const pick = options.map(() => 0);
      for (;;) {
        const phases: Phase[] = items.map(() => 'a');
        gs.forEach((idx, g) => { const o = options[g][pick[g]]; idx.forEach((i, u) => { phases[i] = o[Math.min(u, o.length - 1)]; }); });
        consider(phases);
        let g = 0;
        while (g < pick.length && ++pick[g] >= options[g].length) { pick[g] = 0; g++; }
        if (g === pick.length) break;
      }
      chosen.set(circuit.id, best.phases);
      checks[circuit.id] = { guarantee: 'exhaustive', evaluations };
      continue;
    }

    // search: for each node, the linear-model optimum (each group on the phase adding the most to
    // the drop of phase a there, over the spans it shares with the node), then improving moves
    const feed = new Map(circuit.spans.map((s) => [s.toBus, s]));
    const pathOf = (bus: string) => { const out = new Set<string>(); for (let s = feed.get(bus); s && !out.has(s.key); s = feed.get(s.fromBus)) out.add(s.key); return out; };
    const gain = (shared: string[], q: Phase) => shared.reduce((t, k) => {
      const s = spans.get(k); const zp = s?.zPhase.z, zn = s?.zNeutral.z;
      if (!zp || !zn) return t;
      return t + (q === 'a' ? mul(add(zp, zn), rot('a')).re : mul(zn, rot(q)).re);
    }, 0);
    for (const bus of circuit.buses) {
      if (evaluations >= limits.search) break;
      const at = pathOf(bus.id);
      const phases: Phase[] = items.map(() => 'a');
      for (const idx of gs) {
        const shared = items[idx[0]].path.filter((k) => at.has(k));
        let q: Phase = 'a', g = gain(shared, 'a');
        for (const p of ['b', 'c'] as const) { const v = gain(shared, p); if (v > g + 1e-15) { q = p; g = v; } }
        for (const i of idx) phases[i] = q;
      }
      consider(phases);
    }
    let improved = true;
    while (improved && evaluations < WORST_CASE_SEARCH_LIMIT) {
      improved = false;
      for (const idx of gs) {
        for (const i of items[idx[0]].blockSpan ? [idx[0]] : idx) for (const p of P3) {
          if (evaluations >= limits.search || best.phases[i] === p) continue;
          const trial = [...best.phases];
          if (items[idx[0]].blockSpan) for (const j of idx) trial[j] = p; else trial[i] = p;
          const before = best.w;
          consider(trial);
          if (best.w > before) improved = true;
        }
      }
    }
    chosen.set(circuit.id, best.phases);
    checks[circuit.id] = { guarantee: 'searched', evaluations };
  }
  return { allocation: allocationWith(), checks };
};

