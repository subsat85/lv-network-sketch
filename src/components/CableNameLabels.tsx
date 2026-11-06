import React from 'react';
import type { CableNameLabel } from '../utils/cableNameLayout';

// The names of the library cables linked to spans (cableNameLayout.ts), drawn beside their spans in the
// cable's colour with a thin leader and a white halo. Purely visual: no pointer events. The same
// component draws them on the sketch and on the preview / PDF / image page.
export const CableNameLabels: React.FC<{ labels: CableNameLabel[] }> = ({ labels }) => {
  if (!labels.length) return null;
  return (
    <g data-cable-names style={{ pointerEvents: 'none' }}>
      {labels.map((l) => (
        <g key={l.key} data-cable-name={l.key} data-cable-name-color={l.color}>
          <line x1={l.leader.from.x} y1={l.leader.from.y} x2={l.leader.to.x} y2={l.leader.to.y} stroke={l.color} strokeWidth={Math.max(0.5, l.fontSize * 0.07)} strokeOpacity={0.85} strokeLinecap="round" />
          <text x={l.x} y={l.y} transform={`rotate(${l.angle} ${l.x} ${l.y})`} dy=".35em" textAnchor="middle" fontSize={l.fontSize} fontWeight={500}
            fill={l.color} stroke="white" strokeWidth={Math.max(2, l.fontSize * 0.32)} strokeLinejoin="round" paintOrder="stroke" fontFamily="'Arial Narrow', Arial, sans-serif" letterSpacing={0.1}>{l.text}</text>
        </g>
      ))}
    </g>
  );
};
