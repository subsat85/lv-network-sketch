import type { CableElement, ConsumerElement, DrawingElement, ElectricalSettings, SpanProps, SymbolElement } from '../../types/drawing';
import { normalizeElements, withSpanProps } from '../spanModel';
import { pairKey } from '../cableSegments';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';
import type { E2DocumentInput } from '../e2Presentation';

// Synthetic drawings for the E2 UI tests (no real cable data: R and X are test values).

export const RED = '#ff0000', BLUE = '#0000ff', GREEN = '#00aa00', ORANGE = '#ff8800';
// distinct positions so the drawing can be shown (they play no part in the calculation)
const AT: Record<string, [number, number]> = { T1: [100, 100], T2: [100, 300], T3: [100, 500], T4: [100, 700], A: [300, 100], E: [500, 100], B: [300, 300], C: [300, 500], D: [300, 700], F: [500, 500], T: [100, 100] };
const pole = (id: string, symbolId = 'lv-pole'): SymbolElement => ({ id, type: 'symbol', symbolId, x: AT[id]?.[0] ?? 0, y: AT[id]?.[1] ?? 0, width: 24, height: 24, strokeColor: '#000', fillColor: '#fff', strokeWidth: 2 });
const cable = (id: string, poleIds: string[], color: string): CableElement => ({ id, type: 'cable', x: 0, y: 0, poleIds, cableIndex: 0, offset: 0, strokeColor: color, fillColor: 'none', strokeWidth: 2 });
const sub = (id: string, poleId: string, color: string, o: Partial<ConsumerElement> = {}): ConsumerElement =>
  ({ id, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: '30', strokeColor: color, fillColor: color, strokeWidth: 2, ...o });
const withSpans = (c: CableElement, props: Omit<SpanProps, 'poles'>[]): CableElement =>
  props.reduce((x, p, i) => withSpanProps(x, x.spanIds![i], { poles: [c.poleIds[i], c.poleIds[i + 1]], ...p }), c);
export const SETTINGS: ElectricalSettings = { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, conductorTempC: 70 };

/** a documented three-phase span (synthetic R / X with a source) */
const DOCUMENTED: Omit<SpanProps, 'poles'> = { system: '3ph4w', cableKind: 'underground', parallel: 1, rOhmPerKm: 0.5, xOhmPerKm: 0.08, dataSource: 'synthetic test value' };

/**
 * Four circuits, each from its own transformer, one per status of the result:
 *   red    T–A–E (two spans, documented, three-phase loads)  → computed
 *   blue   T–B   (R / X typed without a source)               → provisional
 *   green  T–C   (single-phase subscribers, no allocation)    → unavailable
 *   orange T–D   (parallel = 1.5)                             → not-run
 * and an orphan subscriber at pole F, which has no cable (it belongs to no circuit, so no circuit
 * is affected; an orphan at a pole of a circuit would make that circuit unbalanced, F8).
 */
export const fourStatusDoc = (): E2DocumentInput => {
  const all = normalizeElements([
    pole('T1', 'transformer'), pole('T2', 'transformer'), pole('T3', 'transformer'), pole('T4', 'transformer'), pole('A'), pole('B'), pole('C'), pole('D'), pole('E'), pole('F'),
    cable('k1', ['T1', 'A', 'E'], RED), cable('k2', ['T2', 'B'], BLUE), cable('k3', ['T3', 'C'], GREEN), cable('k4', ['T4', 'D'], ORANGE),
  ]) as DrawingElement[];
  const poles = all.slice(0, 10);
  const [k1, k2, k3, k4] = all.slice(10) as CableElement[];
  const elements: DrawingElement[] = [...poles,
    withSpans(k1, [DOCUMENTED, DOCUMENTED]),
    withSpans(k2, [{ system: '3ph4w', cableKind: 'underground', parallel: 1, rOhmPerKm: 0.5, xOhmPerKm: 0.08 }]),
    withSpans(k3, [DOCUMENTED]),
    withSpans(k4, [{ ...DOCUMENTED, parallel: 1.5 }]),
    sub('uA', 'A', RED), sub('uE', 'E', RED), sub('uB', 'B', BLUE), sub('uC', 'C', GREEN, { variant: 'circle', label: '', count: 3 }), sub('uD', 'D', ORANGE),
    sub('orphan', 'F', '#123456'),
  ];
  const distances = { [pairKey('T1', 'A')]: '100', [pairKey('A', 'E')]: '50', [pairKey('T2', 'B')]: '100', [pairKey('T3', 'C')]: '100', [pairKey('T4', 'D')]: '100' };
  return { elements, connectionDistances: distances, distanceFlags: {}, electrical: SETTINGS };
};

/** a loop and a pole-to-pole link of an old file: network issues of E1 */
export const networkIssueDoc = (): E2DocumentInput => ({
  elements: normalizeElements([pole('T', 'transformer'), pole('A'), pole('B'), cable('c', ['T', 'A', 'B', 'T'], RED),
    { id: 'L', type: 'jumper', fromPoleId: 'A', toPoleId: 'B', x: 0, y: 0, strokeColor: '#000', fillColor: 'none', strokeWidth: 2 } as DrawingElement]),
  connectionDistances: {}, distanceFlags: {}, electrical: SETTINGS,
});
