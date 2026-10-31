// Calculation core (Stage E1): types only.
//
// The core reads a project document and never writes to it. In E1 it runs only the
// existing engine (computeVoltageDrop / buildNetwork) behind a Solver interface; no
// electrical value is derived or assumed here. A value the existing engine does not
// compute is reported as not available, with the reason — never as 0.

import type { DistanceFlag, DrawingElement, ElectricalSettings, SupplySystem } from '../types/drawing';
import type { CircuitStatus } from '../utils/network';
import type { MissingItem, PoleStatus, ProvisionalReason } from '../utils/voltageDrop';

/** The parts of the drawing document the calculation reads (the same parts the undo history keeps). */
export interface ProjectDocument {
  elements: readonly DrawingElement[];
  connectionDistances: Readonly<Record<string, string>>;
  distanceFlags: Readonly<Record<string, DistanceFlag>>;
  electrical: Readonly<ElectricalSettings>;
}

// ---------- input data: a value with where it comes from ----------

/**
 * project       — stored in the project (typed or copied into the span / subscriber)
 * iec-table     — taken by the existing engine from the IEC 60228 table (temperature corrected)
 * company-table — reserved for later stages (catalogue); not produced in E1
 * default       — a rule value of the existing engine (e.g. 4 A per single-phase subscriber)
 * legacy-rule   — a value the existing engine sets itself (X taken as 0 when cos φ = 1)
 * not-required  — not needed for this span by the existing engine (e.g. Rn with no neutral current)
 * missing       — not available: no value
 */
export type Provenance = 'project' | 'iec-table' | 'company-table' | 'default' | 'legacy-rule' | 'not-required' | 'missing';
export interface Sourced<T> {
  value?: T;
  provenance: Provenance;
  /** to-check: shown but provisional (e.g. an estimated length); invalid: present but not usable */
  status?: 'complete' | 'missing' | 'to-check' | 'invalid';
  note?: string;
}

// ---------- results: a value with its origin ----------

/** In E1 there is no 'derived' origin: every available result value is one the existing engine computed. */
export type Origin = 'legacy-computed' | 'not-available';
export type NotAvailableReason =
  | 'legacy-does-not-compute-per-phase' // ia / ib / ic / in
  | 'circuit-not-computed'              // circuit status ≠ 'ok'
  | 'span-not-computed'                 // the span is not computable
  | 'constant-power-not-final'          // the current did not come out of a converged constant-power iteration
  | 'pole-not-computed'                 // the pole has no result
  | 'line-voltage-not-shown';           // the existing engine gives V(L-L) only where no neutral current flows
export interface Valued<T> { value?: T; origin: Origin; reason?: NotAvailableReason }

export const computed = <T>(value: T): Valued<T> => ({ value, origin: 'legacy-computed' });
export const notAvailable = <T = number>(reason: NotAvailableReason): Valued<T> => ({ origin: 'not-available', reason });

// ---------- the electrical network (built for a calculation, never saved) ----------

export interface NetLoad {
  consumerId: string;
  kind: 'single' | 'three';
  count: number;
  /** current of one subscriber, A: from its label ('project') or from the load rule ('default') */
  ampsEach: Sourced<number>;
  /** count × ampsEach, A; status 'invalid' (no value) when the load value cannot be a current */
  amps: Sourced<number>;
  proposed: boolean;
  /** single-phase only, when known — the drawing stores no phase in E1, so always undefined */
  phase?: 'a' | 'b' | 'c';
}
export interface NetBus { id: string; poleId: string; loads: NetLoad[] }
export interface NetBranch {
  /** `${cableId}#${index}`, the key of SpanResult */
  key: string;
  cableId: string;
  index: number;
  spanId: string | undefined;
  fromPole: string;
  toPole: string;
  fromBus: string;
  toBus: string;
  color: string;
  lengthM: Sourced<number>;
  lengthMissing?: MissingItem;
  system: Sourced<SupplySystem>;
}
export interface NetCircuit {
  id: string;
  status: CircuitStatus;
  source?: { poleId: string; kind: 'manual' | 'transformer'; bus?: string };
  /** for an 'ok' circuit in order from the source */
  buses: NetBus[];
  /** for an 'ok' circuit in order from the source, each oriented downstream */
  branches: NetBranch[];
}
export interface ElectricalNetwork { circuits: NetCircuit[] }

export type ScenarioId = 'balanced' | 'unbalanced' | 'worst';

// ---------- solver output ----------

export interface BranchImpedance {
  /** Ω/km as used by the existing engine (after temperature correction, before ÷ parallel) */
  r: Sourced<number>;
  x: Sourced<number>;
  rn: Sourced<number>;
  /** the app stores no neutral reactance: always missing (the existing engine uses X for it) */
  xn: Sourced<number>;
  parallel?: number;
}
export interface BranchOutput {
  key: string;
  /** current of the phase checked (phaseCurrentA) */
  checkedPhaseA: Valued<number>;
  /** three-phase current per phase downstream (threePhaseA) */
  threePhaseDownstreamA: Valued<number>;
  /** single-phase current downstream, phase unknown (singlePhaseA) */
  singlePhaseDownstreamA: Valued<number>;
  dropV: Valued<number>;
  cumulativeDropV: Valued<number>;
  /** never computed by the existing engine */
  ia: Valued<number>; ib: Valued<number>; ic: Valued<number>; in: Valued<number>;
  impedance: BranchImpedance;
  missing: MissingItem[];
  provisional: ProvisionalReason[];
}
export interface BusOutput {
  bus: string;
  poleId: string;
  circuitId: string;
  status: PoleStatus;
  dropV: Valued<number>;
  percent: Valued<number>;
  phaseV: Valued<number>;
  lineV: Valued<number>;
  provisional: ProvisionalReason[];
}
export interface SolverOutput {
  scenario: ScenarioId;
  method: string;
  available: boolean;
  unavailableReason?: string;
  /** the existing engine's assumptions, as text — not values */
  assumptions: string[];
  branches: ReadonlyMap<string, BranchOutput>;
  buses: ReadonlyMap<string, BusOutput>;
  /** constant power only, per circuit id */
  convergence: ReadonlyMap<string, { converged?: boolean; iterations?: number }>;
}
