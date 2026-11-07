// A synthetic network for the network-analysis tests. ALL VALUES SYNTHETIC.
import type { CableElement, ConsumerElement, DrawingElement, SpanProps, SymbolElement } from '../../types/drawing';
import type { CableTypeData, CableTypeRevision } from '../../types/cableType';
import { createCableType, latestRevision } from '../cableTypeModel';
import { linkSpanCable } from '../spanCableLink';
import { normalizeElements, spanAt, withSpanProps } from '../spanModel';
import { pairKey } from '../cableSegments';
import type { E2DocumentInput } from '../e2Presentation';
import { DEFAULT_ELECTRICAL } from '../electricalSettings';

const v = (value: number, basis: string) => ({ value, unit: 'ohm/km', basis, verification: { status: 'checked' } }) as never;
const data = (s: number, r: number, maxCurrentA?: number): CableTypeData => ({
  name: `ABC 3x${s}+70 (synthetic)`, construction: 'abc', phaseConductors: 3, neutralConductors: 1, phase: { material: 'al', sectionMm2: s }, neutral: { material: 'al', sectionMm2: 70 },
  r: v(r, 'ac'), x: v(0.08, 'ac-50hz'), rn: v(0.45, 'ac'), xn: v(0.08, 'ac-50hz'), source: { name: 'synthetic' }, ...(maxCurrentA !== undefined ? { maxCurrentA } : {}),
} as CableTypeData);
export const rev = (s: number, r: number, maxCurrentA?: number) => latestRevision(createCableType(`ct${s}${maxCurrentA ?? 'n'}`, data(s, r, maxCurrentA), { now: 1 }));
export const pole = (id: string, x: number, y: number, symbolId = 'lv-pole') => ({ id, type: 'symbol', symbolId, x, y, width: 40, height: 40, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 2 }) as SymbolElement;
export const sub = (id: string, poleId: string, color: string, amps: number) => ({ id, type: 'consumer', x: 0, y: 0, poleId, color, count: 1, variant: 'square', label: String(amps), strokeColor: color, fillColor: color, strokeWidth: 2 }) as ConsumerElement;
export type C = { id: string; poles: string[]; color: string; revs: (CableTypeRevision | null)[]; props?: Partial<SpanProps> };
export const docOf = (poles: SymbolElement[], cables: C[], subs: ConsumerElement[], dist: Record<string, string>): E2DocumentInput => {
  let els = normalizeElements([...poles, ...cables.map((c, j) => ({ id: c.id, type: 'cable', x: 0, y: 0, poleIds: c.poles, cableIndex: j, offset: 0, strokeColor: c.color, fillColor: 'none', strokeWidth: 2 }) as CableElement)]) as DrawingElement[];
  for (const c of cables) c.revs.forEach((r, i) => {
    els = els.map((e) => {
      if (e.id !== c.id) return e;
      const k = e as CableElement; const { id, props } = spanAt(k, i);
      const base = { ...(props ?? { poles: [k.poleIds[i], k.poleIds[i + 1]] }), system: '3ph4w', ...(c.props ?? {}) } as SpanProps;
      return withSpanProps(k, id!, r ? linkSpanCable(base, [k.poleIds[i], k.poleIds[i + 1]], r, 1) : ({ ...base, r: 0.32, x: 0.08 } as SpanProps));
    });
  });
  const d: Record<string, string> = {};
  for (const [k, m] of Object.entries(dist)) { const [a, b] = k.split('-'); d[pairKey(a, b)] = m; }
  return { elements: [...els, ...subs], connectionDistances: d, distanceFlags: {}, electrical: { ...DEFAULT_ELECTRICAL, powerFactor: 0.9, singlePhaseMode: 'balanced' } };
};
export const RED = '#e11d48', BLUE = '#2563eb';
/**
 * Red: T–A–B–C (main run) and a branch B–D–E drawn as its own cable, all 3x120 (limit 250 A);
 * Blue: a separate run of the same type T–F–G with no limit stated. The poles are listed and the cables
 * drawn in an order that is NOT the network's (the main run drawn from its far end).
 */
export const network = (opts: { limit?: number; mainLimit?: number; loads?: [number, number, number, number, number]; long?: string } = {}) => {
  const L = opts.long ?? '300';
  const [a, b, c, d, e] = opts.loads ?? [60, 50, 40, 30, 30];
  const R120 = rev(120, 0.32, opts.limit === undefined ? 250 : opts.limit || undefined);
  const Rmain = opts.mainLimit !== undefined ? rev(121, 0.32, opts.mainLimit) : R120;
  return docOf(
    [pole('E', 300, 900), pole('C', 0, 900), pole('G', 600, 300), pole('B', 0, 600), pole('D', 300, 700), pole('A', 0, 300), pole('F', 600, 150), pole('T', 0, 0, 'transformer')],
    [
      { id: 'br', poles: ['B', 'D', 'E'], color: RED, revs: [R120, R120] },
      { id: 'k', poles: ['C', 'B', 'A', 'T'], color: RED, revs: [Rmain, Rmain, Rmain] },
      { id: 'm', poles: ['T', 'F', 'G'], color: BLUE, revs: [rev(95, 0.41), rev(95, 0.41)] },
    ],
    [sub('uA', 'A', RED, a), sub('uB', 'B', RED, b), sub('uC', 'C', RED, c), sub('uD', 'D', RED, d), sub('uE', 'E', RED, e), sub('uG', 'G', BLUE, 20)],
    { 'T-A': L, 'A-B': L, 'B-C': L, 'B-D': L, 'D-E': L, 'T-F': '80', 'F-G': '80' },
  );
};

/**
 * One red cable T–A–B–C–D–E (the main run) with three branches, drawn in an order that is not the
 * network's: a branch at D (D–X), a branch at A (A–P–Q) with its own sub-branch at P (P–S), and a
 * branch at B (B–M). The branch at D is drawn first, the one at A last.
 */
export const branched = () => {
  const R = rev(120, 0.32, 250);
  const ids = ['X', 'S', 'M', 'Q', 'P', 'E', 'D', 'C', 'B', 'A', 'T'];
  const at: Record<string, [number, number]> = { T: [0, 0], A: [0, 200], B: [0, 400], C: [0, 600], D: [0, 800], E: [0, 1000], X: [200, 800], P: [200, 200], Q: [400, 200], S: [200, 400], M: [-200, 400] };
  const poles = ids.map((id) => pole(id, at[id][0], at[id][1], id === 'T' ? 'transformer' : 'lv-pole'));
  return docOf(poles, [
    { id: 'bd', poles: ['D', 'X'], color: RED, revs: [R] },
    { id: 'main', poles: ['E', 'D', 'C', 'B', 'A', 'T'], color: RED, revs: [R, R, R, R, R] },
    { id: 'bb', poles: ['B', 'M'], color: RED, revs: [R] },
    { id: 'ps', poles: ['P', 'S'], color: RED, revs: [R] },
    { id: 'ba', poles: ['A', 'P', 'Q'], color: RED, revs: [R, R] },
  ], ['A', 'B', 'C', 'D', 'E', 'X', 'P', 'Q', 'S', 'M'].map((p, i) => sub(`u${i}`, p, RED, 10)),
  { 'D-E': '100', 'T-A': '100', 'A-B': '100', 'B-C': '100', 'C-D': '100', 'D-X': '100', 'A-P': '100', 'P-Q': '100', 'P-S': '100', 'B-M': '100' });
};

