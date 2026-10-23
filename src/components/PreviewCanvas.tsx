import React from 'react';
import { ColumnModifiers } from './ColumnModifiers';
import { Point, PathElement, TextElement, SymbolElement, CableElement, ConsumerElement, ArcElement, DrawingElement, ShapeElement } from '../types/drawing';
import { calculateCablePath } from '../utils/cableLayout';
import { cableEndArrow, suggestedSplitArrows, SUGGESTED_SPLIT_COLOR } from '../utils/cableArrows';
import { CableArrowHead } from './CableArrowHead';
import { arcGeometry } from '../utils/cableArcs';
import { createZigzagPath, generateHighQualityArcPath } from '../utils/svgHelpers';
import { VoltageDropOverlay } from './VoltageDropOverlay';
import type { VoltageDropResult } from '../utils/voltageDrop';
import type { DistanceFlag } from '../types/drawing';

const POLE_RADIUS = 20;
const CABLE_SPACING = 8;

interface PreviewCanvasProps {
  elements: DrawingElement[];
  connectionDistances: Record<string, string>;
  connectionLabelOffsets: Record<string, { x: number, y: number }>;
  poleSizeScale: number;
  distanceTextScale?: number;
  consumerSizeScale?: number;
  consumerVariant: 'circle' | 'square';
  showDistanceLabels?: boolean;
  /** voltage-drop results to draw (when shown on the drawing) */
  voltageDrop?: VoltageDropResult | null;
  /** estimated distances are written "≈…" */
  distanceFlags?: Record<string, DistanceFlag>;
}

const getSmartPlacement = (poleId: string, elements: DrawingElement[]) => {
  const pole = elements.find(e => e.id === poleId);
  if (!pole) return { x: 0, y: 0, direction: 'right', dx: 1, dy: 0 };

  const connectedCables = elements.filter(e => 
    e.type === 'cable' && (e as CableElement).poleIds.includes(poleId)
  ) as CableElement[];

  const cableAngles: number[] = [];
  connectedCables.forEach(cable => {
    const idx = cable.poleIds.indexOf(poleId);
    if (idx === -1) return;

    const neighbors = [];
    if (idx > 0) neighbors.push(cable.poleIds[idx - 1]);
    if (idx < cable.poleIds.length - 1) neighbors.push(cable.poleIds[idx + 1]);

    neighbors.forEach(neighborId => {
      const neighbor = elements.find(e => e.id === neighborId);
      if (neighbor) {
        const dx = neighbor.x - pole.x;
        const dy = neighbor.y - pole.y;
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        if (angle < 0) angle += 360;
        cableAngles.push(angle);
      }
    });
  });

  const candidates = [
    { angle: 0, name: 'right', dx: 1, dy: 0 },
    { angle: 90, name: 'bottom', dx: 0, dy: 1 },
    { angle: 180, name: 'left', dx: -1, dy: 0 },
    { angle: 270, name: 'top', dx: 0, dy: -1 }
  ];

  let bestCandidate = candidates[0];
  let maxMinDist = -1;

  candidates.forEach(candidate => {
    let minDist = 360;
    if (cableAngles.length === 0) {
      minDist = 360;
    } else {
      cableAngles.forEach(cableAngle => {
        let diff = Math.abs(candidate.angle - cableAngle);
        if (diff > 180) diff = 360 - diff;
        if (diff < minDist) minDist = diff;
      });
    }

    if (minDist > maxMinDist) {
      maxMinDist = minDist;
      bestCandidate = candidate;
    }
  });

  return {
    x: pole.x,
    y: pole.y,
    direction: bestCandidate.name,
    dx: bestCandidate.dx,
    dy: bestCandidate.dy
  };
};

// We need the real getSmartPlacement logic for accurate rendering of consumers.
// I'll copy it from SketchCanvas or move it to a utility.
// Moving to utility is better.

export const PreviewCanvas: React.FC<PreviewCanvasProps> = ({
  elements,
  connectionDistances,
  connectionLabelOffsets,
  poleSizeScale,
  distanceTextScale = 1,
  consumerSizeScale = 1,
  consumerVariant,
  showDistanceLabels = true,
  voltageDrop = null,
  distanceFlags
}) => {

  const getTransformerIntersection = (pole: SymbolElement, externalPoint: Point): Point => {
    const radius = POLE_RADIUS * poleSizeScale;
    const dx = externalPoint.x - pole.x;
    const dy = externalPoint.y - pole.y;
    const angleRad = -(pole.rotation || 0) * Math.PI / 180;
    const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    
    const minX = radius * 1.2;
    const maxX = radius * 2.2;
    const minY = -radius * 1.8;
    const maxY = radius * 1.8;
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    const dirX = centerX - localX;
    const dirY = centerY - localY;
    
    let tMin = Infinity;
    
    if (dirX !== 0) {
        const t = (minX - localX) / dirX;
        const y = localY + t * dirY;
        if (t >= 0 && t <= 1 && y >= minY && y <= maxY) tMin = Math.min(tMin, t);
    }
    if (dirX !== 0) {
        const t = (maxX - localX) / dirX;
        const y = localY + t * dirY;
        if (t >= 0 && t <= 1 && y >= minY && y <= maxY) tMin = Math.min(tMin, t);
    }
    if (dirY !== 0) {
        const t = (minY - localY) / dirY;
        const x = localX + t * dirX;
        if (t >= 0 && t <= 1 && x >= minX && x <= maxX) tMin = Math.min(tMin, t);
    }
    if (dirY !== 0) {
        const t = (maxY - localY) / dirY;
        const x = localX + t * dirX;
        if (t >= 0 && t <= 1 && x >= minX && x <= maxX) tMin = Math.min(tMin, t);
    }
    
    if (tMin === Infinity) return { x: pole.x, y: pole.y };
    
    const intLocalX = localX + tMin * dirX;
    const intLocalY = localY + tMin * dirY;
    
    const rotRad = (pole.rotation || 0) * Math.PI / 180;
    const worldX = pole.x + intLocalX * Math.cos(rotRad) - intLocalY * Math.sin(rotRad);
    const worldY = pole.y + intLocalX * Math.sin(rotRad) + intLocalY * Math.cos(rotRad);
    
    return { x: worldX, y: worldY };
  };

  // Helper to get smart placement (copied logic)
  const getPlacement = (poleId: string) => {
    const pole = elements.find(e => e.id === poleId);
    if (!pole) return { x: 0, y: 0, dx: 1, dy: 0 };

    const connectedCables = elements.filter(e => 
      e.type === 'cable' && (e as CableElement).poleIds.includes(poleId)
    ) as CableElement[];

    if (connectedCables.length === 0) {
      return { x: pole.x, y: pole.y, dx: 1, dy: 0 };
    }

    // Calculate average angle of cables
    let sumX = 0;
    let sumY = 0;
    
    connectedCables.forEach(cable => {
      const points = calculateCablePath(cable, elements);
      // Find the segment connected to this pole
      // ... (Simplified: just take direction to neighbor)
      const neighborId = cable.poleIds.find(id => id !== poleId) || cable.poleIds[0]; // Approximation
      const neighbor = elements.find(e => e.id === neighborId);
      if (neighbor) {
        const dx = neighbor.x - pole.x;
        const dy = neighbor.y - pole.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        sumX += dx/len;
        sumY += dy/len;
      }
    });

    // Bisector angle (opposite to average cable direction)
    const angle = Math.atan2(sumY, sumX) + Math.PI;
    return { 
      x: pole.x, 
      y: pole.y, 
      dx: Math.cos(angle), 
      dy: Math.sin(angle) 
    };
  };

  const renderElement = (el: DrawingElement) => {
    if (el.type === 'path') {
      const pathEl = el as PathElement;
      const d = `M ${pathEl.points.map(p => `${p.x} ${p.y}`).join(' ')}`;
      return (
        <g key={el.id}>
          <path
            d={d}
            stroke={el.strokeColor}
            strokeWidth={el.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    } else if (el.type === 'text') {
      const textEl = el as TextElement;
      return (
        <g key={el.id} transform={`translate(${el.x}, ${el.y})`}>
          <text
            x={0}
            y={0}
            fill={el.fillColor}
            fontSize={el.fontSize}
            fontFamily="sans-serif"
            className="select-none"
          >
            {textEl.text}
          </text>
        </g>
      );
    } else if (el.type === 'symbol') {
      const sym = el as SymbolElement;
      const radius = POLE_RADIUS * poleSizeScale;
      return (
        <g key={el.id} transform={`translate(${el.x}, ${el.y}) rotate(${el.rotation || 0})`}>
          {sym.symbolId === 'lv-pole' && (
            <circle 
              cx={0} cy={0} r={radius} 
              stroke={sym.isProposed ? "red" : "black"} 
              strokeWidth={2} 
              fill="white" 
            />
          )}
          {sym.symbolId === 'mv-pole' && (
            <circle 
              cx={0} cy={0} r={radius} 
              fill={sym.isProposed ? "red" : "black"} 
            />
          )}
          {sym.symbolId === 'transformer' && (
            <g>
               {/* Top Circle */}
               <circle cx={0} cy={-radius * 0.8} r={radius} stroke={sym.isProposed ? "red" : "black"} strokeWidth={2} fill="none" />
               {/* Bottom Circle */}
               <circle cx={0} cy={radius * 0.8} r={radius} stroke={sym.isProposed ? "red" : "black"} strokeWidth={2} fill="none" />
               {/* Rectangle to the right */}
               <rect 
                 x={radius * 1.2} 
                 y={-radius * 1.8} 
                 width={radius * 1.0} 
                 height={radius * 3.6} 
                 stroke={sym.isProposed ? "red" : "black"} 
                 strokeWidth={2} 
                 fill="white" 
               />
            </g>
          )}
          {sym.symbolId === 'lattice-iron-pole' && (
            <g>
              <rect 
                x={-radius} 
                y={-radius} 
                width={radius * 2} 
                height={radius * 2} 
                stroke={sym.isProposed ? "red" : "black"} 
                strokeWidth={2} 
                fill="white" 
              />
              <line 
                x1={-radius} y1={-radius} 
                x2={radius} y2={radius} 
                stroke={sym.isProposed ? "red" : "black"} 
                strokeWidth={2} 
              />
              <line 
                x1={radius} y1={-radius} 
                x2={-radius} y2={radius} 
                stroke={sym.isProposed ? "red" : "black"} 
                strokeWidth={2} 
              />
            </g>
          )}
          {sym.symbolId === 'distribution-box' && (
            <g>
              {/* Rectangle 3:1 aspect ratio */}
              <rect 
                x={-radius * 1.5} 
                y={-radius * 0.5} 
                width={radius * 3} 
                height={radius * 1} 
                stroke={sym.isProposed ? "red" : "#2563eb"} 
                strokeWidth={2} 
                fill="white" 
              />
            </g>
          )}
          {sym.symbolId === 'small-dot-pole' && (
            <g>
              {/* Small dot in center */}
              <circle 
                cx={0} cy={0} r={radius * 0.2}
                fill={sym.isProposed ? "red" : "black"}
              />
            </g>
          )}
          
          <ColumnModifiers 
             element={sym} 
             poleSizeScale={poleSizeScale} 
          />
        </g>
      );
    } else if (el.type === 'cable') {
      const cable = el as CableElement;
      const points = calculateCablePath(cable, elements);
      if (points.length < 2) return null;

      // Cable is now directly from edge to edge (handled in cableLayout)
      const finalPoints = points;

      const d = cable.lineStyle === 'straight' 
        ? finalPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        : createZigzagPath(finalPoints, 2, 10);
      
      // Arrow Logic (start / end of the cable) and the suggested split marks in red (cableArrows.ts)
      const arrowSize = 8; // Fixed size for preview
      const arrowRadius = POLE_RADIUS * poleSizeScale;
      const endArrow = cableEndArrow(cable, finalPoints, elements, arrowRadius);
      const arrowPath = endArrow && <CableArrowHead at={endArrow} size={arrowSize} color={cable.strokeColor} strokeWidth={cable.strokeWidth} />;
      const splitArrows = suggestedSplitArrows(cable, finalPoints, elements, arrowRadius).map((a) => (
        <CableArrowHead key={a.key} at={a} size={arrowSize} color={SUGGESTED_SPLIT_COLOR} strokeWidth={cable.strokeWidth} suggestedSplit={`${cable.id}:${a.key}`} />
      ));

      return (
        <g key={el.id}>
          <path
            d={d}
            stroke={cable.strokeColor}
            strokeWidth={cable.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={cable.cableType === 'ground' ? '8 8' : 'none'}
          />
          {arrowPath}
          {splitArrows}
        </g>
      );
    } else if (el.type === 'consumer') {
      const cons = el as ConsumerElement;
      const pole = elements.find(e => e.id === cons.poleId);
      if (!pole) return null;
      
      let cx, cy;
      if (cons.hasManualPosition) {
        cx = cons.x;
        cy = cons.y;
      } else {
        const consumersOnPole = elements.filter(e => e.type === 'consumer' && (e as ConsumerElement).poleId === cons.poleId);
        const index = consumersOnPole.findIndex(e => e.id === cons.id);
        const placement = getSmartPlacement(cons.poleId, elements);
        const radius = POLE_RADIUS * poleSizeScale;
        const consumerRadius = 16 * consumerSizeScale;
        const margin = 5 * consumerSizeScale;
        const spacing = consumerRadius * 2 + margin;
        const startOffset = radius + consumerRadius + margin;
        const stackOffset = index * spacing;
        const totalOffset = startOffset + stackOffset;
        cx = placement.x + placement.dx * totalOffset;
        cy = placement.y + placement.dy * totalOffset;
      }

      const consumerRadius = 16 * consumerSizeScale;
      return (
        <g key={cons.id} transform={`translate(${cx}, ${cy})`}>
          {cons.variant === 'square' ? (
            <rect x={-consumerRadius} y={-consumerRadius} width={consumerRadius * 2} height={consumerRadius * 2} fill="none" stroke={cons.color} strokeWidth={2} />
          ) : (
            <circle cx={0} cy={0} r={consumerRadius} fill="none" stroke={cons.color} strokeWidth={2} />
          )}
          <text x={0} y={0} dy=".3em" textAnchor="middle" fill={cons.color} fontSize={12 * consumerSizeScale} fontWeight="bold">
            {cons.count}
          </text>
          {cons.label && (
            <text 
              x={cons.variant === 'square' ? 0 : consumerRadius} 
              y={cons.variant === 'square' ? -(consumerRadius + 10) : 0} 
              dy=".3em" 
              textAnchor={cons.variant === 'square' ? "middle" : "start"} 
              fill={cons.color} 
              fontSize={14 * consumerSizeScale} 
              fontWeight="bold"
            >
              {cons.label}
            </text>
          )}
        </g>
      );
    } else if (el.type === 'cable_arc') {
      const g = arcGeometry(elements, el, POLE_RADIUS * poleSizeScale);
      if (!g) return null;
      return (
        <g key={el.id}>
          <path d={g.d} stroke={el.strokeColor} strokeWidth={el.strokeWidth} fill="none" strokeLinecap="round" />
          <circle cx={g.start.x} cy={g.start.y} r={g.dotRadius} fill={el.strokeColor} />
          <circle cx={g.end.x} cy={g.end.y} r={g.dotRadius} fill={el.strokeColor} />
        </g>
      );
    } else if (el.type === 'jumper') {
      const a = elements.find(p => p.id === el.fromPoleId), b = elements.find(p => p.id === el.toPoleId);
      if (!a || !b) return null;
      return <line key={el.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={el.strokeColor || '#64748b'} strokeWidth={2} strokeDasharray="6 4" />;
    } else if (el.type === 'arc') {
      const arc = el as ArcElement;
      const path = generateHighQualityArcPath(arc.x, arc.y, arc.controlX, arc.controlY, arc.x2, arc.y2);
      return (
        <g key={el.id}>
          <path
            d={path}
            stroke={arc.strokeColor}
            strokeWidth={arc.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            shapeRendering="geometricPrecision"
          />
          <circle cx={arc.x} cy={arc.y} r={arc.strokeWidth * 1.5} fill={arc.strokeColor} />
          <circle cx={arc.x2} cy={arc.y2} r={arc.strokeWidth * 1.5} fill={arc.strokeColor} />
        </g>
      );
    } else if (el.type === 'shape') {
      const shape = el as ShapeElement;
      const { x, y, width, height, shapeType, strokeColor, fillColor, strokeWidth, rotation = 0, scaleX = 1, scaleY = 1 } = shape;
      const halfW = width / 2;
      const halfH = height / 2;
      const centerX = x + halfW;
      const centerY = y + halfH;

      const getShapeContent = () => {
        switch (shapeType) {
          case 'rectangle':
            return (
              <rect
                x={-halfW}
                y={-halfH}
                width={width}
                height={height}
                stroke={strokeColor}
                fill={fillColor}
                strokeWidth={strokeWidth}
                rx={2}
                ry={2}
              />
            );
          case 'circle':
            const radius = Math.min(halfW, halfH);
            return (
              <circle
                cx={0}
                cy={0}
                r={radius}
                stroke={strokeColor}
                fill={fillColor}
                strokeWidth={strokeWidth}
              />
            );
          case 'triangle':
            return (
              <polygon
                points={`0,${-halfH} ${halfW},${halfH} ${-halfW},${halfH}`}
                stroke={strokeColor}
                fill={fillColor}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
              />
            );
          case 'arrow':
            const arrowLen = Math.max(width, height);
            const arrowHeadSize = Math.min(15, arrowLen * 0.3);
            return (
              <g>
                <line
                  x1={0}
                  y1={0}
                  x2={arrowLen}
                  y2={0}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${arrowLen},0 ${arrowLen - arrowHeadSize},-${arrowHeadSize / 2} ${arrowLen - arrowHeadSize},${arrowHeadSize / 2}`}
                  fill={strokeColor}
                />
              </g>
            );
          case 'compass':
            const r = Math.min(halfW, halfH);
            return (
              <g>
                <circle cx={0} cy={0} r={r} stroke={strokeColor} fill={fillColor} strokeWidth={strokeWidth} />
                <circle cx={0} cy={0} r={r * 0.92} stroke={strokeColor} fill="none" strokeWidth={strokeWidth * 0.5} />
                
                <polygon points={`0,${-r * 0.85} ${r * 0.08},${-r * 0.15} 0,${-r * 0.25} -${r * 0.08},${-r * 0.15}`} fill="#c41e3a" stroke="#c41e3a" strokeWidth={1} />
                <polygon points={`0,${r * 0.85} ${r * 0.08},${r * 0.15} 0,${r * 0.25} -${r * 0.08},${r * 0.15}`} fill="#666" stroke="#666" strokeWidth={1} />
                <polygon points={`${r * 0.7},0 ${r * 0.12},-${r * 0.12} ${r * 0.2},0 ${r * 0.12},${r * 0.12}`} fill="#666" stroke="#666" strokeWidth={1} />
                <polygon points={`-${r * 0.7},0 -${r * 0.12},-${r * 0.12} -${r * 0.2},0 -${r * 0.12},${r * 0.12}`} fill="#666" stroke="#666" strokeWidth={1} />
                
                <polygon points={`${r * 0.45},${-r * 0.45} ${r * 0.08},-${r * 0.08} ${r * 0.12},0 0,-${r * 0.02}`} fill="#999" />
                <polygon points={`-${r * 0.45},${-r * 0.45} -${r * 0.08},-${r * 0.08} -${r * 0.12},0 0,-${r * 0.02}`} fill="#999" />
                <polygon points={`${r * 0.45},${r * 0.45} ${r * 0.08},${r * 0.08} ${r * 0.12},0 0,${r * 0.02}`} fill="#ccc" />
                <polygon points={`-${r * 0.45},${r * 0.45} -${r * 0.08},${r * 0.08} -${r * 0.12},0 0,${r * 0.02}`} fill="#ccc" />
                
                <circle cx={0} cy={0} r={r * 0.1} fill={strokeColor} />
                <circle cx={0} cy={0} r={r * 0.05} fill="white" />
                
                <text x={0} y={-r * 0.55} textAnchor="middle" dominantBaseline="middle" fontSize={r * 0.22} fontWeight="bold" fill="#000">N</text>
              </g>
            );
          case 'curved_arrow':
            const curveLen = Math.max(width, height);
            return (
              <g>
                <path
                  d={`M 0,${curveLen * 0.5} Q ${curveLen * 0.5},${-curveLen * 0.3} ${curveLen * 0.8},${-curveLen * 0.4}`}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                />
                <polygon
                  points={`${curveLen * 0.8},${-curveLen * 0.4} ${curveLen * 0.7},${-curveLen * 0.35} ${curveLen * 0.75},${-curveLen * 0.5}`}
                  fill={strokeColor}
                />
              </g>
            );
          default:
            return null;
        }
      };

      return (
        <g
          key={el.id}
          transform={`translate(${centerX}, ${centerY}) rotate(${rotation}) scale(${scaleX}, ${scaleY})`}
        >
          {getShapeContent()}
        </g>
      );
    } else if (el.type === 'transformer_table') {
      const table = el as any;
      const { x, y, transformerInfo, scale = 1 } = table;
      const boxCount = parseInt(transformerInfo.distributionBoxesCount) || 1;
      const hasPerBox = boxCount > 1 && transformerInfo.perBoxCircuits && transformerInfo.perBoxCircuits.length > 0;
      
      // Calculate dynamic height based on number of boxes
      const baseRows = 8;
      const perBoxRows = hasPerBox ? boxCount : 0;
      const totalRows = baseRows + perBoxRows;
      const rowHeight = 25 * scale;
      const tableWidth = 300 * scale;
      const headerHeight = 48 * scale;
      const tableHeight = (headerHeight + totalRows * rowHeight + 25 * scale);

      const getCableTypeLabel = () => transformerInfo.cableType === 'copper' ? 'نحاسي' : 'ألمونيوم';
      const getInstallationMethodLabel = () => {
        switch (transformerInfo.installationMethod) {
          case 'ground': return 'على الأرض';
          case 'hanging': return 'معلق';
          case 'indoor': return 'داخل غرفة';
          default: return '';
        }
      };
      const getTransformerTypeLabel = () => transformerInfo.transformerType === 'public' ? 'عام' : 'خاص';
      const getBoxInstallationLabel = () => transformerInfo.boxInstallationMethod === 'ground' ? 'على الأرض' : 'معلق';
      const getLightingBoxLabel = () => {
        switch (transformerInfo.lightingBox) {
          case 'indoor': return 'داخلي';
          case 'outdoor': return 'خارجي';
          case 'none': return 'لا يوجد';
          default: return '';
        }
      };
      const getCapacitorLabel = () => transformerInfo.capacitor === 'yes' ? 'موجود' : 'غير موجود';

      // Build rows array
      const rows: { label: string; value: string }[] = [
        { label: 'الكابل الرئيسي', value: `${transformerInfo.mainCable} مم²` },
        { label: 'عدد الخطوط', value: transformerInfo.mainLinesCount },
        { label: 'نوع الخط', value: getCableTypeLabel() },
        { label: 'صناديق التوزيع', value: transformerInfo.distributionBoxesCount },
      ];

      // Add per-box circuits if multiple boxes
      if (hasPerBox) {
        rows.push({ label: 'الدوائر لكل صندوق', value: '' });
        transformerInfo.perBoxCircuits!.forEach((box: any, i: number) => {
          rows.push({ 
            label: `  صندوق ${i + 1}`, 
            value: `تشغيل: ${box.circuits} | فارغ: ${box.emptyCircuits}` 
          });
        });
      } else {
        rows.push({ label: 'دوائر لكل صندوق', value: transformerInfo.circuitsPerBox });
        rows.push({ label: 'دوائر فارغة', value: transformerInfo.emptyCircuitsPerBox });
      }

      rows.push(
        { label: 'تركيب المحول', value: getInstallationMethodLabel() },
        { label: 'نوع المحول', value: getTransformerTypeLabel() },
        { label: 'تركيب الصندوق', value: getBoxInstallationLabel() },
        { label: 'صندوق الإنارة', value: getLightingBoxLabel() },
        { label: 'المكثف', value: getCapacitorLabel() }
      );

      const title = transformerInfo.transformerNumber ? `محول ${transformerInfo.transformerNumber}` : 'معلومات المحول';

      return (
        <g key={el.id} transform={`translate(${x}, ${y})`}>
          {/* Shadow effect */}
          <rect
            x={2 * scale}
            y={4 * scale}
            width={tableWidth}
            height={tableHeight}
            fill="#00000020"
            rx={10 * scale}
          />
          
          {/* Main background */}
          <rect
            x={0}
            y={0}
            width={tableWidth}
            height={tableHeight}
            fill="white"
            stroke="#1e40af"
            strokeWidth={1.5 * scale}
            rx={8 * scale}
          />
          
          {/* Header gradient background */}
          <rect
            x={1 * scale}
            y={1 * scale}
            width={tableWidth - 2 * scale}
            height={42 * scale}
            fill="#2563eb"
            rx={7 * scale}
          />
          
          {/* Transformer icon */}
          <g transform={`translate(${12 * scale}, ${10 * scale})`}>
            <circle cx={0} cy={0} r={12 * scale} fill="white" fillOpacity="0.2" />
            <circle cx={-4 * scale} cy={0} r={6 * scale} fill="white" stroke="white" strokeWidth={1.5 * scale} />
            <circle cx={4 * scale} cy={0} r={6 * scale} fill="white" stroke="white" strokeWidth={1.5 * scale} />
            <rect x={0} y={-8 * scale} width={4 * scale} height={16 * scale} fill="white" rx={1 * scale} />
          </g>
          
          {/* Title text */}
          <text
            x={tableWidth / 2 + 8 * scale}
            y={26 * scale}
            textAnchor="middle"
            fill="white"
            fontSize={15 * scale}
            fontWeight="bold"
          >
            {title}
          </text>

          {/* Decorative line under header */}
          <line
            x1={0}
            y1={44 * scale}
            x2={tableWidth}
            y2={44 * scale}
            stroke="#1e40af"
            strokeWidth={1}
          />

          {/* Table rows */}
          <g transform={`translate(${5 * scale}, ${50 * scale})`}>
            {rows.map((row, i) => {
              const isCapacitorRow = row.label === 'المكثف';
              const isCapacitorYes = row.value === 'موجود';
              
              return (
              <g key={i} transform={`translate(0, ${i * 25 * scale})`}>
                {/* Row background */}
                <rect x={0} y={0} width={290 * scale} height={25 * scale} fill={i % 2 === 0 ? '#eff6ff' : 'white'} />
                
                {/* Left side - label */}
                <rect x={0} y={0} width={145 * scale} height={25 * scale} fill={i % 2 === 0 ? '#eff6ff' : 'white'} />
                
                {/* Right side - value */}
                <rect x={145 * scale} y={0} width={145 * scale} height={25 * scale} fill={i % 2 === 0 ? '#eff6ff' : 'white'} />
                
                {/* Divider */}
                <line x1={145 * scale} y1={0} x2={145 * scale} y2={25 * scale} stroke="#bfdbfe" strokeWidth={0.5 * scale} />
                
                {/* Label text */}
                <text x={8 * scale} y={16 * scale} fontSize={9 * scale} fill="#1e40af" fontWeight="600">{row.label}</text>
                
                {/* Value with special styling for capacitor */}
                {isCapacitorRow ? (
                  <g>
                    <circle 
                      cx={165 * scale} 
                      cy={12 * scale} 
                      r={5 * scale} 
                      fill={isCapacitorYes ? '#22c55e' : '#ef4444'} 
                    />
                    <text x={175 * scale} y={16 * scale} fontSize={9 * scale} fill={isCapacitorYes ? '#166534' : '#991b1b'} fontWeight="bold">{row.value}</text>
                  </g>
                ) : (
                  <text x={150 * scale} y={16 * scale} fontSize={9 * scale} fill="#1e293b" fontWeight="700">{row.value}</text>
                )}
              </g>
            )})}
          </g>
        </g>
      );
    }
    return null;
  };

  const renderConnectionLabels = () => {
    const connections = new Map<string, { p1: Point, p2: Point, maxOffset: number }>();
    
    elements.filter(e => e.type === 'cable').forEach(e => {
      const cable = e as CableElement;
      for (let i = 0; i < cable.poleIds.length - 1; i++) {
        const id1 = cable.poleIds[i];
        const id2 = cable.poleIds[i+1];
        const key = [id1, id2].sort().join('_');
        
        if (!connections.has(key)) {
          const p1El = elements.find(el => el.id === id1);
          const p2El = elements.find(el => el.id === id2);
          if (p1El && p2El) {
            // Ensure p1 is the "start" based on ID sort for consistent direction (SAME AS SketchCanvas)
            const [start, end] = id1 < id2 ? [p1El, p2El] : [p2El, p1El];
            connections.set(key, { 
              p1: { x: start.x, y: start.y }, 
              p2: { x: end.x, y: end.y }, 
              maxOffset: -Infinity 
            });
          }
        }
        const conn = connections.get(key);
        if (conn) {
          const effectiveOffset = (id1 < id2) ? (cable.offset || 0) : -(cable.offset || 0);
          conn.maxOffset = Math.max(conn.maxOffset, effectiveOffset);
        }
      }
    });

    return Array.from(connections.entries()).map(([key, conn]) => {
      const { p1, p2, maxOffset } = conn;
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;

      const len = Math.sqrt(dx*dx + dy*dy);
      const nx = -dy / len;
      const ny = dx / len;
      const baseOffset = 15 * distanceTextScale;
      const labelOffset = Math.max(0, maxOffset) + baseOffset;
      const storedOffset = connectionLabelOffsets[key] || { x: 0, y: 0 };
      const lx = mx + nx * labelOffset + storedOffset.x;
      const ly = my + ny * labelOffset + storedOffset.y;
      const distance = connectionDistances[key] ?? "1";

      return (
        <g key={key} transform={`translate(${lx}, ${ly}) rotate(${angle})`}>
          <text x={0} y={0} dy=".3em" textAnchor="middle" fontSize={10 * distanceTextScale} fill="red" fontWeight="bold" stroke="white" strokeWidth={3} paintOrder="stroke">
            {distanceFlags?.[key]?.estimated ? `≈${distance}` : distance}
          </text>
        </g>
      );
    });
  };

  return (
    <>
      {elements.filter(el => el.type === 'cable').map(el => renderElement(el))}
      {elements.filter(el => el.type !== 'cable').map(el => renderElement(el))}
      {showDistanceLabels && renderConnectionLabels()}
      {voltageDrop && <VoltageDropOverlay elements={elements} result={voltageDrop} poleRadius={POLE_RADIUS * poleSizeScale} textScale={distanceTextScale} />}
    </>
  );
};
