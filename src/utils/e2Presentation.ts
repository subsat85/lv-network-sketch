// E2 study — the UI presentation adapter.
//
// This is the ONLY file of the app that imports the E2 engine (src/engine/e2): the approved,
// documented exception to the purity rule N5 (src/engine/__tests__/purity.test.ts). It imports
// nothing else of src/engine.
//
//   project document → runStudyE2 (topology → E2 build → E2 sweep) → E2StudyResult
//                    → the helpers below (names, counts, texts) → E2ResultsPanel
//                    → voltageView (the per-pole / per-span view) → the voltage-drop panel, the
//                      drawing overlay, the preview / PDF / share image, the text report, the span
//                      sheet's live check and the comparison of a proposed subscriber's connection
// E2 is the only electrical calculation of the app: every voltage-drop value shown anywhere comes
// from here.
//
// Inputs: an existing project ('legacy-project'), the app's catalogue (empty), no catalogue
// selection, the phase allocation of the project's Single-Phase Load Allocation Method.
// Nothing missing is filled in, nothing is saved.
// No electrical calculation is done here: every number shown is a Quantity of the E2 result,
// with its own status; a value that is not there is shown as '—', never as 0.

import { runStudyE2, type E2StudyResult, type WorstCaseGuarantee } from '../engine/e2';
import type { CircuitResult, SpanResult } from '../engine/e2/model';
import type { InputName, InputRef, Phasor, Quantity, QuantityStatus, UnavailableReason, WarningCode } from '../engine/e2/quantity';
import type { CableElement, DistanceFlag, DrawingElement, ElectricalSettings } from '../types/drawing';
import { buildNetwork, type Circuit, type Network, type NetworkIssue } from './network';
import { networkOptions, spanKey, spanLength } from './spanLength';
import { ar } from '../i18n/ar';
import type { TKey, TParams } from '../i18n';

export type { E2StudyResult } from '../engine/e2';
export type { CircuitResult, LoadResult, NodeResult, SpanResult, Conductor } from '../engine/e2/model';
export type { InputRef, Phasor, Quantity, QuantityStatus } from '../engine/e2/quantity';
export type E2Issue = E2StudyResult['issues'][number];
type Tr = (key: TKey, params?: TParams) => string;

/** the document the study reads (read only) */
export interface E2DocumentInput {
  elements: readonly DrawingElement[];
  connectionDistances: Readonly<Record<string, string>>;
  distanceFlags: Readonly<Record<string, DistanceFlag>>;
  electrical: Readonly<ElectricalSettings>;
}

/**
 * The E2 study of a document: an existing project ('legacy-project'), the app's catalogue (empty),
 * no catalogue selection, and the phases of the single-phase subscribers from the project's
 * Single-Phase Load Allocation Method (settings.singlePhaseMode; Equal Phase Current when not stored).
 */
export const runE2Study = (d: E2DocumentInput): E2StudyResult =>
  runStudyE2({ elements: d.elements, connectionDistances: d.connectionDistances, distanceFlags: d.distanceFlags, electrical: d.electrical },
    { inputOrigin: 'legacy-project', allocationMethod: d.electrical.singlePhaseMode === 'worst' ? 'worst' : 'balanced' });

// ---------- every code the result can carry, each with its text (checked by the compiler) ----------

export const STATUSES: readonly QuantityStatus[] = ['computed', 'provisional', 'unavailable', 'not-run'];
const REASONS = ['circuit-not-computed', 'cable-type-conflict', 'system-missing', 'impedance-missing', 'neutral-impedance-missing', 'neutral-parallel-unknown', 'neutral-conductor-missing',
  'phase-parallel-unknown', 'parallel-invalid', 'parallel-conflict', 'length-missing', 'length-suspect', 'phase-allocation-missing', 'phase-allocation-invalid',
  'phase-allocation-conflict', 'phase-not-present', 'three-phase-on-single-phase', 'invalid-load', 'not-converged', 'settings-missing', 'energy-needs-load-profile',
  'node-voltage-unknown', 'upstream-unavailable'] as const satisfies readonly UnavailableReason[];
const WARNINGS = ['length-estimated', 'span-review', 'span-inherited', 'source-unknown', 'catalogue-unverified', 'dc-resistance-used', 'dc-resistance-as-entered', 'load-default',
  'power-factor-default', 'phase-parallel-default', 'allocation-unverified', 'proposed-load', 'orphan-consumer-excluded', 'proposed-consumer-excluded'] as const satisfies readonly WarningCode[];
// a reason or warning added to E2 without a text here is a compile error
type Exhaustive<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
export const REASON_CODES: readonly UnavailableReason[] = REASONS satisfies readonly UnavailableReason[] & (Exhaustive<UnavailableReason, (typeof REASONS)[number]> extends true ? unknown : never);
export const WARNING_CODES: readonly WarningCode[] = WARNINGS satisfies readonly WarningCode[] & (Exhaustive<WarningCode, (typeof WARNINGS)[number]> extends true ? unknown : never);

export const statusLabel = (s: QuantityStatus, tr: Tr) => tr(`e2.status.${s}`);
export const reasonLabel = (r: UnavailableReason | undefined, tr: Tr) => (r ? tr(`e2.reason.${r}`) : '');
export const warningLabel = (w: WarningCode, tr: Tr) => tr(`e2.warning.${w}`);

// ---------- values: shown only when the quantity has one ----------

export const hasValue = <T>(q: Quantity<T>): q is Quantity<T> & { value: T } => q.status === 'computed' || q.status === 'provisional';
/** the value with its unit; '≈' marks a provisional value; '—' when there is none (never 0) */
export const numText = (q: Quantity<number>, digits = 2): string =>
  hasValue(q) && Number.isFinite(q.value) ? `${q.status === 'provisional' ? '≈' : ''}${q.value.toFixed(digits)}${q.unit === 'none' || q.unit === 'count' ? '' : ` ${q.unit === '%' ? '%' : q.unit}`}` : '—';
export const phasorText = (q: Quantity<Phasor>, digits = 2): string =>
  hasValue(q) && Number.isFinite(q.value.magnitude) ? `${q.status === 'provisional' ? '≈' : ''}${q.value.magnitude.toFixed(digits)} ${q.unit} ∠ ${q.value.angleDeg.toFixed(1)}°` : '—';

// ---------- the study ----------

export type StatusCounts = Record<QuantityStatus, number> & { total: number };
/** the circuits by the completeness of their result (not by the numerical solve) */
export const studyOverview = (r: E2StudyResult): StatusCounts => {
  const out: StatusCounts = { total: r.circuits.length, computed: 0, provisional: 0, unavailable: 0, 'not-run': 0 };
  for (const c of r.circuits) out[c.completeness.status] += 1;
  return out;
};

/** the source pole of a circuit the network could calculate (its first node); undefined otherwise */
export const sourcePoleOf = (c: CircuitResult): string | undefined => (c.solve.reason === 'circuit-not-computed' ? undefined : c.nodes[0]?.poleId);
export const polesOf = (c: CircuitResult): string[] => [...new Set(c.nodes.map((n) => n.poleId))];

// ---------- issues ----------

export interface IssueView {
  code: string;
  severity: E2Issue['severity'];
  target: E2Issue['target'];
  /** the text of the code, when there is one */
  textKey?: TKey;
  source?: string;
  circuitIds: string[];
  /** every other field of the issue, as given */
  fields: [string, string | number][];
}
const SEVERITY_ORDER: Record<E2Issue['severity'], number> = { blocks: 0, provisional: 1, reported: 2 };
const lookup = (key: string): boolean => {
  let node: unknown = ar;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
};
/** 'network:loop' → e2.issue.network.loop; 'length-suspect' → e2.issue.plain.length-suspect */
export const issueTextKey = (code: string): TKey | undefined => {
  const i = code.indexOf(':');
  const key = i < 0 ? `e2.issue.plain.${code}` : `e2.issue.${code.slice(0, i)}.${code.slice(i + 1)}`;
  return lookup(key) ? (key as TKey) : undefined;
};
/** every issue, nothing dropped: those that block first, then those that make results provisional */
export const issueViews = (r: E2StudyResult): IssueView[] =>
  r.issues
    .map((i, order) => ({ i, order }))
    .sort((x, y) => SEVERITY_ORDER[x.i.severity] - SEVERITY_ORDER[y.i.severity] || x.order - y.order)
    .map(({ i }) => {
      const { source, circuitIds, ...rest } = i.params ?? {};
      const textKey = issueTextKey(i.code);
      return {
        code: i.code, severity: i.severity, target: i.target,
        ...(textKey ? { textKey } : {}),
        ...(source !== undefined ? { source: String(source) } : {}),
        circuitIds: circuitIds !== undefined ? String(circuitIds).split(',').filter(Boolean) : [],
        fields: Object.entries(rest),
      };
    });

// ---------- spans ----------

const INPUT_ORDER = ['L', 'system', 'phase', 'R', 'X', 'np', 'RN', 'XN', 'nN'] as const satisfies readonly InputName[];
export type SpanInputName = (typeof INPUT_ORDER)[number];
export type SpanInput = InputRef & { name: SpanInputName };
const isSpanInput = (i: InputRef): i is SpanInput => (INPUT_ORDER as readonly string[]).includes(i.name);
/** the inputs of the span that its results were calculated with (empty when it has none) */
export const spanInputs = (s: SpanResult): SpanInput[] => {
  const qs: Quantity<unknown>[] = [...Object.values(s.current), ...Object.values(s.perSetCurrentA), ...Object.values(s.dropV), s.pLossW, s.qAbsorbedVar];
  const seen = new Map<SpanInputName, SpanInput>();
  for (const q of qs) for (const i of q.inputs) if (i.element === s.key && isSpanInput(i) && !seen.has(i.name)) seen.set(i.name, i);
  return INPUT_ORDER.filter((n) => seen.has(n)).map((n) => seen.get(n)!);
};
export const inputUnit = (n: InputName): string => (n === 'L' ? 'm' : n === 'R' || n === 'X' || n === 'RN' || n === 'XN' ? 'Ω/km' : '');

/** `cableId#index` → the cable and the two poles of that span in the drawing (names only) */
export const spanPlace = (key: string, cables: ReadonlyMap<string, CableElement>): { cable?: CableElement; index: number; from?: string; to?: string } => {
  const h = key.lastIndexOf('#');
  const index = Number(key.slice(h + 1));
  const cable = cables.get(key.slice(0, h));
  return { ...(cable ? { cable } : {}), index, ...(cable ? { from: cable.poleIds[index], to: cable.poleIds[index + 1] } : {}) };
};

/** the warnings shared by the results of a circuit (D1-LOC couples them): read from its quantities */
export const circuitWarnings = (c: CircuitResult): WarningCode[] => {
  const all = [c.pLossW, c.qAbsorbedVar, ...c.nodes.flatMap((n) => Object.values(n.dropV)), ...c.spans.flatMap((s) => [s.pLossW, ...Object.values(s.current)])];
  return [...new Set(all.flatMap((q) => q.warnings))];
};

// ---------- names: what the user sees instead of ids (the ids stay in the technical details) ----------

export interface Namer {
  pole: (id: string) => string;
  cable: (id: string) => string;
  span: (key: string) => string;
  consumer: (id: string) => string;
  circuit: (id: string) => string;
  /** any id a result or an issue names: a span key, a consumer, a cable, a pole, a circuit */
  element: (id: string) => string;
  target: (t: E2Issue['target']) => string;
}
/** Names from the drawing (in drawing order: cable 1, 2 …; poles as the rest of the app names them). */
export const makeNamer = (elements: readonly DrawingElement[], circuitIds: readonly string[], pole: (id: string) => string, tr: Tr): Namer => {
  const cables = new Map<string, { c: CableElement; n: number }>();
  const consumers = new Map<string, Extract<DrawingElement, { type: 'consumer' }>>();
  const poles = new Set<string>();
  for (const e of elements) {
    if (e.type === 'cable') cables.set(e.id, { c: e, n: cables.size + 1 });
    else if (e.type === 'consumer') consumers.set(e.id, e);
    else if (e.type === 'symbol') poles.add(e.id);
  }
  const circuits = new Map(circuitIds.map((id, i) => [id, i + 1]));
  const cable = (id: string) => {
    const x = cables.get(id);
    if (!x) return tr('e2.name.unknown');
    const p = x.c.poleIds;
    return p.length ? tr('e2.name.cable', { n: x.n, from: pole(p[0]), to: pole(p[p.length - 1]) }) : tr('e2.name.cableShort', { n: x.n });
  };
  const span = (key: string) => {
    const h = key.lastIndexOf('#');
    const x = cables.get(key.slice(0, h));
    const i = Number(key.slice(h + 1));
    if (!x || !Number.isInteger(i) || x.c.poleIds[i + 1] === undefined) return tr('e2.name.spanUnknown');
    return tr('e2.name.span', { from: pole(x.c.poleIds[i]), to: pole(x.c.poleIds[i + 1]), n: i + 1, cable: x.n });
  };
  const consumer = (id: string) => {
    const c = consumers.get(id);
    if (!c) return tr('e2.name.consumerUnknown');
    const count = c.count || 1;
    const key = c.variant === 'circle' ? (count === 1 ? 'e2.name.consumerSingleOne' : 'e2.name.consumerSingle') : (count === 1 ? 'e2.name.consumerThreeOne' : 'e2.name.consumerThree');
    const base = tr(key, { count, pole: pole(c.poleId) });
    return c.proposal ? tr('e2.name.proposed', { name: base }) : base;
  };
  const circuit = (id: string) => (circuits.has(id) ? tr('e2.circuit', { n: circuits.get(id)! }) : tr('e2.name.unknown'));
  const element = (id: string) =>
    circuits.has(id) ? circuit(id) : consumers.has(id) ? consumer(id) : cables.has(id) ? cable(id)
      : id.includes('#') && cables.has(id.slice(0, id.lastIndexOf('#'))) ? span(id) : poles.has(id) ? pole(id) : tr('e2.name.unknown');
  const target = (t: E2Issue['target']) => {
    switch (t.kind) {
      case 'span': return span(t.id);
      case 'consumer': return consumer(t.id);
      case 'cable': return cable(t.id);
      case 'pole': return t.id.split('|').map(pole).join(tr('common.listSep'));
      case 'circuit': return circuit(t.id);
      case 'settings': return tr('e2.name.settings');
      default: return tr('e2.name.legacyElement');
    }
  };
  return { pole, cable, span, consumer, circuit, element, target };
};

// ---------- why values are missing: each reason once, with the values it affects ----------

/** the input a reason is about (a text key), when the reason is about one of the inputs */
const INPUT_REASONS: ReadonlySet<UnavailableReason> = new Set<UnavailableReason>(['parallel-invalid', 'parallel-conflict', 'length-missing', 'length-suspect', 'impedance-missing',
  'neutral-impedance-missing', 'neutral-conductor-missing', 'phase-parallel-unknown', 'neutral-parallel-unknown', 'system-missing', 'phase-allocation-missing',
  'phase-allocation-invalid', 'phase-allocation-conflict', 'three-phase-on-single-phase', 'invalid-load', 'settings-missing']);
export const inputOfReason = (r: UnavailableReason): TKey | undefined => (INPUT_REASONS.has(r) ? (`e2.inputOf.${r}` as TKey) : undefined);

/** the kind of a quantity, as a text key (e2.q.*) */
export type QuantityKind = 'voltage' | 'neutralShift' | 'lineV' | 'drop' | 'dropPercent' | 'current' | 'perSet' | 'arithmeticSum' | 'pLoss' | 'qAbsorbed' | 'loadCurrent' | 'apparentPower';
/** where a quantity is: a node (bus), a span (key), a load (consumer) or the circuit totals */
export type QuantityPlace = { kind: 'node'; id: string; poleId: string } | { kind: 'span'; id: string } | { kind: 'load'; id: string } | { kind: 'totals' };
export interface ReasonGroup {
  /** 1, 2 … in the circuit */
  n: number;
  status: 'unavailable' | 'not-run';
  reason: UnavailableReason;
  blockedBy: string[];
  /** the input it is about, when it is about one */
  inputKey?: TKey;
  /** the value entered for that input, as an issue of the result gives it (e.g. parallel = 1.5) */
  entered?: string;
  /** the places whose values have no value for this reason, with the kinds of value */
  affected: { place: QuantityPlace; kinds: QuantityKind[] }[];
  count: number;
}
const placeKey = (p: QuantityPlace) => (p.kind === 'totals' ? 'totals' : `${p.kind}:${p.id}`);
/** every quantity of a circuit, with its place and kind */
export const circuitQuantities = (c: CircuitResult): { q: Quantity<unknown>; place: QuantityPlace; kind: QuantityKind }[] => {
  const out: { q: Quantity<unknown>; place: QuantityPlace; kind: QuantityKind }[] = [];
  const add = (place: QuantityPlace, kind: QuantityKind, qs: Quantity<unknown>[]) => { for (const q of qs) out.push({ q, place, kind }); };
  add({ kind: 'totals' }, 'pLoss', [c.pLossW]);
  add({ kind: 'totals' }, 'qAbsorbed', [c.qAbsorbedVar]);
  for (const n of c.nodes) {
    const place: QuantityPlace = { kind: 'node', id: n.bus, poleId: n.poleId };
    add(place, 'voltage', Object.values(n.voltage)); add(place, 'drop', Object.values(n.dropV)); add(place, 'dropPercent', Object.values(n.dropPercent));
    add(place, 'lineV', Object.values(n.lineV)); add(place, 'neutralShift', [n.neutralShiftV]);
  }
  for (const s of c.spans) {
    const place: QuantityPlace = { kind: 'span', id: s.key };
    add(place, 'current', Object.values(s.current)); add(place, 'perSet', Object.values(s.perSetCurrentA)); add(place, 'arithmeticSum', Object.values(s.arithmeticSumA));
    add(place, 'drop', Object.values(s.dropV)); add(place, 'pLoss', [s.pLossW]); add(place, 'qAbsorbed', [s.qAbsorbedVar]);
  }
  for (const l of c.loads) {
    const place: QuantityPlace = { kind: 'load', id: l.consumerId };
    add(place, 'loadCurrent', Object.values(l.currentA));
    if (l.apparentPowerVA) add(place, 'apparentPower', Object.values(l.apparentPowerVA));
  }
  return out;
};
/**
 * The reasons why values of a circuit have no value, each once (same status and reason; the
 * elements the result names as the cause are merged), in the order they first appear; `groupOf` gives the group of a quantity (none for a value, or
 * for a phase the node does not have, which is not missing).
 */
export const reasonGroups = (c: CircuitResult, issues: readonly E2Issue[]): { groups: ReasonGroup[]; groupOf: (q: Quantity<unknown>) => number | undefined } => {
  const groups = new Map<string, ReasonGroup>();
  const of = new Map<Quantity<unknown>, number>();
  for (const { q, place, kind } of circuitQuantities(c)) {
    if (q.status !== 'unavailable' && q.status !== 'not-run') continue;
    if (!q.reason || q.reason === 'phase-not-present') continue;
    const key = `${q.status}|${q.reason}`;
    let g = groups.get(key);
    if (!g) {
      const inputKey = inputOfReason(q.reason);
      g = { n: groups.size + 1, status: q.status, reason: q.reason, blockedBy: [], ...(inputKey ? { inputKey } : {}), affected: [], count: 0 };
      groups.set(key, g);
    }
    for (const b of q.blockedBy ?? []) if (!g.blockedBy.includes(b)) g.blockedBy.push(b);
    if (g.entered === undefined) {
      // the value entered for that input, from an issue of the result about the same element and reason
      const issue = issues.find((i) => g!.blockedBy.includes(i.target.id) && i.code === q.reason && i.params?.value !== undefined);
      if (issue) g.entered = String(issue.params!.value);
    }
    g.count += 1;
    of.set(q, g.n);
    const at = g.affected.find((a) => placeKey(a.place) === placeKey(place));
    if (at) { if (!at.kinds.includes(kind)) at.kinds.push(kind); } else g.affected.push({ place, kinds: [kind] });
  }
  return { groups: [...groups.values()], groupOf: (q) => of.get(q) };
};

// ---------- the voltage-drop view: one row per pole and per span, from the E2 result only ----------
//
// Every number here is read from an E2 Quantity (nothing is calculated): a pole's value is the one
// of its worst phase (the highest phase-to-neutral drop of the node), a span's drop is its largest
// phase drop, its currents are the E2 phase and neutral currents. A value E2 does not give stays
// undefined (shown as '—', never 0), with E2's reason.

export type PoleStatus = 'ok' | 'near' | 'over' | 'na';
export type VdPhase = 'a' | 'b' | 'c';
const VD_PHASES: readonly VdPhase[] = ['a', 'b', 'c'];

export interface VdPole {
  poleId: string;
  bus: string;
  circuitId: string;
  /** colour of the cable feeding this point (for display) */
  color: string;
  status: PoleStatus;
  /** worst phase of the node: its drop (V), % of the nominal phase voltage, phase-to-neutral voltage */
  phase?: VdPhase;
  dropV?: number;
  percent?: number;
  phaseV?: number;
  /** lowest phase-to-phase voltage of the node, where every line voltage is known */
  lineV?: number;
  consumerIds: string[];
  /** why there is no value (E2's reason) */
  reason?: UnavailableReason;
  /** the value is provisional (E2 status), with the warnings it carries */
  provisional: boolean;
  warnings: WarningCode[];
}
export interface VdSpan {
  key: string;
  cableId: string;
  index: number;
  spanId: string | undefined;
  fromPole: string;
  toPole: string;
  color: string;
  lengthM?: number;
  /** every phase the span has got a value */
  computable: boolean;
  /** why values are missing (E2's reasons, each once) */
  reasons: UnavailableReason[];
  /** the largest phase drop of the span, V, and its phase */
  dropV?: number;
  dropPhase?: VdPhase;
  /** the drop at the span's end (worst phase of its downstream node), V */
  cumulativeDropV?: number;
  /** E2 currents, A (magnitudes): a, b, c and the neutral */
  currentA: Partial<Record<VdPhase | 'n', number>>;
  /** E2's current per cable assembly, A (|I| / n, its perSetCurrentA): a, b, c and the neutral */
  perSetCurrentA: Partial<Record<VdPhase | 'n', number>>;
  provisional: boolean;
  warnings: WarningCode[];
}
export interface VdCircuit {
  circuit: Circuit;
  status: Circuit['status'];
  spans: VdSpan[];
  poles: VdPole[];
  maxPercent?: number;
  worstPoleId?: string;
  worstPhase?: VdPhase;
  worstProvisional?: boolean;
  loadModel: 'constant-current' | 'constant-power';
  converged?: boolean;
  iterations?: number;
  /** why the circuit was not solved (E2) */
  reason?: UnavailableReason;
  /** E2's status of the circuit's result as a whole, and why it is not complete */
  completeness: { status: QuantityStatus; reason?: UnavailableReason };
  /** Worst Case only: how the worst distribution of this circuit was found (engine/e2/worstCase.ts) */
  worstCase?: WorstCaseGuarantee;
}
export type { WorstCaseGuarantee };
/** the least certain of the circuits' Worst Case guarantees ('searched' < 'exhaustive' < 'condition') */
export const weakestGuarantee = (circuits: readonly VdCircuit[]): WorstCaseGuarantee | undefined => {
  const g = new Set(circuits.map((c) => c.worstCase).filter((x) => x && x !== 'not-needed'));
  return g.has('searched') ? 'searched' : g.has('exhaustive') ? 'exhaustive' : g.has('condition') ? 'condition' : undefined;
};
export interface VoltageView {
  settings: ElectricalSettings;
  /** the Single-Phase Load Allocation Method the results were calculated with */
  method: 'worst' | 'balanced';
  /** Worst Case only: the least certain guarantee over the circuits (undefined: nothing to choose) */
  worstCase?: WorstCaseGuarantee;
  circuits: VdCircuit[];
  /** pole id → results at that pole (one per circuit / bus) */
  byPole: Map<string, VdPole[]>;
  /** span key → its result */
  bySpan: Map<string, VdSpan>;
  /** problems of the drawing's network (each once) */
  issues: NetworkIssue[];
  network: Network;
  study: E2StudyResult;
}

const valueOf = (q: Quantity<number> | undefined): number | undefined => (q && hasValue(q) && Number.isFinite(q.value) ? q.value : undefined);

/** The voltage-drop view of a document (E2 only). */
export const voltageView = (d: E2DocumentInput, study: E2StudyResult = runE2Study(d)): VoltageView => {
  const settings = study.settings;
  const network = buildNetwork(d.elements as DrawingElement[], networkOptions(settings));
  const e2 = new Map(study.circuits.map((c) => [c.id, c]));
  const byPole = new Map<string, VdPole[]>();
  const bySpan = new Map<string, VdSpan>();
  const circuits: VdCircuit[] = [];
  const loadModel = settings.loadModel ?? 'constant-current';

  for (const circuit of network.circuits) {
    const r = e2.get(circuit.id);
    const nodes = new Map((r?.nodes ?? []).map((n) => [n.bus, n]));
    const e2spans = new Map((r?.spans ?? []).map((s) => [s.key, s]));
    const poleOf = (bus: string) => network.poleOfBus.get(bus)!;
    const colorAt = new Map<string, string>();
    for (const s of circuit.spans) { if (!colorAt.has(s.toBus)) colorAt.set(s.toBus, s.color); if (!colorAt.has(s.fromBus)) colorAt.set(s.fromBus, s.color); }

    const poles: VdPole[] = [];
    const worstAt = new Map<string, { phase: VdPhase; dropV: number } | undefined>();
    for (const bus of circuit.buses) {
      if (circuit.status === 'ok' && bus === circuit.sourceBus) continue;
      const n = nodes.get(bus);
      const pole: VdPole = { poleId: poleOf(bus), bus, circuitId: circuit.id, color: colorAt.get(bus) ?? '#000000', status: 'na', consumerIds: circuit.busLoad.get(bus)?.consumerIds ?? [], provisional: false, warnings: [] };
      if (n) {
        let worst: VdPhase | undefined;
        for (const p of VD_PHASES) {
          const v = valueOf(n.dropPercent[p]);
          // the first phase wins a tie (equal within rounding): a balanced node reads phase a
          if (v !== undefined && (worst === undefined || v > valueOf(n.dropPercent[worst])! + 1e-9)) worst = p;
        }
        if (worst && n.limit !== 'na') {
          const q = n.dropPercent[worst];
          pole.phase = worst;
          pole.percent = valueOf(q);
          pole.dropV = valueOf(n.dropV[worst]);
          pole.phaseV = hasValue(n.voltage[worst]) ? n.voltage[worst].value!.magnitude : undefined;
          const lines = (['ab', 'bc', 'ca'] as const).map((k) => n.lineV[k]);
          if (lines.every((l) => valueOf(l) !== undefined)) pole.lineV = Math.min(...lines.map((l) => l.value!));
          pole.status = n.limit;
          pole.provisional = q.status === 'provisional';
          pole.warnings = [...q.warnings];
          worstAt.set(bus, pole.dropV !== undefined ? { phase: worst, dropV: pole.dropV } : undefined);
        } else {
          const q = VD_PHASES.map((p) => n.dropPercent[p]).find((x) => !hasValue(x) && x.reason !== 'phase-not-present') ?? n.dropPercent.a;
          pole.reason = q.reason;
        }
      } else pole.reason = 'circuit-not-computed';
      poles.push(pole);
    }

    const spans: VdSpan[] = circuit.spans.map((s) => {
      const key = spanKey(s.cableId, s.index);
      const x = e2spans.get(key);
      const len = spanLength(d.connectionDistances as Record<string, string>, s.fromPole, s.toPole);
      const sp: VdSpan = { key, cableId: s.cableId, index: s.index, spanId: s.spanId, fromPole: s.fromPole, toPole: s.toPole, color: s.color, ...(len.m !== undefined ? { lengthM: len.m } : {}), computable: false, reasons: [], currentA: {}, perSetCurrentA: {}, provisional: false, warnings: [] };
      if (x) {
        const drops = VD_PHASES.map((p) => ({ p, q: x.dropV[p] }));
        const present = drops.filter(({ q }) => hasValue(q) || q.reason !== 'phase-not-present');
        const missing = present.filter(({ q }) => !hasValue(q));
        sp.reasons = [...new Set([...missing.map(({ q }) => q.reason!), ...(missing.length ? [] : (['a', 'b', 'c', 'n'] as const).map((k) => x.current[k]).filter((q) => !hasValue(q) && q.reason !== 'phase-not-present').map((q) => q.reason!))].filter(Boolean))];
        sp.computable = present.length > 0 && missing.length === 0;
        for (const { p, q } of drops) {
          const v = valueOf(q);
          if (v !== undefined && (sp.dropV === undefined || v > sp.dropV + 1e-9)) { sp.dropV = v; sp.dropPhase = p; }
        }
        for (const k of ['a', 'b', 'c', 'n'] as const) { const q = x.current[k]; if (hasValue(q)) sp.currentA[k] = q.value!.magnitude; }
        for (const k of ['a', 'b', 'c', 'n'] as const) { const q = x.perSetCurrentA[k]; if (hasValue(q) && Number.isFinite(q.value)) sp.perSetCurrentA[k] = q.value!; }
        const ref = present.find(({ q }) => hasValue(q))?.q;
        sp.provisional = !!ref && ref.status === 'provisional';
        sp.warnings = ref ? [...ref.warnings] : [];
      } else sp.reasons = ['circuit-not-computed'];
      const end = worstAt.get(s.toBus);
      if (end) sp.cumulativeDropV = end.dropV;
      bySpan.set(key, sp);
      return sp;
    });

    const cr: VdCircuit = { circuit, status: circuit.status, spans, poles, loadModel, completeness: r ? { status: r.completeness.status, ...(r.completeness.reason ? { reason: r.completeness.reason } : {}) } : { status: 'not-run', reason: 'circuit-not-computed' } };
    const wc = study.worstCase?.[circuit.id];
    if (wc) cr.worstCase = wc.guarantee;
    if (r) {
      if (r.solve.reason) cr.reason = r.solve.reason;
      if (loadModel === 'constant-power' && r.solve.status !== 'not-run') { cr.converged = r.solve.converged ?? false; if (r.solve.iterations !== undefined) cr.iterations = r.solve.iterations; }
      if (r.worst) {
        const p = poles.find((x) => x.bus === r.worst!.bus && x.percent !== undefined);
        if (p) { cr.maxPercent = p.percent; cr.worstPoleId = p.poleId; cr.worstPhase = p.phase; cr.worstProvisional = p.provisional; }
      }
    }
    for (const p of poles) byPole.set(p.poleId, [...(byPole.get(p.poleId) ?? []), p]);
    circuits.push(cr);
  }
  // network problems, each once
  const seen = new Set<string>();
  const issues: NetworkIssue[] = [];
  for (const i of [...network.issues, ...network.circuits.flatMap((c) => c.issues)]) { const k = JSON.stringify(i); if (!seen.has(k)) { seen.add(k); issues.push(i); } }
  const method = study.allocationMethod ?? (settings.singlePhaseMode === 'worst' ? 'worst' : 'balanced');
  const worstCase = method === 'worst' ? weakestGuarantee(circuits) : undefined;
  return { settings, method, ...(worstCase ? { worstCase } : {}), circuits, byPole, bySpan, issues, network, study };
};

// the last view, kept while the document parts it was made from are the same objects (the drawing
// overlay, the panel and the preview share one calculation instead of one each)
let last: { d: E2DocumentInput; view: VoltageView } | undefined;
/** voltageView, calculated once per document state */
export const cachedVoltageView = (d: E2DocumentInput): VoltageView => {
  if (last && last.d.elements === d.elements && last.d.connectionDistances === d.connectionDistances && last.d.distanceFlags === d.distanceFlags && last.d.electrical === d.electrical) return last.view;
  const view = voltageView(d);
  last = { d, view };
  return view;
};
