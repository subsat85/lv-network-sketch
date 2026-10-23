import React, { useMemo } from 'react';
import type { DrawingElement } from '../types/drawing';
import type { VoltageDropResult } from '../utils/voltageDrop';
import type { LayoutContext, Rect } from '../utils/overlayLayout';
import { vdOverlayLayout } from '../utils/vdOverlayLayout';

// Voltage-drop results drawn on the sketch (Stage 7.6): the cumulative drop at
// each pole of a computed network, in the colour of the cable that feeds it.
// The status is a symbol (✓ ⚠ ‼ ؟) and the badge outline, never a colour, so the
// red of proposed cables keeps its meaning. A provisional value (estimated length,
// review marks, unconfirmed copied data…) is written "≈… ⚑" with a dashed outline,
// so it never looks like a confirmed result. Purely visual: no pointer events.
// Where the badges go is chosen by vdOverlayLayout (they keep their original place
// above-right of the pole unless something is there). On screen, `viewScale` keeps
// every mark at least MIN_SCREEN_FONT_PX high; on paper (no viewScale) sizes are as set.

export const MIN_SCREEN_FONT_PX = 9;

interface Props {
  elements: DrawingElement[];
  result: VoltageDropResult;
  poleRadius: number;
  /** text size factor (follows the distance-label size setting) */
  textScale?: number;
  /** what else is drawn (distance numbers, subscribers, arrow size…), so the badges avoid it */
  layoutContext?: Partial<LayoutContext>;
  /** proposal boxes as drawn */
  boxes?: Rect[];
  /** current zoom (screen px per world unit): the on-screen minimum font size applies */
  viewScale?: number;
}

export const VoltageDropOverlay: React.FC<Props> = ({ elements, result, poleRadius, textScale = 1, layoutContext, boxes, viewScale }) => {
  const L = useMemo(() => vdOverlayLayout(elements, result, {
    ctx: { ...layoutContext, poleRadius },
    fs: 11 * textScale,
    boxes,
    minFont: viewScale ? MIN_SCREEN_FONT_PX / viewScale : undefined,
  }), [elements, result, poleRadius, textScale, layoutContext, boxes, viewScale]);
  const { fs, lineH } = L;
  const out: React.ReactNode[] = [];
  for (const l of L.leaders) out.push(<line key={`leader:${l.poleId}`} x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} stroke={l.color} strokeWidth={Math.max(0.8, fs * 0.08)} strokeOpacity={0.7} data-vd-leader={l.poleId} />);
  for (const b of L.badges) {
    const strong = b.status === 'over';
    out.push(
      <g key={b.key} data-vd-badge={b.poleId} data-vd-status={b.status} data-vd-color={b.color} data-vd-provisional={b.provisional ? '1' : undefined}>
        <rect x={b.x} y={b.y} width={b.w} height={lineH * 0.9} rx={lineH * 0.25} fill="white" fillOpacity={0.92}
          stroke={b.color} strokeWidth={strong ? 2.2 : 1} strokeDasharray={b.status === 'na' ? '3 2' : b.provisional ? '5 2 1 2' : undefined} />
        <text x={b.x + b.w / 2} y={b.y + lineH * 0.62} textAnchor="middle" fontSize={fs} fontWeight={strong || b.status === 'near' ? 700 : 500} fill={b.color} fontFamily="sans-serif">{b.text}</text>
      </g>,
    );
  }
  // pole number used by the report
  for (const t of L.tags) out.push(<text key={`${t.poleId}:tag`} x={t.x} y={t.y} textAnchor="end" fontSize={t.fontSize} fill="#6b7280" fontFamily="sans-serif" data-vd-tag={t.poleId}>{t.text}</text>);
  // junctions made by the automatic rule (to review): a small mark under the pole
  for (const j of L.junctions) out.push(<text key={`junction:${j.poleId}`} x={j.x} y={j.y} textAnchor="start" fontSize={j.fontSize} fill="#6b7280" fontFamily="sans-serif" data-vd-junction={j.poleId}>⋈</text>);
  // spans that cannot be computed for lack of data: a "؟" at their middle
  for (const m of L.missing) out.push(<text key={`span:${m.key}`} x={m.x} y={m.y} textAnchor="middle" fontSize={m.fontSize} fontWeight={700} fill={m.color} stroke="white" strokeWidth={3} paintOrder="stroke" fontFamily="sans-serif" data-vd-missing={m.key}>؟</text>);
  return <g data-vd-overlay style={{ pointerEvents: 'none' }}>{out}</g>;
};
