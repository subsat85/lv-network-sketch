import { Point } from '../types/drawing';

/**
 * Generate a high-quality arc path from start, control, and end points.
 * Converts a quadratic Bezier (Q) into multiple cubic Bezier (C) segments
 * for smoother rendering and better anti-aliasing.
 */
export const generateHighQualityArcPath = (
  x1: number, y1: number,
  cx: number, cy: number,
  x2: number, y2: number,
  segments: number = 8
): string => {
  // Convert quadratic Bezier to cubic Bezier coefficients
  // Quadratic: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
  // Cubic equivalent: B(t) = (1-t)³P0 + 3(1-t)²tC1 + 3(1-t)t²C2 + t³P3
  // Where C1 = P0 + 2/3(P1 - P0), C2 = P2 + 2/3(P1 - P2)
  const cp1x = x1 + (2 / 3) * (cx - x1);
  const cp1y = y1 + (2 / 3) * (cy - y1);
  const cp2x = x2 + (2 / 3) * (cx - x2);
  const cp2y = y2 + (2 / 3) * (cy - y2);

  // For very short arcs, a single cubic segment is sufficient
  const totalDist = Math.hypot(x2 - x1, y2 - y1);
  if (totalDist < 50 || segments <= 1) {
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  // Subdivide into multiple cubic Bezier segments for ultra-smooth rendering
  const path: string[] = [`M ${x1.toFixed(2)} ${y1.toFixed(2)}`];

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;

    // Evaluate quadratic Bezier at t0 and t1
    const evalQuad = (t: number) => {
      const mt = 1 - t;
      return {
        x: mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
        y: mt * mt * y1 + 2 * mt * t * cy + t * t * y2,
      };
    };

    const p0 = evalQuad(t0);
    const p3 = evalQuad(t1);

    // Derivative of quadratic at t for tangent direction
    const derivQuad = (t: number) => ({
      x: 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx),
      y: 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy),
    });

    const d0 = derivQuad(t0);
    const d3 = derivQuad(t1);

    const dt = t1 - t0;

    // Cubic control points for this sub-segment
    const sc1x = p0.x + (d0.x * dt) / 3;
    const sc1y = p0.y + (d0.y * dt) / 3;
    const sc2x = p3.x - (d3.x * dt) / 3;
    const sc2y = p3.y - (d3.y * dt) / 3;

    path.push(
      `C ${sc1x.toFixed(2)} ${sc1y.toFixed(2)}, ${sc2x.toFixed(2)} ${sc2y.toFixed(2)}, ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`
    );
  }

  return path.join(' ');
};

export const createZigzagPath = (points: Point[], amplitude: number = 2, wavelength: number = 10): string => {
  if (points.length < 2) return '';

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    // If segment is too short, just draw a line
    if (length < wavelength) {
      path += ` L ${p2.x} ${p2.y}`;
      continue;
    }

    const ux = dx / length;
    const uy = dy / length;
    
    // Normal vector
    const nx = -uy;
    const ny = ux;

    const steps = Math.floor(length / wavelength);
    
    for (let j = 1; j <= steps; j++) {
      const t = j / (steps + 1);
      const x = p1.x + dx * t;
      const y = p1.y + dy * t;
      
      // Alternate offset
      const sign = j % 2 === 0 ? 1 : -1;
      const ox = x + nx * amplitude * sign;
      const oy = y + ny * amplitude * sign;
      
      path += ` L ${ox} ${oy}`;
    }
    
    path += ` L ${p2.x} ${p2.y}`;
  }

  return path;
};
