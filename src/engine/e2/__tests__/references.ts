// E2 reference cases (design section 7). SYNTHETIC test parameters only — they are not
// the data of any real cable and never enter the app's catalogue (catalogue/entries.ts).
// Expected values: closed form for one load on one path (|V| = −Re w + √(Vph² − Im w²),
// w = Z·|I|·e^{−jφ}), F2 / F6 by hand, and an independent Python fixed-point script
// (outside the repository) for the cases with several loads.

import type { CableElement, ConsumerElement, DrawingElement, ElectricalSettings, SpanProps, SymbolElement } from '../../../types/drawing';
import { DEFAULT_ELECTRICAL } from '../../../utils/electricalSettings';
import { normalizeElements, withSpanProps } from '../../../utils/spanModel';
import { pairKey } from '../../../utils/cableSegments';
import { c, type C } from '../complex';
import type { E2Circuit, E2Load, E2Span, LoadModel, SolveSettings, ZData } from '../model';
import type { Phase } from '../phases';
import type { UnavailableReason } from '../quantity';
import type { Catalogue, CableEntry } from '../catalogue/schema';
import type { ProjectDocument } from '../../model';

// ---------- model-level builders (the sweep alone) ----------
/** (R + jX)·L/n, Ω — R, X in Ω/km, L in m */
export const Z = (R: number, X: number, Lm: number, n = 1): C => c((R * Lm) / 1000 / n, (X * Lm) / 1000 / n);
export const zd = (z: C): ZData => ({ z, inputs: [], warnings: [] });
export const zmiss = (reason: UnavailableReason): ZData => ({ reason, inputs: [], warnings: [] });

export const span = (key: string, fromBus: string, toBus: string, o: { system?: '3ph4w' | '1ph2w'; phase?: Phase; zp: ZData; zn: ZData; np?: number; nN?: number }): E2Span => ({
  key, fromBus, toBus, ...(o.system ? { system: o.system } : {}), ...(o.phase ? { phase: o.phase } : {}),
  zPhase: o.zp, zNeutral: o.zn, np: o.np ?? 1, ...(o.nN !== undefined ? { nN: o.nN } : { nN: 1 }), warnings: [], inputs: [],
});
export const three = (id: string, bus: string, A: number): E2Load => ({ consumerId: id, bus, kind: 'three', ruleA: A, perPhase: { a: A, b: A, c: A }, warnings: [], inputs: [] });
export const single = (id: string, bus: string, phase: Phase | undefined, A: number): E2Load =>
  ({ consumerId: id, bus, kind: 'single', ruleA: A, ...(phase ? { perPhase: { a: 0, b: 0, c: 0, [phase]: A } as Record<Phase, number> } : { phaseReason: 'phase-allocation-missing' as const }), warnings: [], inputs: [] });
export const circuit = (spans: E2Span[], loads: E2Load[], id = 'c1'): E2Circuit => ({
  id, status: 'ok', sourceBus: 'S',
  buses: [{ id: 'S', poleId: 'S' }, ...spans.map((s) => ({ id: s.toBus, poleId: s.toBus }))],
  spans, loads, warnings: [],
});
export const SETTINGS = (pf = 0.9, loadModel: LoadModel = 'constant-current'): SolveSettings => ({
  Vph: 230, pf, loadModel, limitPercent: 5, nearLimitFraction: 0.8, minPhaseVoltage: 218, minLineVoltage: 380, inputs: [],
});
/** one 3ph4w span S→B with the synthetic cable R = RN = 0.5, X = XN = 0.08 Ω/km */
export const oneSpan = (Lm: number, loads: E2Load[], n = 1, zn: ZData = zd(Z(0.5, 0.08, Lm, n))): E2Circuit =>
  circuit([span('S-B', 'S', 'B', { system: '3ph4w', zp: zd(Z(0.5, 0.08, Lm, n)), zn, np: n, nN: n })], loads);

// ---------- expected values ----------
export const TOL = { V: 5e-4, A: 1e-3, W: 1e-3, deg: 1e-2 };
export const REF = {
  T1: { dVa: 2.2315, P: 24, Q: 1.6 },
  T2: { dV: 2.910894, Vab: 393.3299, P: 270, Q: 43.2 },
  T3: { dV: { A: 1.6979, B: 2.1828, C: 2.0858 }, I_SA: 35, P: 225.75, Q: 36.12 },
  T4a: { dV: 0.4849, P: 15, Q: 2.4 },
  T4b: { dV: { a: 2.9109, b: -0.3585, c: -1.1049 }, IN: 30, P: 90, Q: 14.4 },
  T6: { pf1: 3.0005, pf08: 2.6924 },
  T7: { dV: 5.8251, pct: 2.5327, P: 540, Q: 86.4 },
  T9: { IN: 17.2501, INdeg: -55.610, dV: { a: 1.5701, b: 0.7318, c: -0.8495 }, P: 39.8782, Q: 6.3805 },
  T10: { I: 30.3896, dV: 2.9487, P: 277.0585, Q: 44.3293 },
  // C4(c) of the design: 20 A on a, 200 m (N1 network at twice the length)
  C4c: { dV: { a: 3.8819, b: -0.4826, c: -1.4725 }, IN: 20, P: 80, Q: 12.8 },
  N1: { I: 20, Ideg: -25.697, dV: { a: 1.9402, b: -0.2367, c: -0.7369 }, shift: 1.0127, P: 40, Q: 6.4 },
  N2: { IN: 19.8739, INdeg: -85.733, dV: { a: 1.2003, b: 1.7006, c: -0.9644 }, P: 59.7486, Q: 9.5598 },
  N3: { dV: 0.9699, P: 60, Q: 9.6 },
  N4: { perSet: 20, P: 80, Q: 12.8 },
  N5: { dV: 2.9109, perSet: 30, P: 540, Q: 86.4 },
  N7a: { I: 40.3432, dV: { a: 1.9569, b: -0.2388, c: -0.7433 }, P: 81.3789, Q: 13.0206 },
  N7c: { I: 60.7792, dV: 2.9487, P: 554.1171, Q: 88.6587 },
  C1: { I: 30, perSet: 30, dV: 2.910894, P: 270, Q: 43.2 },
  C3: { I: 30, perSet: 15, dV: 1.455030, P: 135, Q: 21.6 },
} as const;

// ---------- drawing-level builders (runStudyE2) ----------
export const DOC_ID = 'syn-doc';
const ms = (value: number, unit: 'ohm/km' = 'ohm/km') => ({ value, unit, conditions: 'synthetic test value', source: { documentId: DOC_ID, page: 'test' } });
/** synthetic entry, R = RN = 0.5, X = XN = 0.08 Ω/km — NOT a real cable */
export const synEntry = (id = 'syn-4x70', withNeutral = true): CableEntry => ({
  id, manufacturer: 'synthetic', designation: 'synthetic test cable', cableKind: 'underground',
  construction: withNeutral ? '3x70 + 70' : '3x70', phase: { material: 'al', sectionMm2: 70 },
  ...(withNeutral ? { neutral: { material: 'al' as const, sectionMm2: 70 }, rnAc: ms(0.5), xn: ms(0.08) } : {}),
  rAc: ms(0.5), x: ms(0.08),
  verification: { status: 'checked', by: 'synthetic test fixture', note: 'not real cable data' },
});
export const synCatalogue = (...entries: CableEntry[]): Catalogue => ({ documents: [{ id: DOC_ID, manufacturer: 'synthetic', title: 'synthetic test document' }], entries: entries.length ? entries : [synEntry()] });

export const settingsOf = (over: Partial<ElectricalSettings> = {}): ElectricalSettings => ({ ...DEFAULT_ELECTRICAL, powerFactor: 0.9, ...over });

/** transformer T — pole A, one cable, one span, consumers at A */
export const drawing = (o: { Lm: number; props: Omit<SpanProps, 'poles'>; consumers: Partial<ConsumerElement>[]; electrical?: Partial<ElectricalSettings> }): { doc: ProjectDocument; spanKey: string; cableId: string } => {
  const pole = (id: string, symbolId: string) => ({ id, type: 'symbol', symbolId, x: 0, y: 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 }) as SymbolElement;
  const cab = { id: 'k1', type: 'cable', x: 0, y: 0, poleIds: ['T', 'A'], cableIndex: 0, offset: 0, strokeColor: '#ff0000', fillColor: 'none', strokeWidth: 2 } as CableElement;
  const [t, a, k] = normalizeElements([pole('T', 'transformer'), pole('A', 'lv-pole'), cab]);
  const cable = k as CableElement;
  const withProps = withSpanProps(cable, cable.spanIds![0], { poles: ['T', 'A'], ...o.props });
  const consumers = o.consumers.map((x, i) => ({ id: `u${i}`, type: 'consumer', x: 0, y: 0, poleId: 'A', color: '#ff0000', count: 1, strokeColor: '#000', fillColor: '#000', strokeWidth: 2, ...x }) as DrawingElement);
  const doc: ProjectDocument = { elements: [t, a, withProps, ...consumers], connectionDistances: { [pairKey('T', 'A')]: String(o.Lm) }, distanceFlags: {}, electrical: settingsOf(o.electrical) };
  return { doc, spanKey: 'k1#0', cableId: 'k1' };
};
