// Calculation core (Stage E1): the existing engine behind the Solver interface.
// computeVoltageDrop is called unchanged, with the network the adapter built (its
// fifth parameter), and its result is returned as it is. The outputs below only COPY
// its values and say where each comes from; nothing is added, multiplied or derived.
//
// Currents (src/utils/voltageDrop.ts, read at b3b127e):
//   threePhaseA   — three-phase current per phase downstream of the span (I3)
//   singlePhaseA  — single-phase current downstream, phase unknown (I1)
//   phaseCurrentA — current of the phase checked: 1ph2w → I1; balanced → I3 + I1/3; worst → I3 + I1
// They are results only when the circuit is computed ('ok'); with constant power, only
// for a computable span of a converged iteration (otherwise they are left-over values).
// The existing engine computes no per-phase current (ia, ib, ic) and no neutral current.

import type { CableElement, DistanceFlag, DrawingElement, ElectricalSettings, SpanProps } from '../../types/drawing';
import { computeVoltageDrop, type CircuitResult, type SpanResult, type VoltageDropResult } from '../../utils/voltageDrop';
import { computed, notAvailable, type BranchImpedance, type BranchOutput, type BusOutput, type NotAvailableReason, type ScenarioId, type Sourced, type Valued } from '../model';
import type { Solver, SolverInput } from '../solver';

const PER_PHASE: NotAvailableReason = 'legacy-does-not-compute-per-phase';

const ASSUMPTIONS: Record<'common' | ScenarioId, string[]> = {
  common: [
    'legacy: source voltage = nominal phase voltage',
    'legacy: the neutral conductor uses the span reactance X (no separate Xn)',
    'legacy: three-phase loads are balanced; no diversity factor',
  ],
  worst: ['legacy: every single-phase load of unknown phase is on the phase checked, its current returns in the neutral'],
  balanced: ['legacy: single-phase loads are split equally over the three phases'],
  unbalanced: [],
};

/** Why the currents of a span are not a result, or undefined when they are one. */
const currentsUnavailable = (cr: CircuitResult, sp: SpanResult): NotAvailableReason | undefined => {
  if (cr.status !== 'ok') return 'circuit-not-computed';
  if (cr.loadModel === 'constant-power' && !(cr.converged === true && sp.computable)) return 'constant-power-not-final';
  return undefined;
};

const impedanceOf = (sp: SpanResult, props: SpanProps | undefined, settings: ElectricalSettings): BranchImpedance => {
  const r: Sourced<number> = sp.r !== undefined
    ? { value: sp.r, provenance: sp.rSource === 'table' ? 'iec-table' : 'project', status: 'complete' }
    : { provenance: 'missing', status: 'missing' };
  let x: Sourced<number>;
  if (sp.x === undefined) x = { provenance: 'missing', status: 'missing' };
  else if (props?.xOhmPerKm !== undefined && props.xOhmPerKm === sp.x) x = { value: sp.x, provenance: 'project', status: 'complete' };
  else x = { value: sp.x, provenance: 'legacy-rule', status: 'complete', note: `X not given; the existing engine uses ${sp.x} at cos φ = ${settings.powerFactor}` };
  const rn: Sourced<number> = sp.rnSource === 'not-needed'
    ? { provenance: 'not-required' }
    : sp.rn !== undefined
      ? { value: sp.rn, provenance: sp.rnSource === 'table' ? 'iec-table' : 'project', status: 'complete' }
      : { provenance: 'missing', status: 'missing' };
  return { r, x, rn, xn: { provenance: 'missing', status: 'missing', note: 'not stored by the app' }, ...(sp.parallel !== undefined ? { parallel: sp.parallel } : {}) };
};

const branchOf = (cr: CircuitResult, sp: SpanResult, cables: Map<string, CableElement>, settings: ElectricalSettings): BranchOutput => {
  const cable = cables.get(sp.cableId);
  const props = sp.spanId ? cable?.spanProps?.[sp.spanId] : undefined;
  const why = currentsUnavailable(cr, sp);
  const current = (v: number): Valued<number> => (why ? notAvailable(why) : computed(v));
  // the checked-phase current depends on the supply system: with no system, or a 1ph2w span
  // carrying a three-phase load (I3 left out of it), it is not a result of that span
  const systemUnusable = sp.system === undefined || (sp.system === '1ph2w' && sp.threePhaseA > 0);
  const checked: Valued<number> = why ? notAvailable(why) : systemUnusable ? notAvailable('span-not-computed') : computed(sp.phaseCurrentA);
  return {
    key: sp.key,
    checkedPhaseA: checked,
    threePhaseDownstreamA: current(sp.threePhaseA),
    singlePhaseDownstreamA: current(sp.singlePhaseA),
    dropV: sp.computable && sp.dropV !== undefined ? computed(sp.dropV) : notAvailable(cr.status !== 'ok' ? 'circuit-not-computed' : 'span-not-computed'),
    cumulativeDropV: sp.cumulativeDropV !== undefined ? computed(sp.cumulativeDropV) : notAvailable(cr.status !== 'ok' ? 'circuit-not-computed' : 'span-not-computed'),
    ia: notAvailable(PER_PHASE), ib: notAvailable(PER_PHASE), ic: notAvailable(PER_PHASE), in: notAvailable(PER_PHASE),
    impedance: impedanceOf(sp, props, settings),
    missing: [...sp.missing],
    provisional: [...sp.provisional],
  };
};

export const legacyScalarSolver: Solver = {
  id: 'legacy-scalar',
  supports: (s) => s === 'balanced' || s === 'worst',
  solve(input: SolverInput) {
    const { doc, scenario, legacyNetwork } = input;
    if (scenario === 'unbalanced') throw new Error('legacy-scalar: the unbalanced scenario is not supported');
    // the settings object is passed on unchanged when it already asks for this scenario
    const settings = input.settings.singlePhaseMode === scenario ? input.settings : { ...input.settings, singlePhaseMode: scenario };
    const elements = doc.elements as DrawingElement[];
    const legacy: VoltageDropResult = computeVoltageDrop(elements, doc.connectionDistances as Record<string, string>, settings, doc.distanceFlags as Record<string, DistanceFlag>, legacyNetwork);

    const cables = new Map<string, CableElement>();
    for (const e of elements) if (e.type === 'cable') cables.set(e.id, e);
    const branches = new Map<string, BranchOutput>();
    const buses = new Map<string, BusOutput>();
    const convergence = new Map<string, { converged?: boolean; iterations?: number }>();
    for (const cr of legacy.circuits) {
      for (const sp of cr.spans) branches.set(sp.key, branchOf(cr, sp, cables, settings));
      for (const p of cr.poles) {
        const why: NotAvailableReason = cr.status !== 'ok' ? 'circuit-not-computed' : 'pole-not-computed';
        buses.set(p.bus, {
          bus: p.bus, poleId: p.poleId, circuitId: p.circuitId, status: p.status,
          dropV: p.dropV !== undefined ? computed(p.dropV) : notAvailable(why),
          percent: p.percent !== undefined ? computed(p.percent) : notAvailable(why),
          phaseV: p.phaseV !== undefined ? computed(p.phaseV) : notAvailable(why),
          lineV: p.lineV !== undefined ? computed(p.lineV) : notAvailable(p.dropV !== undefined ? 'line-voltage-not-shown' : why),
          provisional: [...p.provisional],
        });
      }
      if (cr.loadModel === 'constant-power') convergence.set(cr.circuit.id, { converged: cr.converged, iterations: cr.iterations });
    }
    return {
      scenario,
      method: `legacy-scalar: computeVoltageDrop, ${settings.loadModel ?? 'constant-current'}, singlePhaseMode ${settings.singlePhaseMode}`,
      available: true,
      assumptions: [...ASSUMPTIONS.common, ...ASSUMPTIONS[scenario]],
      branches, buses, convergence,
      legacy,
    };
  },
};
