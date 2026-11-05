// Calculation core: drawing → electrical network (what E2 reads the drawing with).
// The topology is buildNetwork's, built ONCE with the options the settings ask for
// (networkOptions) and returned with the result, so E2 calculates on exactly the same
// network object. Nothing in the document is written.

import type { CableElement, ConsumerElement, DrawingElement, ElectricalSettings } from '../types/drawing';
import { buildNetwork, type Network, type NetSpan } from '../utils/network';
import { networkOptions, spanKey, spanLength } from '../utils/spanLength';
import { consumerLoad, SINGLE_PHASE_AMPS } from '../utils/loads';
import { pairKey } from '../utils/cableSegments';
import type { ElectricalNetwork, NetBranch, NetBus, NetCircuit, NetLoad, ProjectDocument, Sourced } from './model';

// a single-phase subscriber's load is the project's default single-phase nominal load (a project
// setting, 4 A unless changed: provenance 'project'); a three-phase one is its label, or the
// 32 A rule when it has none ('default') — unchanged
const loadOf = (c: ConsumerElement, singleAmps: number): NetLoad => {
  const l = consumerLoad(c, singleAmps);
  const fromSetting = l.source === 'single-phase-rule';
  const ampsEach: Sourced<number> = { value: l.ampsEach, provenance: l.source === 'label' || fromSetting ? 'project' : 'default', note: fromSetting ? 'setting:singlePhaseNominalA' : l.source };
  const amps: Sourced<number> = l.invalid
    ? { provenance: ampsEach.provenance, status: 'invalid', note: `invalid ${l.invalid}` }
    : { value: l.amps, provenance: ampsEach.provenance, status: 'complete' };
  return { consumerId: c.id, kind: l.kind, count: l.count, ampsEach, amps, proposed: !!c.proposal };
};

/** The drawing as an electrical network, and the topology (buildNetwork) it was read from. */
export const toNetwork = (doc: ProjectDocument, settings: ElectricalSettings): { network: ElectricalNetwork; legacy: Network } => {
  const elements = doc.elements as DrawingElement[];
  const legacy = buildNetwork(elements, networkOptions(settings));
  const singleAmps = settings.singlePhaseNominalA ?? SINGLE_PHASE_AMPS;
  const cables = new Map<string, CableElement>();
  for (const e of elements) if (e.type === 'cable') cables.set(e.id, e);

  // loads per bus, in the order of the elements (the order buildNetwork adds them in)
  const loadsAt = new Map<string, NetLoad[]>();
  for (const e of elements) {
    if (e.type !== 'consumer' || !legacy.consumerBus.has(e.id)) continue;
    const bus = legacy.consumerBus.get(e.id);
    if (!bus) continue;
    const list = loadsAt.get(bus) ?? [];
    list.push(loadOf(e, singleAmps));
    loadsAt.set(bus, list);
  }

  const branchOf = (s: NetSpan): NetBranch => {
    const cable = cables.get(s.cableId);
    const id = cable?.spanIds?.[s.index];
    const props = id ? cable?.spanProps?.[id] : undefined;
    const len = spanLength(doc.connectionDistances as Record<string, string>, s.fromPole, s.toPole);
    const estimated = !!doc.distanceFlags[pairKey(s.fromPole, s.toPole)]?.estimated;
    const lengthM: Sourced<number> = len.m !== undefined
      ? { value: len.m, provenance: 'project', status: estimated ? 'to-check' : 'complete', ...(estimated ? { note: 'estimated' } : {}) }
      : { provenance: 'missing', status: 'missing', note: len.missing };
    return {
      key: spanKey(s.cableId, s.index), cableId: s.cableId, index: s.index, spanId: s.spanId,
      fromPole: s.fromPole, toPole: s.toPole, fromBus: s.fromBus, toBus: s.toBus, color: s.color,
      lengthM, ...(len.missing ? { lengthMissing: len.missing } : {}),
      system: props?.system ? { value: props.system, provenance: 'project', status: 'complete' } : { provenance: 'missing', status: 'missing' },
    };
  };

  const circuits: NetCircuit[] = legacy.circuits.map((c) => {
    const buses: NetBus[] = c.buses.map((b) => ({ id: b, poleId: legacy.poleOfBus.get(b)!, loads: loadsAt.get(b) ?? [] }));
    return {
      id: c.id,
      status: c.status,
      ...(c.sourcePoleId ? { source: { poleId: c.sourcePoleId, kind: c.sourceKind!, ...(c.sourceBus ? { bus: c.sourceBus } : {}) } } : {}),
      buses,
      branches: c.spans.map(branchOf),
    };
  });
  return { network: { circuits }, legacy };
};
