import React from 'react';
import type { ArrowPlacement } from '../utils/cableArrows';

/**
 * The cable start / end arrowhead (the shape SketchCanvas and PreviewCanvas drew
 * inline for arrowMode). Also used, in red, for the suggested split mark.
 */
export const CableArrowHead: React.FC<{
  at: ArrowPlacement;
  size: number;
  color: string;
  strokeWidth: number;
  style?: React.CSSProperties;
  suggestedSplit?: string;
}> = ({ at, size, color, strokeWidth, style, suggestedSplit }) => (
  <path
    d={`M ${-size} ${-size/2} L 0 0 L ${-size} ${size/2} Z`}
    stroke={color}
    strokeWidth={strokeWidth}
    fill={color}
    strokeLinecap="round"
    strokeLinejoin="round"
    transform={`translate(${at.pos.x}, ${at.pos.y}) rotate(${at.angle})`}
    style={style}
    data-suggested-split={suggestedSplit}
  />
);
