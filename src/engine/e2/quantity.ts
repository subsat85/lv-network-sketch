// E2: every result is a Quantity — value, unit, status, where its inputs come from,
// the assumptions it rests on, the warnings that make it provisional, and why it is
// not available. Nothing is ever shown as 0 in place of a value that was not computed.
//
// computed    — every input it needs is documented, and it was calculated;
// provisional — it was calculated, but rests on an input that is not documented
//               (a legacy default, an estimated length, an unverified catalogue entry…):
//               shown with at least one warning;
// unavailable — the calculation ran, but this quantity needs data that are missing: no value;
// not-run     — the calculation did not start (an invalid input, or a blocker before it): no value.
//               An invalid input is never downgraded to 'unavailable' to show partial values.
//
// A circuit has two statuses (CircuitResult):
//   solve        — the numerical sweep: not-run (it did not start), unavailable (it did not
//                  converge), computed / provisional (it converged; provisional when it ran on an
//                  undocumented input). It says nothing about how much of the circuit has a result.
//   completeness — the result of the circuit as a whole: the worst status of its quantities
//                  (not-run > unavailable > provisional > computed); a phase the node does not have
//                  (phase-not-present) is not missing and does not count. 'computed' only when every
//                  node and span of the circuit is computed.

export type QuantityStatus = 'computed' | 'provisional' | 'unavailable' | 'not-run';
export type Unit = 'V' | 'A' | '%' | 'W' | 'var' | 'VA' | 'ohm' | 'ohm/km' | 'count' | 'none';
/** formulas of the design (F1 … F9); 'input' = an input value; 'bound' = an arithmetic upper bound */
/** 'topology' = zero by topology: a span with no load downstream carries no current and has no loss,
 *  whatever its impedance (known from the drawing, not from the sweep) */
export type FormulaId = 'F1' | 'F1p' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'input' | 'bound' | 'limits' | 'topology';
export type AssumptionId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8';

export type WarningCode =
  | 'length-estimated'
  | 'span-review'
  | 'span-inherited'
  | 'source-unknown'          // a value typed on the span without dataSource
  | 'catalogue-unverified'
  | 'dc-resistance-used'      // R from a DC value at 20 °C, corrected with F8
  | 'load-default'            // load current from a rule (4 A single-phase, 32 A three-phase default)
  | 'power-factor-default'
  | 'phase-parallel-default'   // np = 1 for a legacy project whose span has no parallel
  | 'allocation-unverified'    // a phase allocation used without verification 'checked' / 'approved'
  | 'proposed-load'            // a proposed (not confirmed) consumer is in the calculation (study)
  | 'orphan-consumer-excluded'  // a consumer at a pole of the circuit is connected to no cable of its colour: not calculated
  | 'proposed-consumer-excluded'; // a proposed subscriber of this circuit could not be connected: not calculated

export type UnavailableReason =
  | 'circuit-not-computed'
  | 'system-missing'
  | 'impedance-missing'
  | 'neutral-impedance-missing'
  | 'neutral-parallel-unknown'
  | 'neutral-conductor-missing'
  | 'phase-parallel-unknown'
  | 'parallel-invalid'
  | 'parallel-conflict'
  | 'length-missing'
  | 'length-suspect'          // a distance ≤ 1 m: the drawing's placeholder, not a measured length (kept as entered)
  | 'phase-allocation-missing'
  | 'phase-allocation-invalid'
  | 'phase-allocation-conflict'
  | 'phase-not-present'       // the node has no such phase (behind a 1ph2w span)
  | 'three-phase-on-single-phase'
  | 'invalid-load'
  | 'not-converged'
  | 'settings-missing'
  | 'energy-needs-load-profile'
  | 'node-voltage-unknown'
  | 'upstream-unavailable';

export type InputName = 'R' | 'X' | 'RN' | 'XN' | 'L' | 'np' | 'nN' | 'I' | 'S' | 'pf' | 'phase' | 'Vph' | 'system';
/** 'cable-construction': np = nN from a documented ABC cable (one cable = one complete set: three phases and its neutral) */
export type InputProvenance = 'project' | 'catalogue' | 'iec-table' | 'default' | 'legacy-default' | 'allocation' | 'cable-construction';
export interface InputRef {
  name: InputName;
  /** span key, consumer id, or 'settings' */
  element: string;
  provenance: InputProvenance;
  value?: number | string;
  /** catalogue entry id + page, allocation source… */
  ref?: string;
}

export interface Phasor { magnitude: number; angleDeg: number }

export interface Quantity<T = number> {
  status: QuantityStatus;
  /** only when status is 'computed' or 'provisional' */
  value?: T;
  unit: Unit;
  method: FormulaId;
  inputs: InputRef[];
  assumptions: AssumptionId[];
  warnings: WarningCode[];
  /** only when 'unavailable' or 'not-run' */
  reason?: UnavailableReason;
  /** the span / consumer / setting that blocks it */
  blockedBy?: string[];
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** A calculated value: 'computed' with no warnings, 'provisional' otherwise. */
export const valued = <T>(value: T, unit: Unit, method: FormulaId, inputs: InputRef[] = [], assumptions: AssumptionId[] = [], warnings: WarningCode[] = []): Quantity<T> => {
  const w = uniq(warnings);
  return { status: w.length ? 'provisional' : 'computed', value, unit, method, inputs, assumptions: uniq(assumptions), warnings: w };
};

export const unavailable = <T = number>(unit: Unit, method: FormulaId, reason: UnavailableReason, blockedBy: string[] = [], inputs: InputRef[] = []): Quantity<T> =>
  ({ status: 'unavailable', unit, method, inputs, assumptions: [], warnings: [], reason, blockedBy: uniq(blockedBy) });

export const notRun = <T = number>(unit: Unit, method: FormulaId, reason: UnavailableReason, blockedBy: string[] = []): Quantity<T> =>
  ({ status: 'not-run', unit, method, inputs: [], assumptions: [], warnings: [], reason, blockedBy: uniq(blockedBy) });

/** true when the quantity carries a value */
export const hasValue = <T>(q: Quantity<T>): q is Quantity<T> & { value: T } => q.status === 'computed' || q.status === 'provisional';
