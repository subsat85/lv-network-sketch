import type { CableElement, DrawingElement } from '../types/drawing';
import type { VoltageView } from './e2Presentation';
import { spanAt } from './spanModel';
import { spanCableTypeProblem } from './cableTypeModel';

// Cable ampacity warning (display only). A span whose current is above the maximum allowable current
// of its library cable is marked. Nothing is calculated here:
//   - the current is E2's own result for the span, per cable assembly (perSetCurrentA = |I| / n, with n
//     the complete cable assemblies in parallel on that span, design assumption A8) — the phases a, b, c,
//     the highest one. The neutral is not compared: the value entered is the cable's rating;
//   - the limit is the value the user entered on the cable type, read from the span's own snapshot (the
//     revision it is linked to). No value → no check (never 0, never derived, never defaulted);
//   - over only when current > limit (equal is not over).
// Parallel cables of other colours on the same poles are other circuits: each has its own spans and
// currents in E2, so each is compared with its own cable.

export interface AmpacityWarning {
  key: string;
  cableId: string;
  index: number;
  fromPole: string;
  toPole: string;
  color: string;
  /** E2 current per cable assembly, A (the highest phase) */
  currentA: number;
  /** the cable's maximum allowable current, A */
  limitA: number;
  /** E2's result for the span is provisional (shown with ≈) */
  provisional: boolean;
}

/** the maximum allowable current of the span's linked cable (its snapshot), or undefined */
export const spanMaxCurrentA = (cable: CableElement, index: number): number | undefined => {
  const ct = spanAt(cable, index).props?.cableType;
  if (!ct || spanCableTypeProblem(ct) !== null) return undefined;
  const v = ct.snapshot.maxCurrentA;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
};

export const ampacityWarnings = (elements: readonly DrawingElement[], view: VoltageView): AmpacityWarning[] => {
  const cables = new Map(elements.filter((e): e is CableElement => e.type === 'cable').map((c) => [c.id, c]));
  const out: AmpacityWarning[] = [];
  for (const s of view.bySpan.values()) {
    const cable = cables.get(s.cableId);
    if (!cable) continue;
    const limitA = spanMaxCurrentA(cable, s.index);
    if (limitA === undefined) continue;
    const phases = (['a', 'b', 'c'] as const).map((k) => s.perSetCurrentA[k]).filter((v): v is number => v !== undefined);
    if (!phases.length) continue;
    const currentA = Math.max(...phases);
    if (!(currentA > limitA)) continue;
    out.push({ key: s.key, cableId: s.cableId, index: s.index, fromPole: s.fromPole, toPole: s.toPole, color: s.color, currentA, limitA, provisional: s.provisional });
  }
  return out;
};

/** "⚠ 270 A / 250 A" — whole amperes, or as many decimals (up to 2) as needed to show that it is over */
export const ampacityText = (w: Pick<AmpacityWarning, 'currentA' | 'limitA' | 'provisional'>): string => {
  const shown = (d: number) => Number(w.currentA.toFixed(d));
  const d = [0, 1, 2].find((k) => shown(k) > w.limitA) ?? 2;
  return `⚠ ${w.provisional ? '≈' : ''}${w.currentA.toFixed(d)} A / ${w.limitA} A`;
};
