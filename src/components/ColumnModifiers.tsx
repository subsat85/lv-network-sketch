import React from 'react';
import { SymbolElement } from '../types/drawing';

interface ColumnModifiersProps {
  element: SymbolElement;
  poleSizeScale: number;
  onNoteMouseDown?: (e: React.PointerEvent, elementId: string) => void;
}

export const ColumnModifiers: React.FC<ColumnModifiersProps> = ({ element, poleSizeScale, onNoteMouseDown }) => {
  const { modifiers, width, rotation = 0 } = element;
  if (!modifiers) return null;

  // In renderSymbol, radius is calculated as POLE_RADIUS * poleSizeScale.
  // We assume POLE_RADIUS is 20 (hardcoded in SketchCanvas).
  const POLE_RADIUS = 20;
  const r = POLE_RADIUS * poleSizeScale;
  
  // Tilted Line
  const lineLength = 2.25 * r; // ~112% of diameter (2r)
  const halfLen = lineLength / 2;
  
  const note = element.symbolId !== 'transformer' ? modifiers.note : undefined;
  
  return (
    <g className="modifiers">
      {modifiers.isProposedReplacement && (
        element.symbolId === 'lattice-iron-pole' ? (
          <rect
            x={-r - 5}
            y={-r - 5}
            width={(r + 5) * 2}
            height={(r + 5) * 2}
            fill="none"
            stroke="red"
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
        ) : (
          <circle
            cx={0} cy={0}
            r={r + 5}
            fill="none"
            stroke="red"
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
        )
      )}

      {modifiers.isTilted && (
        <line
          x1={-halfLen} y1={0}
          x2={halfLen} y2={0}
          stroke="red"
          strokeWidth={3}
          transform="rotate(-45)"
          style={{ pointerEvents: 'none' }}
        />
      )}
      
      {modifiers.isRusted && (
        <circle
          cx={0} cy={0}
          r={r * 0.4}
          fill="red"
          style={{ pointerEvents: 'none' }}
        />
      )}
      
      {note && (
        <NoteBox 
          note={note} 
          elementId={element.id} 
          rotation={rotation} 
          columnRadius={r}
          onMouseDown={onNoteMouseDown}
        />
      )}
    </g>
  );
};

const NoteBox = ({ note, elementId, rotation, columnRadius, onMouseDown }: any) => {
    const fontSize = note.fontSize || 12;
    const padding = 8;
    const lines = note.text.split('\n');
    const maxLineLen = Math.max(...lines.map((l: string) => l.length));
    // Approximate width based on char count (0.6em per char)
    const boxWidth = Math.max(60, maxLineLen * fontSize * 0.7 + padding * 2);
    const boxHeight = lines.length * fontSize * 1.2 + padding * 2;
    
    const halfW = boxWidth / 2;
    const halfH = boxHeight / 2;

    // Vector from center to note
    const dx = note.x;
    const dy = note.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    // Avoid division by zero
    if (dist < 0.1) return null;

    // Column edge point (Arrow End)
    const colEdgeX = (dx / dist) * columnRadius;
    const colEdgeY = (dy / dist) * columnRadius;
    
    // Note box edge point (Arrow Start)
    // Intersect ray from center to note with the unrotated box placed at (note.x, note.y)
    // We do this by transforming the ray into the box's local space (rotated by -rotation)
    const angleToNote = Math.atan2(dy, dx);
    const angleInBoxSpace = angleToNote - (-rotation * Math.PI / 180);
    
    const cosA = Math.cos(angleInBoxSpace);
    const sinA = Math.sin(angleInBoxSpace);
    
    // Ray intersection with AABB centered at 0
    // t = halfW / |cos| or halfH / |sin|
    const tX = Math.abs(cosA) > 0.001 ? halfW / Math.abs(cosA) : Infinity;
    const tY = Math.abs(sinA) > 0.001 ? halfH / Math.abs(sinA) : Infinity;
    const edgeDist = Math.min(tX, tY);
    
    const arrowStartX = note.x - (dx / dist) * edgeDist;
    const arrowStartY = note.y - (dy / dist) * edgeDist;
    
    // Arrowhead calculation
    const arrowAngle = Math.atan2(colEdgeY - arrowStartY, colEdgeX - arrowStartX) * 180 / Math.PI;

    return (
        <g>
            {/* Arrow Line */}
            <line
                x1={arrowStartX} y1={arrowStartY}
                x2={colEdgeX} y2={colEdgeY}
                stroke="black"
                strokeWidth={1}
                style={{ pointerEvents: 'none' }}
            />
            {/* Arrow Head (Manual) */}
            <path
                d="M -6 -3 L 0 0 L -6 3"
                fill="none"
                stroke="black"
                strokeWidth={1}
                transform={`translate(${colEdgeX}, ${colEdgeY}) rotate(${arrowAngle})`}
                style={{ pointerEvents: 'none' }}
            />
            
            {/* Note Group */}
            <g 
                transform={`translate(${note.x}, ${note.y}) rotate(${-rotation})`}
                onPointerDown={(e) => {
                    e.stopPropagation(); // Prevent selecting the column
                    onMouseDown && onMouseDown(e, elementId);
                }}
                className="cursor-move"
                style={{ touchAction: 'none' }}
            >
                <rect
                    x={-halfW} y={-halfH}
                    width={boxWidth} height={boxHeight}
                    fill={note.color || 'white'}
                    fillOpacity={0.9}
                    stroke="lightgray"
                    strokeWidth={1}
                    rx={4}
                />
                <text
                    x={0} y={0}
                    dy={-(lines.length - 1) * fontSize * 0.6 + fontSize * 0.3}
                    textAnchor="middle"
                    fontSize={fontSize}
                    fill="black"
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                    {lines.map((line: string, i: number) => (
                        <tspan x={0} dy={i === 0 ? 0 : fontSize * 1.2} key={i}>
                            {line}
                        </tspan>
                    ))}
                </text>
            </g>
        </g>
    );
};
