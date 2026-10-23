import React from 'react';
import type { ConsumerElement, DrawingElement, Point } from '../types/drawing';
import { proposalGeometry } from '../utils/proposalDrawing';

/** A proposed subscriber as drawn in the share preview / PDF (the same geometry as the canvas). */
export const ProposalSvg: React.FC<{ elements: DrawingElement[]; consumer: ConsumerElement; poleRadius: number; scale: number; layout?: Map<string, Point> }> = ({ elements, consumer, poleRadius, scale, layout }) => {
  const g = proposalGeometry(elements, consumer, poleRadius, scale, layout);
  if (!g) return null;
  const dash = consumer.proposal?.status === 'confirmed' ? undefined : '5 3';
  const { cx, cy, w, h } = g.box;
  return (
    <g data-proposed-consumer={consumer.id}>
      <line x1={g.line[0].x} y1={g.line[0].y} x2={g.line[1].x} y2={g.line[1].y} stroke="red" strokeWidth={2} strokeDasharray={dash} />
      {g.jumper && <path d={g.jumper.d} fill="none" stroke={g.jumper.color} strokeWidth={2} strokeDasharray={dash} />}
      {g.jumper && <circle cx={g.jumper.dot.x} cy={g.jumper.dot.y} r={g.jumper.dotRadius} fill={g.jumper.color} />}
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={4} fill="white" stroke="red" strokeWidth={2} strokeDasharray={dash} />
      <text x={cx} y={cy - h * 0.12} textAnchor="middle" fill="red" fontSize={12 * scale} fontWeight="bold">مشترك</text>
      <text x={cx} y={cy + h * 0.32} textAnchor="middle" fill="red" fontSize={12 * scale} fontWeight="bold">{g.amps !== undefined ? `${Number.isInteger(g.amps) ? g.amps : g.amps.toFixed(1)} A` : '? A'}</text>
    </g>
  );
};
