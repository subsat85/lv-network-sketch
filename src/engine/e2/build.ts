// E2: the drawing → the network of the sweep. The topology is E1's (toNetwork, built
// once from the existing buildNetwork, unchanged); here every span gets its conductor
// impedances with their sources (catalogue/resolve.ts) and every load its phases
// (phases.ts). Nothing in the document is written; what is missing stays missing.

import type { CableElement, ConsumerElement, DrawingElement, ElectricalSettings } from '../../types/drawing';
import { toNetwork } from '../adapter';
import { networkIssueTarget, type DataIssue } from '../issues';
import type { NetworkIssue } from '../../utils/network';
import type { NetBranch, NetLoad, ProjectDocument } from '../model';
import { c, scale } from './complex';
import { resolveSpan, type CatalogueSelection, type InputOrigin, type Resolved } from './catalogue/resolve';
import type { CableEntry } from './catalogue/schema';
import type { E2Circuit, E2Load, E2Span, ZData } from './model';
import { consumerPhases, PHASES, spanPhase, type Phase, type PhaseAllocation } from './phases';
import type { InputRef, UnavailableReason, WarningCode } from './quantity';

export interface BuildInput {
  doc: ProjectDocument;
  settings: ElectricalSettings;
  powerFactorDefaulted: boolean;
  origin: InputOrigin;
  entries: ReadonlyMap<string, CableEntry>;
  /** catalogue entries refused by the schema: id → the problems found */
  refused: ReadonlyMap<string, string>;
  selection: Readonly<Record<string, CatalogueSelection>>;
  allocation: PhaseAllocation;
}

// F5: an invalid input comes before any missing one (an invalid parallel is never hidden by a missing length)
const NEUTRAL_ORDER: UnavailableReason[] = ['parallel-invalid', 'length-missing', 'length-suspect', 'neutral-conductor-missing', 'neutral-impedance-missing', 'settings-missing', 'parallel-conflict', 'neutral-parallel-unknown'];
const PHASE_ORDER: UnavailableReason[] = ['parallel-invalid', 'length-missing', 'length-suspect', 'phase-parallel-unknown', 'impedance-missing', 'settings-missing'];

/** F1: an E1 network issue as a DataIssue: code network:<kind>, the same target as E1, every field kept */
const EXCLUDING: ReadonlySet<string> = new Set(['orphan-consumer', 'proposed-consumer-unconnected']);
const paramsOf = (i: NetworkIssue): Record<string, string | number> => {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(i)) if (k !== 'kind') out[k] = Array.isArray(v) ? v.join(',') : (v as string | number);
  return out;
};
const first = (order: UnavailableReason[], reasons: (UnavailableReason | undefined)[]) => order.find((r) => reasons.includes(r)) ?? reasons.find((r) => r !== undefined);

/** (R + jX)·L/n in Ω, or the reason it is not known */
const impedance = (L: number | undefined, lReason: UnavailableReason | undefined, r: Resolved, x: Resolved, n: Resolved, order: UnavailableReason[]): ZData => {
  const inputs = [r.input, x.input, n.input].filter((i): i is InputRef => !!i);
  const warnings = [...r.warnings, ...x.warnings, ...n.warnings];
  const reason = first(order, [lReason, n.reason, r.reason, x.reason]);
  if (reason || L === undefined) return { reason: reason ?? 'length-missing', inputs, warnings };
  return { z: scale(c(r.value!, x.value!), L / 1000 / n.value!), inputs, warnings };
};

export const buildNetwork = (b: BuildInput): { circuits: E2Circuit[]; issues: DataIssue[] } => {
  const { doc, settings, origin, entries, selection, allocation } = b;
  const elements = doc.elements as DrawingElement[];
  const cables = new Map<string, CableElement>();
  const consumers = new Map<string, ConsumerElement>();
  for (const e of elements) if (e.type === 'cable') cables.set(e.id, e); else if (e.type === 'consumer') consumers.set(e.id, e);
  const { network, legacy } = toNetwork(doc, settings);
  const issues: DataIssue[] = [];
  if (b.powerFactorDefaulted) issues.push({ code: 'setting-default:powerFactor', severity: 'reported', target: { kind: 'settings', id: 'powerFactor' }, params: { value: settings.powerFactor! } });
  const settingsWarnings: WarningCode[] = b.powerFactorDefaulted ? ['power-factor-default'] : [];

  // F1: every network issue of E1 (global and per circuit), once each, with the circuits it was found in.
  // A consumer left out of the calculation (orphan, unconnected proposal) makes its circuits provisional.
  const e1 = new Map<string, { issue: NetworkIssue; circuits: string[] }>();
  const seen = (i: NetworkIssue, circuitId?: string) => {
    const k = JSON.stringify(i);
    const x = e1.get(k) ?? { issue: i, circuits: [] };
    if (circuitId && !x.circuits.includes(circuitId)) x.circuits.push(circuitId);
    e1.set(k, x);
  };
  for (const i of legacy.issues) seen(i);
  for (const lc of legacy.circuits) for (const i of lc.issues) seen(i, lc.id);
  for (const { issue: i, circuits: cs } of e1.values()) {
    issues.push({
      code: `network:${i.kind}`, severity: EXCLUDING.has(i.kind) ? 'provisional' : 'reported', target: networkIssueTarget(i),
      params: { ...paramsOf(i), source: 'e1-network', ...(cs.length ? { circuitIds: cs.join(',') } : {}) },
    });
  }
  // the junctions E1's 'auto' rule made (to review), as E1 reports them
  for (const lc of legacy.circuits) for (const j of lc.inferredJunctions)
    issues.push({ code: 'network:inferred-junction', severity: 'reported', target: { kind: 'pole', id: j.poleId }, params: { circuitId: lc.id, cableId: j.cableId, end: j.end, withCableIds: j.withCableIds.join(','), source: 'e1-network' } });

  // Q6: consumers connected to no cable of their colour at their pole → the circuits at that pole
  const orphanPoles = new Map<string, string[]>();
  // F2: a proposal that could not be connected and blocks no circuit (no cable at its pole) → the circuits
  // at its pole or of the cable it names. (Where it blocks a circuit, E1 does not compute that circuit: not-run.)
  const unconnected: { consumerId: string; poleId: string; cableId?: string }[] = [];
  for (const i of legacy.issues) {
    if (i.kind === 'orphan-consumer') orphanPoles.set(i.poleId, [...(orphanPoles.get(i.poleId) ?? []), i.consumerId]);
    if (i.kind === 'proposed-consumer-unconnected') {
      const cableId = consumers.get(i.consumerId)?.proposal?.connection?.cableId;
      unconnected.push({ consumerId: i.consumerId, poleId: i.poleId, ...(cableId ? { cableId } : {}) });
    }
  }

  const spanOf = (br: NetBranch): E2Span => {
    const cable = cables.get(br.cableId);
    const props = br.spanId ? cable?.spanProps?.[br.spanId] : undefined;
    const sel = selection[br.key] ?? selection[br.cableId];
    const entry = sel ? entries.get(sel.entryId) : undefined;
    if (sel && !entry) {
      const problems = b.refused.get(sel.entryId);
      issues.push(problems !== undefined
        ? { code: 'catalogue:entry-refused', severity: 'reported', target: { kind: 'span', id: br.key }, params: { entryId: sel.entryId, problems } }
        : { code: 'catalogue:entry-not-found', severity: 'reported', target: { kind: 'span', id: br.key }, params: { entryId: sel.entryId } });
    }
    const rs = resolveSpan(br.key, props, entry, sel, settings, origin);
    issues.push(...rs.issues);
    const L = br.lengthM.value;
    const suspect = L === undefined && br.lengthMissing === 'length-suspect';
    const lReason: UnavailableReason | undefined = L === undefined ? (suspect ? 'length-suspect' : 'length-missing') : undefined;
    // the distance stays as entered in the document; it is only not used as a length
    if (suspect) issues.push({ code: 'length-suspect', severity: 'blocks', target: { kind: 'span', id: br.key }, params: { limitM: 1 } });
    const warnings: WarningCode[] = [
      ...(br.lengthM.status === 'to-check' ? (['length-estimated'] as const) : []),
      ...(props?.review?.length ? (['span-review'] as const) : []),
      ...(props?.inherited ? (['span-inherited'] as const) : []),
      ...rs.np.warnings,
    ];
    const inputs: InputRef[] = [
      ...(L !== undefined ? [{ name: 'L', element: br.key, provenance: 'project', value: L } as InputRef] : []),
      ...(br.system.value ? [{ name: 'system', element: br.key, provenance: 'project', value: br.system.value } as InputRef] : []),
    ];
    const system = br.system.value;
    let phase: Phase | undefined, topologyReason: UnavailableReason | undefined;
    if (!system) topologyReason = 'system-missing';
    else if (system === '1ph2w') {
      const sp = spanPhase(allocation, br.key);
      if (sp === 'invalid') topologyReason = 'phase-allocation-invalid';
      else if (sp) {
        phase = sp.phase;
        inputs.push({ name: 'phase', element: br.key, provenance: 'allocation', value: sp.phase, ref: sp.source });
        if (!sp.verified) warnings.push('allocation-unverified');
        if (sp.approvalIncomplete) issues.push({ code: 'allocation:approval-incomplete', severity: 'provisional', target: { kind: 'span', id: br.key }, params: { needs: 'by,on' } });
      } else topologyReason = 'phase-allocation-missing';
    }
    const zPhase = impedance(L, lReason, rs.r, rs.x, { ...rs.np, warnings: [] }, PHASE_ORDER);
    const zNeutral = impedance(L, lReason, rs.rn, rs.xn, rs.nN, NEUTRAL_ORDER);
    return {
      key: br.key, fromBus: br.fromBus, toBus: br.toBus,
      ...(system ? { system } : {}), ...(phase ? { phase } : {}), ...(topologyReason ? { topologyReason } : {}),
      zPhase, zNeutral,
      ...(rs.np.value !== undefined ? { np: rs.np.value } : {}), ...(rs.nN.value !== undefined ? { nN: rs.nN.value } : {}),
      warnings, inputs,
    };
  };

  const circuits: E2Circuit[] = network.circuits.map((nc) => {
    const spans = nc.status === 'ok' ? nc.branches.map(spanOf) : [];
    // phase of the single-phase branch each bus is fed through (1ph2w spans)
    const branchPhase = new Map<string, { behind: boolean; phase?: Phase; span?: string }>();
    if (nc.source?.bus) branchPhase.set(nc.source.bus, { behind: false });
    for (const sp of spans) {
      const up = branchPhase.get(sp.fromBus) ?? { behind: false };
      branchPhase.set(sp.toBus, sp.system === '1ph2w' ? { behind: true, ...(sp.phase ? { phase: sp.phase } : {}), span: sp.key } : up);
    }
    const loads: E2Load[] = [];
    if (nc.status === 'ok') for (const bus of nc.buses) for (const l of bus.loads) {
      const proposed = consumers.get(l.consumerId)?.proposal?.status === 'proposed';
      // Q5: a proposed (not confirmed) consumer is calculated only in the study, and says so
      if (proposed) issues.push({ code: 'study:proposed-consumer', severity: 'provisional', target: { kind: 'consumer', id: l.consumerId }, params: { poleId: bus.poleId, circuitId: nc.id } });
      loads.push(loadOf(l, bus.id, branchPhase.get(bus.id) ?? { behind: false }, allocation, proposed, (i) => issues.push(i)));
    }
    // Q6 / F2: consumers of this circuit left out of the calculation: the circuit is provisional, never symmetric
    const orphans = [...new Set(nc.buses.flatMap((x) => orphanPoles.get(x.poleId) ?? []))];
    const proposals = unconnected.filter((u) => nc.buses.some((x) => x.poleId === u.poleId) || (u.cableId !== undefined && nc.branches.some((br) => br.cableId === u.cableId))).map((u) => u.consumerId);
    return {
      id: nc.id, status: nc.status,
      ...(nc.source?.bus ? { sourceBus: nc.source.bus } : {}),
      buses: nc.buses.map((x) => ({ id: x.id, poleId: x.poleId })),
      spans, loads,
      warnings: [...settingsWarnings, ...(orphans.length ? (['orphan-consumer-excluded'] as const) : []), ...(proposals.length ? (['proposed-consumer-excluded'] as const) : [])],
      ...(orphans.length || proposals.length ? { excludedConsumers: [...orphans, ...proposals] } : {}),
    };
  });
  return { circuits, issues };
};

const loadOf = (l: NetLoad, bus: string, branch: { behind: boolean; phase?: Phase; span?: string }, allocation: PhaseAllocation, proposed: boolean, report: (i: DataIssue) => void): E2Load => {
  const each = l.ampsEach.value ?? 0;
  const ruleA = l.amps.value ?? 0;
  const warnings: WarningCode[] = [...(l.ampsEach.provenance === 'default' ? (['load-default'] as const) : []), ...(proposed ? (['proposed-load'] as const) : [])];
  const inputs: InputRef[] = [{ name: 'I', element: l.consumerId, provenance: l.ampsEach.provenance === 'default' ? 'default' : 'project', value: each, ...(l.ampsEach.note ? { ref: l.ampsEach.note } : {}) }];
  const base = { consumerId: l.consumerId, bus, kind: l.kind, ruleA, warnings, inputs, ...(l.amps.status === 'invalid' ? { invalid: true } : {}) };
  const all = (a: number): Record<Phase, number> => ({ a, b: a, c: a });
  const cp = consumerPhases(allocation, l.consumerId, l.kind, l.count);
  if (l.kind === 'three') {
    if (branch.behind) return { ...base, phaseReason: 'three-phase-on-single-phase' };
    if (cp.status === 'invalid') return { ...base, phaseReason: 'phase-allocation-invalid' };
    return { ...base, perPhase: all(ruleA) };
  }
  if (cp.status === 'invalid') return { ...base, phaseReason: 'phase-allocation-invalid' };
  if (cp.status === 'ok') {
    if (branch.behind && branch.phase && PHASES.some((p) => p !== branch.phase && cp.counts[p] > 0)) return { ...base, phaseReason: 'phase-allocation-conflict' };
    inputs.push({ name: 'phase', element: l.consumerId, provenance: 'allocation', value: `a${cp.counts.a} b${cp.counts.b} c${cp.counts.c}`, ref: cp.source });
    if (!cp.verified) warnings.push('allocation-unverified');
    if (cp.approvalIncomplete) report({ code: 'allocation:approval-incomplete', severity: 'provisional', target: { kind: 'consumer', id: l.consumerId }, params: { needs: 'by,on' } });
    return { ...base, perPhase: { a: cp.counts.a * each, b: cp.counts.b * each, c: cp.counts.c * each } };
  }
  // Q7: no explicit allocation → no phase, also behind a 1ph2w span (its phase is never given to the load)
  return { ...base, phaseReason: 'phase-allocation-missing' };
};
