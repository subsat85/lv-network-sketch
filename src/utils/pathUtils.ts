import { Point } from '../types/drawing';

/**
 * Douglas-Peucker algorithm for line simplification
 * Reduces the number of points while preserving the shape
 */
export function simplifyPath(points: Point[], tolerance: number = 3): Point[] {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance
  let maxDist = 0;
  let maxIndex = 0;
  
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPath(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPath(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  const lineLengthSq = dx * dx + dy * dy;
  if (lineLengthSq === 0) return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);

  const t = Math.max(0, Math.min(1, 
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLengthSq
  ));

  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.hypot(point.x - projX, point.y - projY);
}

/**
 * Convert points to smooth Bezier curve path
 */
export function smoothPath(points: Point[], tension: number = 0.3): Point[] {
  if (points.length <= 2) return points;

  const result: Point[] = [];
  
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? i : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 >= points.length ? i + 1 : i + 2];

    // Add current point
    result.push(p1);

    // Add control points for smooth curve (for Bezier rendering)
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    // Store control points as intermediate points
    result.push({ x: cp1x, y: cp1y });
    result.push({ x: cp2x, y: cp2y });
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * Detect if a path is approximately a circle
 */
export function detectCircle(points: Point[]): { isCircle: boolean; center: Point; radius: number } | null {
  if (points.length < 10) return null;

  // Check if path is closed (start and end are close)
  const start = points[0];
  const end = points[points.length - 1];
  const closureDist = Math.hypot(end.x - start.x, end.y - start.y);
  
  // Calculate bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const aspectRatio = width / height;
  
  // Check if roughly circular (aspect ratio close to 1)
  if (aspectRatio < 0.7 || aspectRatio > 1.3) return null;
  
  // Check if path is closed (within 20% of size)
  if (closureDist > Math.max(width, height) * 0.3) return null;

  // Calculate center and radius
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const radius = (width + height) / 4;

  // Verify all points are roughly equidistant from center
  let totalDeviation = 0;
  for (const p of points) {
    const dist = Math.hypot(p.x - center.x, p.y - center.y);
    totalDeviation += Math.abs(dist - radius);
  }
  const avgDeviation = totalDeviation / points.length;
  const deviationRatio = avgDeviation / radius;

  if (deviationRatio > 0.2) return null; // Too much deviation

  return { isCircle: true, center, radius };
}

/**
 * Detect if a path is approximately a rectangle
 */
export function detectRectangle(points: Point[]): { isRect: boolean; x: number; y: number; width: number; height: number } | null {
  if (points.length < 8) return null;

  // Check if path is closed
  const start = points[0];
  const end = points[points.length - 1];
  const closureDist = Math.hypot(end.x - start.x, end.y - start.y);

  // Calculate bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;

  // Check if path is closed
  if (closureDist > Math.max(width, height) * 0.3) return null;

  // Count corners (points where direction changes significantly)
  const corners = findCorners(points);
  
  // A rectangle should have 4 corners
  if (corners.length < 3 || corners.length > 5) return null;

  // Check if corners form right angles
  let rightAngles = 0;
  for (let i = 0; i < corners.length; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % corners.length];
    const p3 = corners[(i + 2) % corners.length];
    
    const angle = getAngle(p1, p2, p3);
    if (Math.abs(angle - 90) < 25 || Math.abs(angle - 270) < 25) {
      rightAngles++;
    }
  }

  if (rightAngles < 2) return null;

  return {
    isRect: true,
    x: minX,
    y: minY,
    width,
    height
  };
}

/**
 * Detect if a path is approximately a straight line
 */
export function detectLine(points: Point[]): { isLine: boolean; start: Point; end: Point } | null {
  if (points.length < 3) return null;

  const start = points[0];
  const end = points[points.length - 1];
  
  // Calculate total path length
  let pathLength = 0;
  for (let i = 1; i < points.length; i++) {
    pathLength += Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
  }
  
  // Calculate straight line distance
  const straightDist = Math.hypot(end.x - start.x, end.y - start.y);
  
  // If path is much longer than straight line, it's not a line
  if (pathLength > straightDist * 1.4) return null;

  // Check deviation from line
  let maxDeviation = 0;
  for (const p of points) {
    const dev = perpendicularDistance(p, start, end);
    maxDeviation = Math.max(maxDeviation, dev);
  }

  // Allow some deviation
  if (maxDeviation > straightDist * 0.1) return null;

  return { isLine: true, start, end };
}

/**
 * Detect if a path is approximately a triangle
 */
export function detectTriangle(points: Point[]): { isTriangle: boolean; points: Point[] } | null {
  if (points.length < 6) return null;

  // Check if path is closed
  const start = points[0];
  const end = points[points.length - 1];
  const closureDist = Math.hypot(end.x - start.x, end.y - start.y);

  const corners = findCorners(points);
  
  // A triangle should have 3 corners
  if (corners.length < 3 || corners.length > 4) return null;

  // Check closure
  if (closureDist > 50) return null;

  return { isTriangle: true, points: corners };
}

/**
 * Find corner points in a path
 */
function findCorners(points: Point[], threshold: number = 30): Point[] {
  const corners: Point[] = [];
  
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    const angle = getAngle(prev, curr, next);
    
    // If angle is not close to 180 (straight), it's a corner
    if (Math.abs(angle - 180) > threshold && Math.abs(angle - 360) > threshold) {
      // Avoid duplicate corners
      if (corners.length === 0 || Math.hypot(curr.x - corners[corners.length-1].x, curr.y - corners[corners.length-1].y) > 20) {
        corners.push(curr);
      }
    }
  }
  
  return corners;
}

/**
 * Calculate angle at vertex
 */
function getAngle(p1: Point, vertex: Point, p2: Point): number {
  const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
  const v2 = { x: p2.x - vertex.x, y: p2.y - vertex.y };
  
  const angle1 = Math.atan2(v1.y, v1.x);
  const angle2 = Math.atan2(v2.y, v2.x);
  
  let diff = (angle2 - angle1) * 180 / Math.PI;
  if (diff < 0) diff += 360;
  
  return diff;
}

/**
 * Auto-detect shape from freehand drawing
 */
export type DetectedShape = 
  | { type: 'circle'; center: Point; radius: number }
  | { type: 'rectangle'; x: number; y: number; width: number; height: number }
  | { type: 'triangle'; points: Point[] }
  | { type: 'line'; start: Point; end: Point }
  | { type: 'path'; points: Point[] };

export function detectShape(points: Point[]): DetectedShape {
  if (points.length < 3) {
    return { type: 'line', start: points[0], end: points[points.length - 1] };
  }

  // Try to detect circle
  const circle = detectCircle(points);
  if (circle) {
    return { type: 'circle', center: circle.center, radius: circle.radius };
  }

  // Try to detect rectangle
  const rect = detectRectangle(points);
  if (rect) {
    return { type: 'rectangle', x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  // Try to detect triangle
  const triangle = detectTriangle(points);
  if (triangle) {
    return { type: 'triangle', points: triangle.points };
  }

  // Try to detect line
  const line = detectLine(points);
  if (line) {
    return { type: 'line', start: line.start, end: line.end };
  }

  // Return simplified path
  return { type: 'path', points: simplifyPath(points, 2) };
}

/**
 * Generate SVG path data from points (with smooth curves)
 */
export function generateSmoothPathData(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  // Use Catmull-Rom to Bezier conversion for smooth curves
  const d: string[] = [`M ${points[0].x} ${points[0].y}`];
  
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Calculate control points
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }

  return d.join(' ');
}
