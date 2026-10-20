import React from 'react';
import type { DrawingElement } from '../types/drawing';
import type { VoltageDropResult } from '../utils/voltageDrop';
import { POLE_STATUS_MARK, PROVISIONAL_MARK } from '../utils/vdLabels';
import { poleTag } from '../utils/poleNames';

// Voltage-drop results drawn on the sketch (Stage 7.6): the cumulative drop at
// each pole of a computed network, in the colour of the cable that feeds it.
// The status is a symbol (✓ ⚠ ‼ ؟) and the badge outline, never a colour, so the
// red of proposed cables keeps its meaning. A provisional value (estimated length,
// review marks, unconfirmed copied data…) is written "≈… ⚑" with a dashed outline,
// so it never looks like a confirmed result. Purely visual: no pointer events.

interface Props {
  elements: DrawingElement[];
  result: VoltageDropResult;
  poleRadius: number;
  /** text size factor (follows the distance-label size setting) */
  textScale?: number;
}

export const VoltageDropOverlay: React.FC<Props> = ({ elements, result, poleRadius, textScale = 1 }) => {
  const poles = new Map<string, { x: number; y: number }>();
  for (const e of elements) if (e.type === 'symbol') poles.set(e.id, { x: e.x, y: e.y });
  const tag = poleTag(elements);
  const fs = 11 * textScale;
  const lineH = fs * 1.55;
  const out: React.ReactNode[] = [];

  for (const [poleId, list] of result.byPole) {
    const p = poles.get(poleId);
    if (!p) continue;
    list.forEach((r, i) => {
      const prov = r.status !== 'na' && r.provisional.length > 0;
      const text = r.status === 'na' ? `${POLE_STATUS_MARK.na}` : prov ? `${PROVISIONAL_MARK}${r.percent!.toFixed(1)}% ⚑` : `${r.percent!.toFixed(1)}% ${POLE_STATUS_MARK[r.status]}`;
      const w = Math.max(fs * 1.6, text.length * fs * 0.62 + fs * 0.6);
      const x = p.x + poleRadius * 0.75;
      const y = p.y - poleRadius * 0.75 - lineH * (i + 1);
      const strong = r.status === 'over';
      out.push(
        <g key={`${poleId}:${r.bus}`} data-vd-badge={poleId} data-vd-status={r.status} data-vd-color={r.color} data-vd-provisional={prov ? '1' : undefined}>
          <rect x={x} y={y} width={w} height={lineH * 0.9} rx={lineH * 0.25} fill="white" fillOpacity={0.92}
            stroke={r.color} strokeWidth={strong ? 2.2 : 1} strokeDasharray={r.status === 'na' ? '3 2' : prov ? '5 2 1 2' : undefined} />
          <text x={x + w / 2} y={y + lineH * 0.62} textAnchor="middle" fontSize={fs} fontWeight={strong || r.status === 'near' ? 700 : 500} fill={r.color} fontFamily="sans-serif">{text}</text>
        </g>,
      );
    });
    // pole number used by the report
    out.push(
      <text key={`${poleId}:tag`} x={p.x - poleRadius * 0.9} y={p.y + poleRadius + fs} textAnchor="end" fontSize={fs * 0.85} fill="#6b7280" fontFamily="sans-serif" data-vd-tag={poleId}>{tag(poleId)}</text>,
    );
  }

  // junctions made by the automatic rule (to review): a small mark under the pole
  for (const pid of new Set(result.network.inferredJunctions.map((j) => j.poleId))) {
    const p = poles.get(pid);
    if (!p) continue;
    out.push(<text key={`junction:${pid}`} x={p.x + poleRadius * 0.9} y={p.y + poleRadius + fs} textAnchor="start" fontSize={fs * 0.9} fill="#6b7280" fontFamily="sans-serif" data-vd-junction={pid}>⋈</text>);
  }

  // spans that cannot be computed for lack of data: a "؟" at their middle
  for (const s of result.bySpan.values()) {
    if (s.computable || !s.missing.length) continue;
    const a = poles.get(s.fromPole), b = poles.get(s.toPole);
    if (!a || !b) continue;
    out.push(
      <text key={`span:${s.key}`} x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - fs * 0.6} textAnchor="middle" fontSize={fs * 1.1} fontWeight={700} fill={s.color} stroke="white" strokeWidth={3} paintOrder="stroke" fontFamily="sans-serif" data-vd-missing={s.key}>؟</text>,
    );
  }
  return <g data-vd-overlay style={{ pointerEvents: 'none' }}>{out}</g>;
};
