// Calculation core: the problems of a study as one list of DataIssue (E2 builds them, build.ts).
//   blocks      — the value cannot be calculated;
//   provisional — a reason a calculated value is provisional;
//   reported    — reported only (its effect, if any, is the circuit status or another issue).

import type { NetworkIssue } from '../utils/network';

export type Severity = 'blocks' | 'provisional' | 'reported';
export type IssueTargetKind = 'span' | 'consumer' | 'pole' | 'cable' | 'element' | 'settings' | 'circuit';
export interface DataIssue {
  /** e.g. 'network:<kind>', 'network:inferred-junction', 'setting-default:<name>', '<group>:<problem>' */
  code: string;
  severity: Severity;
  target: { kind: IssueTargetKind; id: string };
  params?: Record<string, string | number>;
}

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
