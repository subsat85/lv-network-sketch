// Calculation core (Stage E1): the existing engine's problems as one list of DataIssue.
// Nothing is added, removed or re-judged here: every item of the existing result
// becomes exactly one DataIssue, and the severity says only what the existing engine
// does with it (verified in its code):
//   blocks      — a missing item of a span (the span is not computable), a missing
//                 setting (nothing that needs it is computed), a circuit whose status
//                 is not 'ok' (the circuit is not computed);
//   provisional — a reason a computed value is shown as provisional;
//   reported    — a network issue the existing engine reports; its effect is the
//                 circuit status, reported separately (no severity is assumed per kind);
//                 also a junction the drawing's 'auto' rule made (circuit.inferredJunctions,
//                 shown by the app as "to review"; it changes no result), and a setting the
//                 calculation took from a default (added by runStudy, see index.ts).

import type { NetworkIssue } from '../utils/network';
import type { MissingItem, ProvisionalReason, SettingMissing, VoltageDropResult } from '../utils/voltageDrop';

export type Severity = 'blocks' | 'provisional' | 'reported';
export type IssueTargetKind = 'span' | 'consumer' | 'pole' | 'cable' | 'element' | 'settings' | 'circuit';
export interface DataIssue {
  /** 'missing:<item>', 'provisional:<reason>', 'setting-missing:<name>', 'setting-default:<name>',
   *  'network:<kind>', 'network:inferred-junction', 'circuit:<status>' */
  code: string;
  severity: Severity;
  target: { kind: IssueTargetKind; id: string };
  params?: Record<string, string | number>;
}

// every value of each union is listed: a new value in the existing engine fails to compile here
export const MISSING_ITEMS: Record<MissingItem, true> = {
  length: true, 'length-suspect': true, system: true, resistance: true, 'resistance-bare': true, 'resistance-kind': true,
  'section-not-in-table': true, reactance: true, neutral: true, 'neutral-not-in-table': true, 'neutral-material': true,
  'neutral-alloy': true, parallel: true, 'three-phase-on-single-phase': true, 'invalid-load': true,
  'downstream-voltage-unknown': true, 'not-converged': true,
};
export const PROVISIONAL_REASONS: Record<ProvisionalReason, true> = { review: true, inherited: true, 'length-estimated': true, 'source-unknown': true };
export const SETTINGS_MISSING: Record<SettingMissing, true> = { powerFactor: true, conductorTempC: true };

/** The element a network issue is about. */
export const networkIssueTarget = (i: NetworkIssue): DataIssue['target'] => {
  switch (i.kind) {
    case 'parallel-spans': return { kind: 'pole', id: i.poles.join('|') };
    case 'loop': return { kind: 'pole', id: i.poleIds.join('|') };
    case 'transformer-not-source': return { kind: 'pole', id: i.poleId };
    case 'orphan-consumer': return { kind: 'consumer', id: i.consumerId };
    case 'legacy-jumper': return { kind: 'element', id: i.elementId };
    case 'missing-pole': return { kind: 'cable', id: i.cableId };
    case 'passes-source-pole': return { kind: 'pole', id: i.poleId };
    case 'same-colour-crossing': return { kind: 'pole', id: i.poleId };
    case 'ambiguous-junction': return { kind: 'pole', id: i.poleId };
    case 'invalid-load': return { kind: 'consumer', id: i.consumerId };
    case 'isolated-end-jumpered': return { kind: 'pole', id: i.poleId };
    case 'connected-end-alone': return { kind: 'pole', id: i.poleId };
    case 'three-phase-on-single-phase': return { kind: 'span', id: i.spanKey };
    case 'split-side-unassigned': return { kind: 'pole', id: i.poleId };
    case 'proposed-consumer-unconnected': return { kind: 'consumer', id: i.consumerId };
    default: { const never: never = i; return never; }
  }
};

/** Every problem of an existing result, one DataIssue each, in the result's own order. */
export const fromLegacy = (r: VoltageDropResult): DataIssue[] => {
  const out: DataIssue[] = [];
  for (const m of r.settingsMissing) out.push({ code: `setting-missing:${m}`, severity: 'blocks', target: { kind: 'settings', id: m } });
  for (const c of r.circuits) if (c.status !== 'ok') out.push({ code: `circuit:${c.status}`, severity: 'blocks', target: { kind: 'circuit', id: c.circuit.id } });
  for (const c of r.circuits) for (const s of c.spans) {
    for (const m of s.missing) out.push({ code: `missing:${m}`, severity: 'blocks', target: { kind: 'span', id: s.key } });
    for (const p of s.provisional) out.push({ code: `provisional:${p}`, severity: 'provisional', target: { kind: 'span', id: s.key } });
  }
  for (const i of r.issues) out.push({ code: `network:${i.kind}`, severity: 'reported', target: networkIssueTarget(i) });
  // junctions made by the 'auto' rule, per circuit (the list the app shows for review)
  for (const c of r.circuits) for (const j of c.circuit.inferredJunctions)
    out.push({ code: 'network:inferred-junction', severity: 'reported', target: { kind: 'pole', id: j.poleId }, params: { circuitId: c.circuit.id, cableId: j.cableId, end: j.end, withCableIds: j.withCableIds.join(',') } });
  return out;
};
