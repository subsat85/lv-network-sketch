import type { CableElement, ConsumerElement, ConsumerProposal, DistanceFlag, DrawingElement, ElectricalSettings } from '../types/drawing';
import { consumerLoad } from './loads';
import { computeVoltageDrop, type CircuitResult, type PoleResult, type VoltageDropResult } from './voltageDrop';
import { splitSideKey } from './splitStudy';

// «مشترك مقترح» — a new subscriber proposed at a pole (ConsumerElement.proposal).
//
// It is connected to ONE cable chosen at its pole (never by colour). The choice is
// helped by a comparison: for each connection point at the pole the voltage drop is
// calculated with the proposed subscriber connected there (as a permanent
// subscriber, the other subscribers as they are calculated now), and the app marks
// a recommendation — the rule the user approved:
//   1. a connection is left out when, with the subscriber there, any pole of the
//      network it joins is over the drop limit or under the minimum voltage, or that
//      network cannot be computed — wholly, or in part: when any pole of THAT network
//      (the connected network the subscriber's connection point belongs to; other
//      networks are not looked at) has no result, its drop is unknown, so neither
//      its maximum drop nor «no violation» can be stated;
//   2. of the others, the one whose network has the lowest maximum drop (%) is
//      recommended; when equal, the first in the order the candidates are listed
//      (cables in drawing order, then each visit of the pole, then side prev / next).
// The app only recommends: the user chooses. The cable's current-carrying capacity
// is not checked: the app has no approved capacity values yet (reported as such).

export type ProposalSide = 'prev' | 'next';

/** One place at the pole a proposed subscriber can be connected to. */
export interface ConnectionCandidate {
  cableId: string;
  occurrence: number;
  index: number;
  /** set only at a study split (the two sides are separate there) */
  side?: ProposalSide;
  color: string;
  /** neighbouring poles of this visit along the cable */
  prevPoleId?: string;
  nextPoleId?: string;
  /** at a study split: whether this side is the one kept at the pole (with its subscribers) */
  keptSide?: boolean;
}

export const sameConnection = (a: ConsumerProposal['connection'] | undefined, b: ConnectionCandidate) =>
  !!a && a.cableId === b.cableId && a.occurrence === b.occurrence && (a.side ?? undefined) === (b.side ?? undefined);

/** Every connection point at a pole: one per visit of each cable, two (one per side) at an active study split. */
export const connectionCandidates = (elements: DrawingElement[], poleId: string, settings: Pick<ElectricalSettings, 'studySuggestedSplits'>): ConnectionCandidate[] => {
  const out: ConnectionCandidate[] = [];
  for (const e of elements) {
    if (e.type !== 'cable') continue;
    const c = e as CableElement;
    let occ = 0;
    c.poleIds.forEach((pid, i) => {
      if (pid !== poleId) return;
      const occurrence = occ++;
      const base = { cableId: c.id, occurrence, index: i, color: c.strokeColor, prevPoleId: c.poleIds[i - 1], nextPoleId: c.poleIds[i + 1] };
      const interior = i > 0 && i < c.poleIds.length - 1;
      if (settings.studySuggestedSplits && interior && (c.suggestedSplits ?? []).includes(pid)) {
        const kept = c.splitConsumerSides?.[splitSideKey(pid, occurrence)];
        for (const side of ['prev', 'next'] as const) out.push({ ...base, side, keptSide: kept === side });
      } else out.push(base);
    });
  }
  return out;
};

/** The proposal's connection for a candidate (`side` only when the candidate has one). */
export const connectionOf = (c: ConnectionCandidate): NonNullable<ConsumerProposal['connection']> =>
  (c.side ? { cableId: c.cableId, occurrence: c.occurrence, side: c.side } : { cableId: c.cableId, occurrence: c.occurrence });

export interface CandidateResult {
  candidate: ConnectionCandidate;
  /** the network computed with the subscriber there */
  computable: boolean;
  /** why not, in words for the panel */
  reason?: string;
  /** voltage at the subscriber's pole and its drop there */
  atPole?: PoleResult;
  /** maximum drop of the network it joins, % (with the subscriber), and before it */
  maxPercent?: number;
  maxPercentBefore?: number;
  /** poles of that network over the limit / under the minimum voltage, with the subscriber */
  violations: string[];
  /** poles of that network without a result (missing data): the network is only partly computed */
  incompletePoleIds?: string[];
  /** the network's source */
  sourcePoleId?: string;
  recommended?: boolean;
}

export interface Comparison {
  results: CandidateResult[];
  recommended?: CandidateResult;
  /** no candidate qualifies: why */
  noRecommendation?: string;
}

const circuitWithBus = (r: VoltageDropResult, bus: string): CircuitResult | undefined => r.circuits.find((c) => c.circuit.buses.includes(bus));

/**
 * The comparison of the connection points at the subscriber's pole. `draft` is the
 * proposed subscriber (its load values); each candidate is calculated with it
 * connected there and included in the calculation, everything else as now.
 */
export const compareConnections = (
  elements: DrawingElement[], distances: Record<string, string>, settings: ElectricalSettings, flags: Record<string, DistanceFlag>,
  draft: ConsumerElement, candidates: ConnectionCandidate[],
): Comparison => {
  const others = elements.filter((e) => e.id !== draft.id);
  const before = computeVoltageDrop(others, distances, settings, flags);
  const results: CandidateResult[] = candidates.map((candidate) => {
    const trial: ConsumerElement = { ...draft, color: candidate.color, strokeColor: candidate.color, fillColor: candidate.color, proposal: { ...(draft.proposal ?? { status: 'proposed' }), status: 'confirmed', connection: connectionOf(candidate) } };
    const r = computeVoltageDrop([...others, trial], distances, settings, flags);
    const atPole = (r.byPole.get(draft.poleId) ?? []).find((p) => p.consumerIds.includes(draft.id));
    const circuit = atPole ? circuitWithBus(r, atPole.bus) : undefined;
    const base: CandidateResult = { candidate, computable: false, violations: [], atPole, sourcePoleId: circuit?.circuit.sourcePoleId };
    if (r.settingsMissing.length) return { ...base, reason: 'إعدادات الحساب ناقصة' };
    if (!atPole || !circuit) return { ...base, reason: 'غير متصل بشبكة' };
    if (circuit.status !== 'ok') return { ...base, reason: 'الشبكة غير قابلة للحساب' };
    if (atPole.status === 'na' || circuit.maxPercent === undefined) return { ...base, reason: 'بيانات ناقصة على المسار' };
    // the network the subscriber joins (only that one) must be computed at every pole
    const incomplete = [...new Set(circuit.poles.filter((p) => p.status === 'na').map((p) => p.poleId))];
    if (incomplete.length) return { ...base, incompletePoleIds: incomplete, reason: 'جزء من الشبكة غير قابل للحساب (بيانات ناقصة) — لا يمكن التحقق من جميع المشتركين' };
    const prev = circuitWithBus(before, atPole.bus);
    return {
      ...base, computable: true, maxPercent: circuit.maxPercent,
      maxPercentBefore: prev?.status === 'ok' ? prev.maxPercent : undefined,
      violations: [...new Set(circuit.poles.filter((p) => p.status === 'over').map((p) => p.poleId))],
    };
  });
  const eligible = results.filter((x) => x.computable && x.violations.length === 0);
  if (!eligible.length) {
    return { results, noRecommendation: results.some((x) => x.computable) ? 'كل نقاط الربط تُسبّب تجاوزًا لحد الهبوط أو أدنى فولتية' : 'لا توجد نقطة ربط قابلة للحساب' };
  }
  const best = eligible.reduce((a, b) => (b.maxPercent! < a.maxPercent! - 1e-12 ? b : a));
  best.recommended = true;
  return { results, recommended: best };
};

/** The load of a proposed subscriber in words: «3φ 63 A», «1φ ×2 = 8 A». */
export const proposalLoadText = (c: Pick<ConsumerElement, 'variant' | 'label' | 'count'>) => {
  const l = consumerLoad(c);
  if (l.invalid) return 'حمل غير صالح';
  const n = l.count > 1 ? ` ×${l.count}` : '';
  return `${l.kind === 'single' ? '1φ' : '3φ'}${n} ${fmtA(l.amps)} A`;
};
const fmtA = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** All proposed subscribers of the drawing. */
export const proposedConsumers = (elements: DrawingElement[]) =>
  elements.filter((e): e is ConsumerElement => e.type === 'consumer' && !!(e as ConsumerElement).proposal);
