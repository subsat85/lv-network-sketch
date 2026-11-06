import React from 'react';
import type { CableNameLabel } from '../utils/cableNameLayout';

// The conductor sizes of the library cables linked to spans (cableNameLayout.ts), drawn as plain text
// beside their cables in the cable's colour (a thin white halo keeps them readable where they pass
// over a line; no frame). Only a name moved off a short span (no room beside its cable) has a short,
// thin arrow in its cable's colour pointing at that cable. Purely visual: no pointer events. The same
// component draws them on the sketch and on the preview / PDF / image page.
export const CableNameLabels: React.FC<{ labels: CableNameLabel[] }> = ({ labels }) => {
  if (!labels.length) return null;
  return (
    <g data-cable-names style={{ pointerEvents: 'none' }}>
      {labels.map((l) => {
        let arrow: React.ReactNode = null;
        if (l.arrow) {
          const { from, to } = l.arrow;
          const L = Math.hypot(to.x - from.x, to.y - from.y) || 1, vx = (to.x - from.x) / L, vy = (to.y - from.y) / L;
          const hl = l.fontSize * 0.5, hw = l.fontSize * 0.26, bx = to.x - vx * hl, by = to.y - vy * hl;
          arrow = (
            <g data-cable-name-arrow={l.key}>
              <line x1={from.x} y1={from.y} x2={bx} y2={by} stroke={l.color} strokeWidth={Math.max(0.6, l.fontSize * 0.08)} strokeLinecap="round" />
              <polygon points={`${to.x},${to.y} ${bx - vy * hw},${by + vx * hw} ${bx + vy * hw},${by - vx * hw}`} fill={l.color} />
            </g>
          );
        }
        return (
          <g key={l.key}>
            {arrow}
            <text data-cable-name={l.key} data-cable-name-color={l.color} x={l.x} y={l.y} transform={`rotate(${l.angle} ${l.x} ${l.y})`} dy=".35em" textAnchor="middle"
              fontSize={l.fontSize} fontWeight={500} fill={l.color} stroke="white" strokeWidth={Math.max(1.5, l.fontSize * 0.25)} strokeLinejoin="round" paintOrder="stroke"
              fontFamily="'Arial Narrow', Arial, sans-serif" letterSpacing={0.1}>{l.text}</text>
          </g>
        );
      })}
    </g>
  );
};
