// E2: the network the sweep calculates on (built for one calculation, never saved),
// and the results it returns. Every impedance is the total series impedance of the
// span, in Ω, with the length and the number of parallel conductors applied.

import type { C } from './complex';
import type { Phase } from './phases';
import type { InputRef, Phasor, Quantity, QuantityStatus, UnavailableReason, WarningCode } from './quantity';

export type Conductor = Phase | 'n';
export const CONDUCTORS: readonly Conductor[] = ['a', 'b', 'c', 'n'];
export type LoadModel = 'constant-current' | 'constant-power';

/** an impedance, or why it is not known */
export interface ZData { z?: C; reason?: UnavailableReason; inputs: InputRef[]; warnings: WarningCode[] }

export interface E2Span {
  /** `${cableId}#${index}` */
  key: string;
  fromBus: string;
  toBus: string;
  system?: '3ph4w' | '1ph2w';
  /** 1ph2w only: the phase it carries (from the allocation) */
  phase?: Phase;
  /** why the span cannot be used: system-missing, phase-allocation-missing (1ph2w without phase) */
  topologyReason?: UnavailableReason;
  /** ONE phase conductor (group): (R + jX)·L/np */
  zPhase: ZData;
  /** the neutral: (RN + jXN)·L/nN */
  zNeutral: ZData;
  np?: number;
  nN?: number;
  /** warnings of the span itself (length estimated, review, np default…) */
  warnings: WarningCode[];
  inputs: InputRef[];
}

export interface E2Load {
  consumerId: string;
  bus: string;
  kind: 'single' | 'three';
  /** |Irule| on each phase it draws, A; undefined while its phase is not known */
  perPhase?: Record<Phase, number>;
  /** single: count × ampsEach (all its subscribers); three: per phase */
  ruleA: number;
  /** why it cannot be placed on phases: phase-allocation-missing / -invalid / -conflict, three-phase-on-single-phase */
  phaseReason?: UnavailableReason;
  invalid?: boolean;
  warnings: WarningCode[];
  inputs: InputRef[];
}

export interface E2Bus { id: string; poleId: string }
export interface E2Circuit {
  id: string;
  /** the existing topology's status ('ok' = a radial tree from its source) */
  status: string;
  sourceBus?: string;
  /** in order from the source */
  buses: E2Bus[];
  /** in order from the source, each oriented downstream */
  spans: E2Span[];
  loads: E2Load[];
  /** settings-level warnings (power factor default…) and circuit-level ones (excluded consumers) */
  warnings: WarningCode[];
  /** consumers of the drawing that belong here but are not in `loads` (orphan, unconnected proposal):
   *  their phases are not known, so the circuit is never taken as symmetric (F8) */
  excludedConsumers?: string[];
}

export interface SolveSettings {
  Vph: number;
  pf: number;
  loadModel: LoadModel;
  limitPercent: number;
  nearLimitFraction: number;
  minPhaseVoltage: number;
  minLineVoltage: number;
  /** inputs of the settings, for the results (pf, Vph) */
  inputs: InputRef[];
}

export interface SpanResult {
  key: string;
  current: Record<Conductor, Quantity<Phasor>>;
  /** |I| / n per conductor (A8) */
  perSetCurrentA: Record<Conductor, Quantity>;
  /** Σ|Irule| downstream — an upper bound, labelled as such, never a current */
  arithmeticSumA: Record<Conductor, Quantity>;
  /** |Vpn(from)| − |Vpn(to)| */
  dropV: Record<Phase, Quantity>;
  pLossW: Quantity;
  qAbsorbedVar: Quantity;
}
export type LimitStatus = 'ok' | 'near' | 'over' | 'na';
export interface NodeResult {
  bus: string;
  poleId: string;
  voltage: Record<Phase, Quantity<Phasor>>;
  neutralShiftV: Quantity<Phasor>;
  lineV: Record<'ab' | 'bc' | 'ca', Quantity>;
  dropV: Record<Phase, Quantity>;
  dropPercent: Record<Phase, Quantity>;
  limit: LimitStatus;
}
export interface LoadResult {
  consumerId: string;
  /** current drawn on each phase: |Irule| (constant current) or |S| / |V| (constant power, after convergence) */
  currentA: Record<Phase, Quantity>;
  /** constant power: S per phase, VA */
  apparentPowerVA?: Record<Phase, Quantity>;
}
/** see quantity.ts: solve = the numerical sweep; completeness = the circuit's result as a whole */
export interface CircuitResult {
  id: string;
  solve: { status: QuantityStatus; model: LoadModel; converged?: boolean; iterations?: number; reason?: UnavailableReason; blockedBy?: string[] };
  completeness: { status: QuantityStatus; reason?: UnavailableReason; blockedBy?: string[] };
  spans: SpanResult[];
  nodes: NodeResult[];
  loads: LoadResult[];
  pLossW: Quantity;
  qAbsorbedVar: Quantity;
  worst?: { bus: string; phase: Phase; percent: number };
}
