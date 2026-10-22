import type { CableElement, DistanceFlag, DrawingElement, ElectricalSettings, SpanProps, SpanReview } from '../types/drawing';
import { tableResistance } from '../data/conductors';
import { buildNetwork, Circuit, Network, NetworkIssue, NetSpan } from './network';
import { pairKey } from './cableSegments';
import { isPlainDistance } from './distances';

// ---------------------------------------------------------------------------
// Voltage-drop calculation (no UI here).
//
// Model and formulas (stated so every number can be checked by hand):
//   - radial network from the source (see network.ts); source voltage = nominal;
//   - loads are constant currents from the load rules (utils/loads.ts), no
//     diversity factor; one power factor cos φ for all loads (settings);
//   - per span, conductor impedances in Ω/km: R (phase), X (phase), Rn (neutral);
//     the neutral's reactance is taken equal to the phase reactance (same cable);
//     n conductors in parallel divide R, X and Rn by n; L = span length in km;
//   - the usual approximate drop of a conductor carrying I at cos φ is
//     I·(R cos φ + X sin φ)·L (the in-phase component of I·Z);
//   - phase-to-neutral drop of the phase being checked, per span:
//       worst-case mode (default): every single-phase load whose phase is not
//       known is put on the phase being checked — an upper bound, since moving a
//       single-phase load to another phase can only lower that phase's drop:
//         ΔV = [(I3 + I1)(R cos φ + X sin φ) + I1 (Rn cos φ + X sin φ)] · L / n
//       balanced mode (chosen by the user): the single-phase current is split
//       equally over the three phases, so no neutral current:
//         ΔV = (I3 + I1/3)(R cos φ + X sin φ) · L / n
//       single-phase span (1φ + N): ΔV = I1 [(R cos φ + X sin φ) + (Rn cos φ + X sin φ)] · L / n
//     I3 = three-phase current per phase downstream, I1 = single-phase current
//     downstream (both in A);
//   - cumulative drop at a pole = sum of the span drops from the source; % is of
//     the nominal phase voltage; remaining phase voltage = nominal − drop;
//   - phase-to-phase voltage is shown only where no neutral current flows on
//     the whole path (three-phase loads only, or balanced mode): √3 · ΔV.
// Nothing is computed for a span whose data are missing, nor for anything fed
// through it; such results are "not computable", with the missing items listed.
// ---------------------------------------------------------------------------

export type MissingItem =
  | 'length'            // no distance recorded for the span
  | 'length-suspect'    // distance ≤ 1 m: the drawing's placeholder value, not a measured length
  | 'system'            // number of phases / supply system
  | 'resistance'        // phase R: material + cross-section (table) or R per span
  | 'resistance-bare'   // bare overhead conductors: IEC 60228 (insulated cables) does not apply → R per span
  | 'resistance-kind'   // cable kind unknown / "other": the table cannot be applied → kind or R per span
  | 'section-not-in-table'
  | 'reactance'         // X (needed because cos φ < 1)
  | 'neutral'           // neutral R: neutral cross-section (table) or Rn per span
  | 'neutral-not-in-table'
  | 'neutral-material'  // neutral material not given (it is not assumed to be the phase material)
  | 'neutral-alloy'     // aluminium-alloy neutral (e.g. ABC messenger): not in the table → Rn per span
  | 'parallel'          // invalid number of parallel conductors
  | 'three-phase-on-single-phase' // a three-phase load fed through a single-phase span
  | 'invalid-load'      // a subscriber downstream has a load value that is not a current (e.g. ≤ 0)
  | 'downstream-voltage-unknown' // constant power: the voltage of loads fed through this span is not known
  | 'not-converged';    // constant power: the iteration did not converge

/**
 * Why a computed value is only provisional (shown, but as "needs review", never
 * as a confirmed result): span marked for review (split / merged / moved / v2),
 * properties copied from the previous span and not yet confirmed, a length that
 * is an estimate (from placing a pole on a span), or impedances entered without
 * saying where they come from.
 */
export type ProvisionalReason = 'review' | 'inherited' | 'length-estimated' | 'source-unknown';

export type SettingMissing = 'powerFactor' | 'conductorTempC';

export interface SpanResult {
  key: string;             // `${cableId}#${index}`
  cableId: string;
  index: number;
  spanId: string | undefined;
  fromPole: string;
  toPole: string;
  color: string;
  lengthM?: number;
  /** downstream currents, A */
  threePhaseA: number;
  singlePhaseA: number;
  /** current of the phase checked, A (worst / balanced as configured) */
  phaseCurrentA: number;
  /** this span's drop, V (phase to neutral) */
  dropV?: number;
  /** drop from the source to the end of this span, V */
  cumulativeDropV?: number;
  computable: boolean;
  missing: MissingItem[];
  /** values to check (split / merged / copied / from a v2 file) — results still shown */
  review: SpanReview[];
  inherited: boolean;
  /** where the impedances come from */
  rSource?: 'table' | 'manual';
  rnSource?: 'table' | 'manual' | 'not-needed';
  /** impedances used, Ω/km (after temperature correction, before ÷ parallel) */
  r?: number; x?: number; rn?: number; parallel?: number;
  system?: SpanProps['system'];
  /** reasons this span's own value is provisional (empty = confirmed data) */
  provisional: ProvisionalReason[];
}

export type PoleStatus = 'ok' | 'near' | 'over' | 'na';

export interface PoleResult {
  poleId: string;
  bus: string;
  circuitId: string;
  /** colour of the cable feeding this point (for display) */
  color: string;
  status: PoleStatus;
  dropV?: number;
  percent?: number;
  phaseV?: number;
  /** phase-to-phase voltage, only on paths without neutral current */
  lineV?: number;
  consumerIds: string[];
  /** why not computable: missing data on the path / network problem */
  reason?: 'missing-data' | 'network' | 'settings' | 'not-converged';
  /** reasons the value is provisional, from every span on the path (empty = confirmed) */
  provisional: ProvisionalReason[];
}

export interface CircuitResult {
  circuit: Circuit;
  status: Circuit['status'];
  spans: SpanResult[];
  poles: PoleResult[];
  maxPercent?: number;
  worstPoleId?: string;
  /** the worst value depends on provisional data */
  worstProvisional?: boolean;
  /** load model used for this network */
  loadModel: 'constant-current' | 'constant-power';
  /** constant power only: iterations done and whether the result converged */
  iterations?: number;
  converged?: boolean;
}

/** Constant-power iteration: converged when no pole voltage moves more than this between two passes. */
export const CP_TOLERANCE_V = 1e-3;
export const CP_MAX_ITERATIONS = 50;

export interface VoltageDropResult {
  settings: ElectricalSettings;
  settingsMissing: SettingMissing[];
  circuits: CircuitResult[];
  /** pole id → results at that pole (one per circuit / bus) */
  byPole: Map<string, PoleResult[]>;
  /** `${cableId}#${index}` → span result */
  bySpan: Map<string, SpanResult>;
  issues: NetworkIssue[];
  network: Network;
}

export const spanKey = (cableId: string, index: number) => `${cableId}#${index}`;
const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Span length from the drawing's distance for the pole pair, metres. */
export const spanLength = (distances: Record<string, string>, a: string, b: string): { m?: number; missing?: MissingItem } => {
  const raw = distances[pairKey(a, b)];
  if (raw === undefined || raw.trim() === '') return { missing: 'length' };
  // only a plain number is a length ("40m", "abc"… are not turned into one)
  if (!isPlainDistance(raw)) return { missing: 'length' };
  const v = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) return { missing: 'length' };
  if (v <= 1) return { missing: 'length-suspect' };
  return { m: v };
};

interface Resolved { r?: number; x?: number; rn?: number; parallel: number; rSource?: 'table' | 'manual'; rnSource?: 'table' | 'manual' | 'not-needed'; missing: MissingItem[]; usesTable: boolean }

// IEC 60228 (Table 2, class 2) is the conductor standard of INSULATED cables:
// it is applied to ABC and underground cables only. Bare overhead conductors
// (other standards) and cables of unknown kind need R entered per span.
const TABLE_KINDS: ReadonlySet<string> = new Set(['abc', 'underground']);

const resolveImpedance = (p: SpanProps | undefined, settings: ElectricalSettings, needNeutral: boolean): Resolved => {
  const missing: MissingItem[] = [];
  let usesTable = false;
  const tableKind = !!p?.cableKind && TABLE_KINDS.has(p.cableKind);
  const kindMissing: MissingItem = p?.cableKind === 'bare' ? 'resistance-bare' : 'resistance-kind';
  const temp = settings.conductorTempC;
  const parallel = p?.parallel === undefined ? 1 : p.parallel;
  if (!(Number.isInteger(parallel) && parallel >= 1)) missing.push('parallel');

  let r: number | undefined, rSource: Resolved['rSource'];
  if (isPos(p?.rOhmPerKm)) { r = p!.rOhmPerKm; rSource = 'manual'; }
  else if (p?.material && isPos(p.crossSectionMm2) && !tableKind) missing.push(kindMissing);
  else if (p?.material && isPos(p.crossSectionMm2)) {
    usesTable = true;
    if (temp !== undefined) {
      const t = tableResistance(p.material, p.crossSectionMm2!, temp);
      if (t === null) missing.push('section-not-in-table'); else { r = t; rSource = 'table'; }
    } else if (tableResistance(p.material, p.crossSectionMm2!, 20) === null) missing.push('section-not-in-table');
  } else missing.push('resistance');

  let x: number | undefined;
  const pf = settings.powerFactor;
  if (pf !== undefined && pf >= 1) x = isPos(p?.xOhmPerKm) || p?.xOhmPerKm === 0 ? p!.xOhmPerKm : 0;
  else if (p?.xOhmPerKm !== undefined && Number.isFinite(p.xOhmPerKm) && p.xOhmPerKm >= 0) x = p.xOhmPerKm;
  else missing.push('reactance');

  let rn: number | undefined, rnSource: Resolved['rnSource'] = 'not-needed';
  if (needNeutral) {
    if (isPos(p?.rNeutralOhmPerKm)) { rn = p!.rNeutralOhmPerKm; rnSource = 'manual'; }
    else if (isPos(p?.neutralCrossSectionMm2)) {
      const nm = p!.neutralMaterial;
      if (!nm) missing.push('neutral-material');
      else if (nm === 'alloy') missing.push('neutral-alloy');
      else if (!tableKind) missing.push(kindMissing);
      else {
        usesTable = true;
        if (temp !== undefined) {
          const t = tableResistance(nm, p!.neutralCrossSectionMm2!, temp);
          if (t === null) missing.push('neutral-not-in-table'); else { rn = t; rnSource = 'table'; }
        } else if (tableResistance(nm, p!.neutralCrossSectionMm2!, 20) === null) missing.push('neutral-not-in-table');
      }
    } else missing.push('neutral');
  }
  return { r, x, rn, parallel, rSource, rnSource, missing, usesTable };
};

const propsOf = (elements: Map<string, CableElement>, s: NetSpan) => {
  const c = elements.get(s.cableId);
  const id = c?.spanIds?.[s.index];
  return id ? c?.spanProps?.[id] : undefined;
};

export const computeVoltageDrop = (
  elements: DrawingElement[],
  distances: Record<string, string>,
  settings: ElectricalSettings,
  distanceFlags: Record<string, DistanceFlag> = {},
  network: Network = buildNetwork(elements),
): VoltageDropResult => {
  const cables = new Map<string, CableElement>();
  for (const e of elements) if (e.type === 'cable') cables.set(e.id, e);
  const settingsMissing = new Set<SettingMissing>();
  const pf = settings.powerFactor;
  if (pf === undefined) settingsMissing.add('powerFactor');
  const cos = pf ?? NaN;
  const sin = pf !== undefined ? Math.sqrt(Math.max(0, 1 - pf * pf)) : NaN;
  const byPole = new Map<string, PoleResult[]>();
  const bySpan = new Map<string, SpanResult>();
  const circuits: CircuitResult[] = [];
  const balancedMode = settings.singlePhaseMode === 'balanced';
  const Vph = settings.phaseVoltage;

  const loadModel = settings.loadModel ?? 'constant-current';
  for (const circuit of network.circuits) {
    const dropFns: (((A3: number, A1: number) => number) | undefined)[] = [];
    const spans: SpanResult[] = circuit.spans.map((s, i) => {
      const props = propsOf(cables, s);
      const load = circuit.status === 'ok' ? circuit.downstream[i] : undefined;
      const I3 = load?.three ?? 0, I1 = load?.single ?? 0;
      const system = props?.system;
      const missing: MissingItem[] = [];
      const len = spanLength(distances, s.fromPole, s.toPole);
      if (len.missing) missing.push(len.missing);
      if (!system) missing.push('system');
      if (system === '1ph2w' && I3 > 0) missing.push('three-phase-on-single-phase');
      if (load && load.invalidConsumerIds.length) missing.push('invalid-load');
      const needNeutral = system === '1ph2w' || (!balancedMode && I1 > 0);
      const z = resolveImpedance(props, settings, needNeutral);
      missing.push(...z.missing);
      if (z.usesTable && settings.conductorTempC === undefined) settingsMissing.add('conductorTempC');
      const phaseCurrentA = system === '1ph2w' ? I1 : balancedMode ? I3 + I1 / 3 : I3 + I1;
      const res: SpanResult = {
        key: spanKey(s.cableId, s.index), cableId: s.cableId, index: s.index, spanId: s.spanId,
        fromPole: s.fromPole, toPole: s.toPole, color: s.color, lengthM: len.m,
        threePhaseA: I3, singlePhaseA: I1, phaseCurrentA, system,
        computable: false, missing, review: props?.review ?? [], inherited: !!props?.inherited,
        rSource: z.rSource, rnSource: z.rnSource, r: z.r, x: z.x, rn: z.rn, parallel: z.parallel,
        provisional: [],
      };
      if (res.review.length) res.provisional.push('review');
      if (len.m !== undefined && distanceFlags[pairKey(s.fromPole, s.toPole)]?.estimated) res.provisional.push('length-estimated');
      if (res.inherited) res.provisional.push('inherited');
      // values typed per span (R, Rn, and X when it matters) need a stated source
      const usesManual = z.rSource === 'manual' || z.rnSource === 'manual' || (z.x !== undefined && z.x > 0 && pf !== undefined && pf < 1);
      if (usesManual && !props?.dataSource?.trim()) res.provisional.push('source-unknown');
      const ok = circuit.status === 'ok' && !missing.length && pf !== undefined && z.r !== undefined && z.x !== undefined && (!needNeutral || z.rn !== undefined) && len.m !== undefined;
      if (ok) {
        const L = len.m! / 1000, n = z.parallel;
        const zPh = z.r! * cos + z.x! * sin;
        // Assumption (documented, unchanged): the neutral conductor uses the span's X (the phase
        // reactance) — there is no separate Xn; only its resistance Rn is its own.
        const zN = needNeutral ? z.rn! * cos + z.x! * sin : 0;
        // the span's drop for given downstream currents (same expressions for both load models)
        const drop = (A3: number, A1: number) => {
          if (system === '1ph2w') return A1 * (zPh + zN) * L / n;
          if (balancedMode) return (A3 + A1 / 3) * zPh * L / n;
          return ((A3 + A1) * zPh + A1 * zN) * L / n;
        };
        dropFns[i] = drop;
        res.dropV = drop(I3, I1);
        res.computable = true;
      }
      bySpan.set(res.key, res);
      return res;
    });

    const poles: PoleResult[] = [];
    const cr: CircuitResult = { circuit, status: circuit.status, spans, poles, loadModel };
    if (circuit.status === 'ok' && loadModel === 'constant-power') {
      const r = iterateConstantPower(circuit, spans, dropFns, Vph, balancedMode);
      cr.iterations = r.iterations;
      cr.converged = r.converged;
    }
    if (circuit.status === 'ok') {
      const cum = new Map<string, number | undefined>();
      const neutralFree = new Map<string, boolean>();
      const prov = new Map<string, ProvisionalReason[]>([[circuit.sourceBus!, []]]);
      cum.set(circuit.sourceBus!, 0);
      neutralFree.set(circuit.sourceBus!, true);
      for (const b of circuit.buses) {
        if (b === circuit.sourceBus) continue;
        const si = circuit.feedSpan.get(b)!;
        const sp = spans[si];
        const up = cum.get(circuit.spans[si].fromBus);
        const v = up === undefined || !sp.computable ? undefined : up + sp.dropV!;
        cum.set(b, v);
        sp.cumulativeDropV = v;
        const noNeutralCurrent = sp.singlePhaseA === 0 || (balancedMode && sp.system !== '1ph2w');
        neutralFree.set(b, (neutralFree.get(circuit.spans[si].fromBus) ?? false) && noNeutralCurrent);
        const busLoad = circuit.busLoad.get(b);
        const pathProv = [...new Set([...(prov.get(circuit.spans[si].fromBus) ?? []), ...sp.provisional])];
        prov.set(b, pathProv);
        const pr: PoleResult = {
          poleId: circuit.spans[si].toPole, bus: b, circuitId: circuit.id, color: sp.color, status: 'na',
          consumerIds: busLoad?.consumerIds ?? [], provisional: pathProv,
        };
        if (v === undefined) pr.reason = cr.converged === false ? 'not-converged' : settingsMissing.size ? 'settings' : 'missing-data';
        else {
          pr.dropV = v;
          pr.percent = (v / Vph) * 100;
          pr.phaseV = Vph - v;
          if (neutralFree.get(b)) pr.lineV = settings.lineVoltage - Math.sqrt(3) * v;
          const over = pr.percent > settings.limitPercent || pr.phaseV < settings.minPhaseVoltage || (pr.lineV !== undefined && pr.lineV < settings.minLineVoltage);
          pr.status = over ? 'over' : pr.percent >= settings.nearLimitFraction * settings.limitPercent ? 'near' : 'ok';
          if (cr.maxPercent === undefined || pr.percent > cr.maxPercent) { cr.maxPercent = pr.percent; cr.worstPoleId = pr.poleId; cr.worstProvisional = pathProv.length > 0; }
        }
        poles.push(pr);
      }
    } else {
      // not computable: every pole of the network gets a "not computable" result
      const seenBus = new Set<string>();
      for (const b of circuit.buses) {
        if (seenBus.has(b)) continue;
        seenBus.add(b);
        const feeding = circuit.spans.find((s) => s.toBus === b || s.fromBus === b);
        poles.push({ poleId: network.poleOfBus.get(b)!, bus: b, circuitId: circuit.id, color: feeding?.color ?? '#000000', status: 'na', reason: 'network', consumerIds: circuit.busLoad.get(b)?.consumerIds ?? [], provisional: [] });
      }
    }
    for (const p of poles) byPole.set(p.poleId, [...(byPole.get(p.poleId) ?? []), p]);
    circuits.push(cr);
  }

  return {
    settings, settingsMissing: [...settingsMissing], circuits, byPole, bySpan,
    issues: [...network.issues, ...network.circuits.flatMap((c) => c.issues)], network,
  };
};

/**
 * Constant-power loads (Stage 7.9): each subscriber draws the power its rule
 * current gives at the nominal phase voltage, so at a pole whose phase voltage
 * is V its current is I_rule · Vph / V. Starting from the constant-current pass
 * (already in `spans`), the currents of the whole radial network are rescaled
 * from the pole voltages, every span's drop is recomputed with the same span
 * formula, and the pole voltages are recomputed — until no pole voltage changes
 * by more than CP_TOLERANCE_V, at most CP_MAX_ITERATIONS passes. The voltage used
 * is the one of the phase being checked (worst case) or the balanced one, as set.
 * A span is computed only when the voltage of every load it carries is known
 * (every span between the source and those loads computable); otherwise it is
 * "not computable" (downstream-voltage-unknown). Without convergence (or when a
 * voltage drops to zero) nothing in the network is shown as a result.
 */
const iterateConstantPower = (
  circuit: Circuit,
  spans: SpanResult[],
  dropFns: (((A3: number, A1: number) => number) | undefined)[],
  Vph: number,
  balancedMode: boolean,
): { converged: boolean; iterations: number } => {
  const order = circuit.buses, src = circuit.sourceBus!;
  const feed = (b: string) => circuit.feedSpan.get(b)!;
  const parentOf = (b: string) => circuit.spans[feed(b)].fromBus;
  // voltage known at a pole = every span from the source to it is computable
  const pathOk = new Map<string, boolean>([[src, true]]);
  for (const b of order) if (b !== src) pathOk.set(b, pathOk.get(parentOf(b))! && spans[feed(b)].computable);
  // a span is usable only if no load it carries sits behind an unknown voltage
  const blocked = new Map<string, boolean>();
  for (let k = order.length - 1; k >= 0; k--) {
    const b = order[k];
    const l = circuit.busLoad.get(b);
    const bl = (blocked.get(b) ?? false) || (!!l && (l.single > 0 || l.three > 0) && !pathOk.get(b));
    blocked.set(b, bl);
    if (b !== src) blocked.set(parentOf(b), (blocked.get(parentOf(b)) ?? false) || bl);
  }
  const usable = spans.map((sp, i) => sp.computable && !blocked.get(circuit.spans[i].toBus));
  spans.forEach((sp, i) => {
    if (sp.computable && !usable[i]) { sp.computable = false; sp.dropV = undefined; sp.missing.push('downstream-voltage-unknown'); }
  });

  const cumOf = () => {
    const cum = new Map<string, number>([[src, 0]]);
    for (const b of order) if (b !== src && usable[feed(b)] && cum.has(parentOf(b))) cum.set(b, cum.get(parentOf(b))! + spans[feed(b)].dropV!);
    return cum;
  };
  let cum = cumOf();
  for (let it = 1; it <= CP_MAX_ITERATIONS; it++) {
    // scaled loads → downstream currents (children before parents)
    const d3 = new Map<string, number>(), d1 = new Map<string, number>();
    for (let k = order.length - 1; k >= 0; k--) {
      const b = order[k];
      let a3 = d3.get(b) ?? 0, a1 = d1.get(b) ?? 0;
      const l = circuit.busLoad.get(b);
      if (l && (l.single > 0 || l.three > 0) && cum.has(b)) {
        const V = Vph - cum.get(b)!;
        if (!(V > 0)) return fail(spans, it);
        const k3 = Vph / V;
        a3 += l.three * k3; a1 += l.single * k3;
      }
      d3.set(b, a3); d1.set(b, a1);
      if (b !== src) { const p = parentOf(b); d3.set(p, (d3.get(p) ?? 0) + a3); d1.set(p, (d1.get(p) ?? 0) + a1); }
    }
    spans.forEach((sp, i) => {
      if (!usable[i]) return;
      const to = circuit.spans[i].toBus;
      const A3 = d3.get(to)!, A1 = d1.get(to)!;
      sp.threePhaseA = A3; sp.singlePhaseA = A1;
      sp.phaseCurrentA = sp.system === '1ph2w' ? A1 : balancedMode ? A3 + A1 / 3 : A3 + A1;
      sp.dropV = dropFns[i]!(A3, A1);
    });
    const next = cumOf();
    let delta = 0;
    for (const [b, v] of next) delta = Math.max(delta, Math.abs(v - (cum.get(b) ?? 0)));
    cum = next;
    if (![...next.values()].every(Number.isFinite)) return fail(spans, it);
    if (delta < CP_TOLERANCE_V) return { converged: true, iterations: it };
  }
  return fail(spans, CP_MAX_ITERATIONS);
};

const fail = (spans: SpanResult[], iterations: number) => {
  for (const sp of spans) if (sp.computable) { sp.computable = false; sp.dropV = undefined; sp.missing.push('not-converged'); }
  return { converged: false, iterations };
};
