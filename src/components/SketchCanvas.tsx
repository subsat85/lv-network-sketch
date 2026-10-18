import React, { useRef, useState, useEffect, useMemo } from 'react';
import { ColumnContextMenu } from './ColumnContextMenu';
import { ColumnModifiers } from './ColumnModifiers';
import { useDrawingStore } from '../store/drawingStore';
import { Point, PathElement, TextElement, SymbolElement, CableElement, ConsumerElement, ArcElement, DrawingElement, ShapeElement, ShapeType, CableArcElement } from '../types/drawing';
import { pathSegmentSpans } from '../utils/cableSegments';
import { arcGeometry, arcPick, ArcPickAction, ArcPickState, createArc, listConnectionPoints, sameEnd } from '../utils/cableArcs';
import { calculateCablePath } from '../utils/cableLayout';
import { createZigzagPath, generateHighQualityArcPath } from '../utils/svgHelpers';
import { simplifyPath, detectShape, generateSmoothPathData } from '../utils/pathUtils';

const generateId = () => Math.random().toString(36).substr(2, 9);
const POLE_RADIUS = 20;
const CABLE_SPACING = 8;

const getCircleSegmentIntersection = (p1: Point, p2: Point, center: Point, r: number): Point | null => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = (fx * fx + fy * fy) - r * r;
  let delta = b * b - 4 * a * c;
  if (delta < 0) return null;
  delta = Math.sqrt(delta);
  const t1 = (-b - delta) / (2 * a);
  const t2 = (-b + delta) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return { x: p1.x + t1 * dx, y: p1.y + t1 * dy };
  if (t2 >= 0 && t2 <= 1) return { x: p1.x + t2 * dx, y: p1.y + t2 * dy };
  return null;
};

const getSegmentDistance = (p: Point, p1: Point, p2: Point) => {
  const x = p1.x;
  const y = p1.y;
  const dx = p2.x - x;
  const dy = p2.y - y;
  
  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 0 && t < 1) {
      const projX = x + t * dx;
      const projY = y + t * dy;
      const dist = Math.hypot(p.x - projX, p.y - projY);
      return { distance: dist, projection: { x: projX, y: projY } };
    }
  }
  return { distance: Infinity, projection: p };
};

type PendingConsumerState = {
  poleId: string;
  step: 'color-select' | 'count-adjust';
  availableColors: string[];
  selectedColor: string | null;
  count: number;
  position: Point;
} | null;

export const SketchCanvas: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const rawPointsRef = useRef<Point[]>([]); // Store raw points for snapping
  const lastTapRef = useRef<number>(0); // For double tap detection
  
  // Zoom/Pan State
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [editingDistance, setEditingDistance] = useState<{ key: string, value: string } | null>(null);
  const [draggingLabel, setDraggingLabel] = useState<{ key: string, startX: number, startY: number, initialOffset: {x: number, y: number} } | null>(null);
  const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map());
  const pointerStartRef = useRef<Map<number, { x: number, y: number, time: number }>>(new Map());
  const gestureRef = useRef<{
    startDist: number;
    startScale: number;
    startCenter: { x: number, y: number }; // Client coordinates
    startTransform: { x: number, y: number };
  } | null>(null);

  const { 
    elements, 
    tool, 
    style, 
    selectedId, 
    activeSymbolId,
    activeCableId,
    activeShapeType,
    poleSizeScale,
    distanceTextScale,
    consumerSizeScale,
    showDistanceLabels,
    connectionLabelOffsets,
    updateConnectionLabelOffset,
    addElement,   
    updateElement, 
    deleteElement,
    setSelectedId,
    setActiveCableId,
    saveHistory,
    consumerVariant,
    connectionDistances,
    updateConnectionDistance,
    updateSymbolModifiers
  } = useDrawingStore();

  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<'nw' | 'ne' | 'se' | 'sw' | null>(null);
  const [initialSize, setInitialSize] = useState<{ width: number; height: number; x: number; y: number } | null>(null);
  const [rotationStartAngle, setRotationStartAngle] = useState(0);
  const [initialRotation, setInitialRotation] = useState(0);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [currentPathId, setCurrentPathId] = useState<string | null>(null);
  const [pendingConsumer, setPendingConsumer] = useState<PendingConsumerState>(null);
  const [pendingArc, setPendingArc] = useState<ArcElement | null>(null);
  const [pendingShape, setPendingShape] = useState<ShapeElement | null>(null);
  const [draggingArcPoint, setDraggingArcPoint] = useState<{ id: string, type: 'start' | 'end' | 'control' } | null>(null);
  
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; elementId: string | null }>({
    visible: false, x: 0, y: 0, elementId: null
  });
  // Cable arc tool: pick two connection points at one pole; each pair becomes an arc.
  const [arcPickState, setArcPickState] = useState<ArcPickState>(null);
  const arcRadius = POLE_RADIUS * poleSizeScale;
  const arcPoints = useMemo(
    () => (arcPickState ? listConnectionPoints(elements, arcPickState.poleId, arcRadius) : []),
    [arcPickState, elements, arcRadius]
  );
  const dispatchArcPick = (action: ArcPickAction) => {
    const res = arcPick(arcPickState, action);
    if (res.create && arcPickState) {
      const r = createArc(elements, arcPickState.poleId, res.create.from, res.create.to, generateId());
      if (r.ok) addElement(r.arc);
    }
    setArcPickState(res.state);
  };
  // leave the arc tool when the tool changes or its pole disappears; Escape cancels
  useEffect(() => { setArcPickState(null); }, [tool]);
  useEffect(() => {
    if (arcPickState && !elements.some(e => e.id === arcPickState.poleId && e.type === 'symbol')) setArcPickState(null);
  }, [elements, arcPickState]);
  useEffect(() => {
    if (!arcPickState) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setArcPickState(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [arcPickState]);

  const [draggingNote, setDraggingNote] = useState<{ elementId: string; startX: number; startY: number; startNoteX: number; startNoteY: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPanPosition, setLastPanPosition] = useState<{ x: number; y: number } | null>(null);

  // Helper to get World Coordinates from Client Coordinates
  const getWorldCoordinates = (clientX: number, clientY: number): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return { x: 0, y: 0 };
    
    // Convert to SVG Viewport coordinates
    const svgX = (clientX - CTM.e) / CTM.a;
    const svgY = (clientY - CTM.f) / CTM.d;
    
    // Apply Pan/Zoom transform
    const transformedX = (svgX - transform.x) / transform.scale;
    const transformedY = (svgY - transform.y) / transform.scale;

    return {
      x: transformedX,
      y: transformedY,
    };
  };

  // Helper to snap coordinates to existing symbols
  const snapToSymbols = (coords: Point, excludeId?: string): Point => {
    const threshold = 10;
    let snappedX = coords.x;
    let snappedY = coords.y;
    let minXDist = threshold;
    let minYDist = threshold;

    elements.forEach(el => {
      if (el.type !== 'symbol' || el.id === excludeId) return;
      
      const xDist = Math.abs(el.x - coords.x);
      const yDist = Math.abs(el.y - coords.y);

      if (xDist < minXDist) {
        snappedX = el.x;
        minXDist = xDist;
      }
      if (yDist < minYDist) {
        snappedY = el.y;
        minYDist = yDist;
      }
    });

    return { x: snappedX, y: snappedY };
  };

  const handleArcPointPointerDown = (e: React.PointerEvent, id: string, type: 'start' | 'end' | 'control') => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingArcPoint({ id, type });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    pointerStartRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, time: Date.now() });

    // Middle mouse button (button 1) for panning
    if (e.button === 1) {
      setIsPanning(true);
      setLastPanPosition({ x: e.clientX, y: e.clientY });
      // Cancel any active drawing/dragging
      setIsDragging(false);
      setCurrentPathId(null);
      setDragStart(null);
      rawPointsRef.current = [];
      return;
    }

    // Multi-touch Gesture Start
    if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      gestureRef.current = {
        startDist: dist,
        startScale: transform.scale,
        startCenter: center,
        startTransform: { ...transform }
      };
      
      // Cancel any active drawing/dragging
      setIsDragging(false);
      setCurrentPathId(null);
      setDragStart(null);
      rawPointsRef.current = [];
      return;
    }

    if (pointersRef.current.size > 1) return; // Ignore 3+ fingers

    const coords = getWorldCoordinates(e.clientX, e.clientY);
    const now = Date.now();
    const isDoubleTap = now - lastTapRef.current < 300;
    lastTapRef.current = now;

    if (tool === 'arc') {
      saveHistory();
      const id = generateId();
      const newArc: ArcElement = {
        id,
        type: 'arc',
        x: coords.x,
        y: coords.y,
        x2: coords.x,
        y2: coords.y,
        controlX: coords.x,
        controlY: coords.y,
        strokeColor: style.strokeColor,
        fillColor: 'none',
        strokeWidth: style.strokeWidth,
      };
      setPendingArc(newArc);
      return;
    }

    if (tool === 'draw') {
      saveHistory();
      const id = generateId();
      rawPointsRef.current = [coords]; // Initialize raw points
      const newPath: PathElement = {
        id,
        type: 'path',
        x: 0, 
        y: 0,
        points: [coords], 
        strokeColor: style.strokeColor,
        fillColor: 'none',
        strokeWidth: style.strokeWidth,
      };
      addElement(newPath);
      setCurrentPathId(id);
    } else if (tool === 'shape' && activeShapeType) {
      saveHistory();
      const id = generateId();
      const newShape: ShapeElement = {
        id,
        type: 'shape',
        shapeType: activeShapeType,
        x: coords.x,
        y: coords.y,
        width: 0,
        height: 0,
        strokeColor: style.strokeColor,
        fillColor: style.fillColor,
        strokeWidth: style.strokeWidth,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      };
      setPendingShape(newShape);
    } else if (tool === 'cable') {
      // Hit test for poles is handled in handleElementPointerDown
      // If we are here, we clicked on empty space
      if (isDoubleTap) {
        setActiveCableId(null);
      }
    } else if (tool === 'select') {
      setSelectedId(null);
    }
  };

  const handleNoteMouseDown = (e: React.PointerEvent, elementId: string) => {
    e.stopPropagation();
    if (tool !== 'select') return;
    
    const element = elements.find(el => el.id === elementId) as SymbolElement;
    if (!element || !element.modifiers?.note) return;
    
    const coords = getWorldCoordinates(e.clientX, e.clientY);
    setDraggingNote({
      elementId,
      startX: coords.x,
      startY: coords.y,
      startNoteX: element.modifiers.note.x,
      startNoteY: element.modifiers.note.y
    });
  };

  const handleElementClick = (e: React.MouseEvent, id: string) => {
    if (tool === 'select' && selectedId === id) {
       setContextMenu({
         visible: true,
         x: e.clientX,
         y: e.clientY,
         elementId: id
       });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Handle middle mouse button panning
    if (isPanning && lastPanPosition) {
      const dx = e.clientX - lastPanPosition.x;
      const dy = e.clientY - lastPanPosition.y;
      setTransform(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
      }));
      setLastPanPosition({ x: e.clientX, y: e.clientY });
      return;
    }

    if (draggingArcPoint) {
      const coords = getWorldCoordinates(e.clientX, e.clientY);
      const el = elements.find(e => e.id === draggingArcPoint.id) as ArcElement;
      if (el) {
        if (draggingArcPoint.type === 'start') {
          updateElement(el.id, { x: coords.x, y: coords.y });
        } else if (draggingArcPoint.type === 'end') {
          updateElement(el.id, { x2: coords.x, y2: coords.y });
        } else if (draggingArcPoint.type === 'control') {
          updateElement(el.id, { controlX: coords.x, controlY: coords.y });
        }
      }
      return;
    }

    if (draggingLabel) {
      const coords = getWorldCoordinates(e.clientX, e.clientY);
      const dx = coords.x - draggingLabel.startX;
      const dy = coords.y - draggingLabel.startY;
      
      updateConnectionLabelOffset(draggingLabel.key, {
        x: draggingLabel.initialOffset.x + dx,
        y: draggingLabel.initialOffset.y + dy
      });
      return;
    }

    if (draggingNote) {
       const coords = getWorldCoordinates(e.clientX, e.clientY);
       const dx = coords.x - draggingNote.startX;
       const dy = coords.y - draggingNote.startY;
       
       const element = elements.find(el => el.id === draggingNote.elementId) as SymbolElement;
       if (element && element.modifiers?.note) {
          const rotation = (element.rotation || 0) * Math.PI / 180;
          const localDx = dx * Math.cos(rotation) + dy * Math.sin(rotation);
          const localDy = -dx * Math.sin(rotation) + dy * Math.cos(rotation);
          
          updateSymbolModifiers(draggingNote.elementId, {
             note: {
                ...element.modifiers.note,
                x: draggingNote.startNoteX + localDx,
                y: draggingNote.startNoteY + localDy
             }
          });
       }
       return;
    }

    // Handle Gesture
    if (gestureRef.current && pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      const p1 = points[0];
      const p2 = points[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const center = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      const { startDist, startScale, startCenter, startTransform } = gestureRef.current;

      if (startDist > 0 && svgRef.current) {
        const scale = (dist / startDist) * startScale;
        
        const CTM = svgRef.current.getScreenCTM();
        if (CTM) {
          // Convert centers to SVG Viewport coordinates
          const svgCenterX = (center.x - CTM.e) / CTM.a;
          const svgCenterY = (center.y - CTM.f) / CTM.d;
          const svgStartCenterX = (startCenter.x - CTM.e) / CTM.a;
          const svgStartCenterY = (startCenter.y - CTM.f) / CTM.d;

          // Calculate world point under start center
          const worldX = (svgStartCenterX - startTransform.x) / startScale;
          const worldY = (svgStartCenterY - startTransform.y) / startScale;

          // Calculate new transform
          const newX = svgCenterX - worldX * scale;
          const newY = svgCenterY - worldY * scale;

          setTransform({ x: newX, y: newY, scale });
        }
      }
      return;
    }

    if (isRotating && selectedId) {
      const el = elements.find(e => e.id === selectedId);
      if (el) {
        const { x, y } = getWorldCoordinates(e.clientX, e.clientY);
        
        // For shapes, use center point
        let centerX = el.x;
        let centerY = el.y;
        if (el.type === 'shape') {
          const shape = el as ShapeElement;
          centerX = shape.x + shape.width / 2;
          centerY = shape.y + shape.height / 2;
        }
        
        const dx = x - centerX;
        const dy = y - centerY;
        let angle = Math.atan2(dy, dx) * 180 / Math.PI;
        
        // Calculate delta from start angle
        let rotation = initialRotation + (angle - rotationStartAngle);
        
        updateElement(selectedId, { rotation });
      }
      return;
    }

    if (isResizing && selectedId && initialSize && resizeHandle) {
      const el = elements.find(e => e.id === selectedId) as ShapeElement;
      if (el) {
        const { x, y } = getWorldCoordinates(e.clientX, e.clientY);
        
        let newWidth = initialSize.width;
        let newHeight = initialSize.height;
        let newX = initialSize.x;
        let newY = initialSize.y;
        
        const minSize = 20;
        
        switch (resizeHandle) {
          case 'se':
            newWidth = Math.max(minSize, x - initialSize.x);
            newHeight = Math.max(minSize, y - initialSize.y);
            break;
          case 'sw':
            newWidth = Math.max(minSize, initialSize.x + initialSize.width - x);
            newHeight = Math.max(minSize, y - initialSize.y);
            newX = Math.min(initialSize.x + initialSize.width - minSize, x);
            break;
          case 'ne':
            newWidth = Math.max(minSize, x - initialSize.x);
            newHeight = Math.max(minSize, initialSize.y + initialSize.height - y);
            newY = Math.min(initialSize.y + initialSize.height - minSize, y);
            break;
          case 'nw':
            newWidth = Math.max(minSize, initialSize.x + initialSize.width - x);
            newHeight = Math.max(minSize, initialSize.y + initialSize.height - y);
            newX = Math.min(initialSize.x + initialSize.width - minSize, x);
            newY = Math.min(initialSize.y + initialSize.height - minSize, y);
            break;
        }
        
        updateElement(selectedId, { x: newX, y: newY, width: newWidth, height: newHeight });
      }
      return;
    }

    if (pointersRef.current.size > 1) return;

    const coords = getWorldCoordinates(e.clientX, e.clientY);

    if (pendingArc) {
      const dx = coords.x - pendingArc.x;
      const dy = coords.y - pendingArc.y;
      
      const midX = (pendingArc.x + coords.x) / 2;
      const midY = (pendingArc.y + coords.y) / 2;
      
      // Perpendicular vector
      const perpX = -(coords.y - pendingArc.y);
      const perpY = (coords.x - pendingArc.x);
      
      // Offset by 20% of distance
      const dist = Math.hypot(dx, dy);
      const offset = dist * 0.2;
      
      // Normalize perp
      const len = Math.hypot(perpX, perpY);
      const nx = len > 0 ? perpX / len : 0;
      const ny = len > 0 ? perpY / len : 0;
      
      setPendingArc({
        ...pendingArc,
        x2: coords.x,
        y2: coords.y,
        controlX: midX + nx * offset,
        controlY: midY + ny * offset
      });
      return;
    }

    if (pendingShape) {
      const dx = coords.x - pendingShape.x;
      const dy = coords.y - pendingShape.y;
      const width = Math.abs(dx);
      const height = Math.abs(dy);
      
      setPendingShape({
        ...pendingShape,
        width,
        height,
        // For shapes that need direction (arrow, compass)
        rotation: Math.atan2(dy, dx) * 180 / Math.PI,
      });
      return;
    }

    if (tool === 'draw' && currentPathId) {
      // Append to raw points
      rawPointsRef.current.push(coords);
      
      const startPoint = rawPointsRef.current[0];
      const dx = coords.x - startPoint.x;
      const dy = coords.y - startPoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let finalPoints = [...rawPointsRef.current];

      // Snap logic
      if (dist > 10) { // Only snap if line is long enough
        const angleRad = Math.atan2(dy, dx);
        let angleDeg = angleRad * 180 / Math.PI;
        if (angleDeg < 0) angleDeg += 360;

        const snapAngles = [0, 45, 90, 135, 180, 225, 270, 315, 360];
        const threshold = 8; // degrees

        for (const snapAngle of snapAngles) {
          let diff = Math.abs(angleDeg - snapAngle);
          if (diff > 180) diff = 360 - diff; // Handle wrap around

          if (diff < threshold) {
            // Snap to this angle
            const snapRad = snapAngle * Math.PI / 180;
            const snappedX = startPoint.x + dist * Math.cos(snapRad);
            const snappedY = startPoint.y + dist * Math.sin(snapRad);
            
            // Replace path with straight line
            finalPoints = [startPoint, { x: snappedX, y: snappedY }];
            break;
          }
        }
      }

      updateElement(currentPathId, { points: finalPoints });

    } else if (tool === 'select' && isDragging && selectedId && dragStart) {
      const dx = coords.x - dragStart.x;
      const dy = coords.y - dragStart.y;
      
      const el = elements.find(e => e.id === selectedId);
      if (el) {
        // auto-placed consumer: start from where it is drawn and pin it there
        const autoConsumer = el.type === 'consumer' && !(el as ConsumerElement).hasManualPosition;
        const base = autoConsumer ? consumerAutoPosition(el as ConsumerElement) : { x: el.x, y: el.y };
        let newX = base.x + dx;
        let newY = base.y + dy;

        // Snap if it's a symbol
        if (el.type === 'symbol') {
          const snapped = snapToSymbols({ x: newX, y: newY }, selectedId);
          newX = snapped.x;
          newY = snapped.y;
        }

        if (el.type === 'arc') {
           const arc = el as ArcElement;
           updateElement(selectedId, {
             x: newX,
             y: newY,
             x2: arc.x2 + dx,
             y2: arc.y2 + dy,
             controlX: arc.controlX + dx,
             controlY: arc.controlY + dy
           });
        } else {
           updateElement(selectedId, autoConsumer ? { x: newX, y: newY, hasManualPosition: true } : { x: newX, y: newY });
        }
        setDragStart(coords); 
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    
    const start = pointerStartRef.current.get(e.pointerId);
    pointerStartRef.current.delete(e.pointerId);

    if (pointersRef.current.size < 2) {
      gestureRef.current = null;
    }

    if (draggingArcPoint) {
      setDraggingArcPoint(null);
      return;
    }

    if (pendingArc) {
      addElement(pendingArc);
      setPendingArc(null);
      return;
    }

    if (pendingShape) {
      // Only add if shape has some size
      if (pendingShape.width > 5 || pendingShape.height > 5) {
        addElement(pendingShape);
      }
      setPendingShape(null);
      return;
    }

    // Smart path processing for freehand drawing
    if (tool === 'draw' && currentPathId && rawPointsRef.current.length > 2) {
      const rawPoints = rawPointsRef.current;
      const detected = detectShape(rawPoints);
      
      // If a shape was detected, replace the path with the detected shape
      if (detected.type === 'circle') {
        // Remove the path and add a circle shape instead
        const pathElement = elements.find(e => e.id === currentPathId);
        if (pathElement) {
          // Delete the path and create a circle shape
          deleteElement(currentPathId);
          const circleShape: ShapeElement = {
            id: generateId(),
            type: 'shape',
            shapeType: 'circle',
            x: detected.center.x - detected.radius,
            y: detected.center.y - detected.radius,
            width: detected.radius * 2,
            height: detected.radius * 2,
            strokeColor: pathElement.strokeColor,
            fillColor: 'transparent',
            strokeWidth: pathElement.strokeWidth,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          };
          addElement(circleShape);
        }
      } else if (detected.type === 'rectangle') {
        const pathElement = elements.find(e => e.id === currentPathId);
        if (pathElement) {
          deleteElement(currentPathId);
          const rectShape: ShapeElement = {
            id: generateId(),
            type: 'shape',
            shapeType: 'rectangle',
            x: detected.x,
            y: detected.y,
            width: detected.width,
            height: detected.height,
            strokeColor: pathElement.strokeColor,
            fillColor: 'transparent',
            strokeWidth: pathElement.strokeWidth,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          };
          addElement(rectShape);
        }
      } else if (detected.type === 'line') {
        // Simplify to a straight line
        updateElement(currentPathId, { points: [detected.start, detected.end] });
      } else if (detected.type === 'triangle') {
        const pathElement = elements.find(e => e.id === currentPathId);
        if (pathElement && detected.points.length === 3) {
          // Calculate bounding box for triangle shape
          const minX = Math.min(...detected.points.map(p => p.x));
          const maxX = Math.max(...detected.points.map(p => p.x));
          const minY = Math.min(...detected.points.map(p => p.y));
          const maxY = Math.max(...detected.points.map(p => p.y));
          
          deleteElement(currentPathId);
          const triangleShape: ShapeElement = {
            id: generateId(),
            type: 'shape',
            shapeType: 'triangle',
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            strokeColor: pathElement.strokeColor,
            fillColor: 'transparent',
            strokeWidth: pathElement.strokeWidth,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
          };
          addElement(triangleShape);
        }
      } else {
        // Just simplify and smooth the path
        const simplified = simplifyPath(rawPoints, 3);
        updateElement(currentPathId, { points: simplified });
      }
      
      setCurrentPathId(null);
      rawPointsRef.current = [];
      return;
    }

    // Clear path drawing state if still active
    if (currentPathId) {
      setCurrentPathId(null);
      rawPointsRef.current = [];
    }

    if (draggingLabel) {
       const coords = getWorldCoordinates(e.clientX, e.clientY);
       const dx = coords.x - draggingLabel.startX;
       const dy = coords.y - draggingLabel.startY;
       const dist = Math.hypot(dx, dy);
       
       if (dist < 5) {
          // It was a click, trigger edit
          const currentDist = connectionDistances[draggingLabel.key] ?? '1';
          setEditingDistance({ key: draggingLabel.key, value: currentDist });
       }
       
       setDraggingLabel(null);
       return;
    }

    if (draggingNote) {
       const coords = getWorldCoordinates(e.clientX, e.clientY);
       const dx = coords.x - draggingNote.startX;
       const dy = coords.y - draggingNote.startY;
       const dist = Math.sqrt(dx*dx + dy*dy);
       
       if (dist < 5) {
          const element = elements.find(el => el.id === draggingNote.elementId) as SymbolElement;
          if (element && element.modifiers?.note) {
             const newText = prompt('Edit Note:', element.modifiers.note.text);
             if (newText !== null) {
                updateSymbolModifiers(draggingNote.elementId, {
                   note: { ...element.modifiers.note, text: newText }
                });
             }
          }
       }
    }

    // Handle Tap for Tool Execution (Symbol, Text, Consumer)
    if (start && !gestureRef.current && !isDragging && !isRotating && !draggingLabel && !draggingNote) {
       const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
       if (dist < 10) { // Tap threshold
          const coords = getWorldCoordinates(e.clientX, e.clientY);
          
          if (tool === 'text') {
            const text = prompt('Enter text:', '');
            if (text) {
              saveHistory();
              const newText: TextElement = {
                id: generateId(),
                type: 'text',
                x: coords.x,
                y: coords.y,
                text,
                fontSize: style.fontSize,
                strokeColor: style.strokeColor,
                fillColor: style.strokeColor,
                strokeWidth: 1,
              };
              addElement(newText);
            }
          } else if (tool === 'symbol' && activeSymbolId) {
            saveHistory();
            
            // Check for cable split
            let splitInfo: { cable: CableElement, index: number, point: Point, distance: number, id1: string, id2: string } | null = null;
            const splitThreshold = 20;
            
            // Iterate cables to find split candidate
            for (const el of elements) {
              if (el.type === 'cable') {
                const cable = el as CableElement;
                for (let i = 0; i < cable.poleIds.length - 1; i++) {
                   const id1 = cable.poleIds[i];
                   const id2 = cable.poleIds[i+1];
                   const p1 = elements.find(e => e.id === id1);
                   const p2 = elements.find(e => e.id === id2);
                   
                   if (p1 && p2) {
                     const { distance, projection } = getSegmentDistance(coords, {x: p1.x, y: p1.y}, {x: p2.x, y: p2.y});
                     if (distance < splitThreshold) {
                       if (!splitInfo || distance < splitInfo.distance) {
                         splitInfo = { cable, index: i, point: projection, distance, id1, id2 };
                       }
                     }
                   }
                }
              }
            }

            let finalCoords = coords;
            if (splitInfo) {
               finalCoords = splitInfo.point;
            } else {
               finalCoords = snapToSymbols(coords);
            }
            
            const newId = generateId();
            const newSymbol: SymbolElement = {
              id: newId,
              type: 'symbol',
              x: finalCoords.x,
              y: finalCoords.y,
              symbolId: activeSymbolId,
              width: 24, // Default size
              height: 24,
              strokeColor: '#000000',
              fillColor: activeSymbolId === 'lv-pole' || activeSymbolId === 'small-dot-pole' ? '#FFFFFF' : '#000000',
              strokeWidth: 2,
            };
            addElement(newSymbol);

            if (splitInfo) {
              // Split the cable
              const { cable, index, id1, id2 } = splitInfo;
              const newPoleIds = [...cable.poleIds];
              newPoleIds.splice(index + 1, 0, newId);
              updateElement(cable.id, { poleIds: newPoleIds });
              
              // Update distances
              const key = [id1, id2].sort().join('_');
              const oldDistStr = connectionDistances[key] || "1";
              const oldDist = parseFloat(oldDistStr);
              const newDistVal = isNaN(oldDist) ? 1 : oldDist / 2;
              const newDistStr = Number.isInteger(newDistVal) ? newDistVal.toString() : newDistVal.toFixed(1);
              
              const key1 = [id1, newId].sort().join('_');
              const key2 = [newId, id2].sort().join('_');
              
              updateConnectionDistance(key1, newDistStr);
              updateConnectionDistance(key2, newDistStr);
            }
          } else if (tool === 'consumer') {
            if (pendingConsumer) {
              if (pendingConsumer.step === 'count-adjust') {
                // Confirm placement
                const pole = elements.find(e => e.id === pendingConsumer.poleId);
                if (pole) {
                  let label = '';
                  if (consumerVariant === 'square') {
                     label = prompt('Enter label number:', '') || '';
                  }

                  const newConsumer: ConsumerElement = {
                    id: generateId(),
                    type: 'consumer',
                    x: pole.x, // Placeholder, rendered dynamically
                    y: pole.y,
                    strokeColor: pendingConsumer.selectedColor!,
                    fillColor: pendingConsumer.selectedColor!,
                    strokeWidth: 2,
                    poleId: pendingConsumer.poleId,
                    color: pendingConsumer.selectedColor!,
                    count: pendingConsumer.count,
                    variant: consumerVariant,
                    label: label
                  };
                  addElement(newConsumer);
                }
                setPendingConsumer(null);
              } else {
                // Cancel
                setPendingConsumer(null);
              }
            }
          }
       }
    }

    setCurrentPathId(null);
    setIsDragging(false);
    setIsRotating(false);
    setIsResizing(false);
    setResizeHandle(null);
    setInitialSize(null);
    setDragStart(null);
    setDraggingNote(null);
    setIsPanning(false);
    setLastPanPosition(null);
    rawPointsRef.current = []; // Clear raw points
  };

  // Handle mouse wheel for zoom and pan
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!svgRef.current) return;

    const CTM = svgRef.current.getScreenCTM();
    if (!CTM) return;

    // Calculate mouse position in SVG coordinates
    const svgX = (e.clientX - CTM.e) / CTM.a;
    const svgY = (e.clientY - CTM.f) / CTM.d;

    // Determine zoom factor (with smoothing)
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    
    // Shift+wheel for horizontal pan, wheel for zoom
    if (e.shiftKey) {
      // Horizontal pan
      const deltaX = e.deltaY * 0.5;
      setTransform(prev => ({
        ...prev,
        x: prev.x + deltaX
      }));
    } else if (e.ctrlKey || e.metaKey) {
      // Zoom centered on mouse position
      const newScale = Math.max(0.1, Math.min(10, transform.scale * zoomFactor));
      
      // Calculate world point under mouse
      const worldX = (svgX - transform.x) / transform.scale;
      const worldY = (svgY - transform.y) / transform.scale;

      // Calculate new transform to keep mouse position fixed
      const newX = svgX - worldX * newScale;
      const newY = svgY - worldY * newScale;

      setTransform({ x: newX, y: newY, scale: newScale });
    } else {
      // Vertical pan (default behavior)
      const deltaY = e.deltaY * 0.5;
      setTransform(prev => ({
        ...prev,
        y: prev.y + deltaY
      }));
    }
  };

  const handleRotationPointerDown = (e: React.PointerEvent, el: BaseElement) => {
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = getWorldCoordinates(e.clientX, e.clientY);
    
    // For shapes, use center point
    let centerX = el.x;
    let centerY = el.y;
    if (el.type === 'shape') {
      const shape = el as ShapeElement;
      centerX = shape.x + shape.width / 2;
      centerY = shape.y + shape.height / 2;
    }
    
    const dx = x - centerX;
    const dy = y - centerY;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    
    setIsRotating(true);
    setRotationStartAngle(angle);
    setInitialRotation(el.rotation || 0);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handleResizePointerDown = (e: React.PointerEvent, el: ShapeElement, handle: 'nw' | 'ne' | 'se' | 'sw') => {
    e.stopPropagation();
    e.preventDefault();
    saveHistory();
    
    setIsResizing(true);
    setResizeHandle(handle);
    setInitialSize({ width: el.width, height: el.height, x: el.x, y: el.y });
    setSelectedId(el.id);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  // Where an auto-placed consumer is drawn (same formula the renderer uses).
  const consumerAutoPosition = (consumer: ConsumerElement) => {
    const consumersOnPole = elements.filter(e => e.type === 'consumer' && (e as ConsumerElement).poleId === consumer.poleId);
    const index = consumersOnPole.findIndex(e => e.id === consumer.id);
    const placement = getSmartPlacement(consumer.poleId);
    const radius = POLE_RADIUS * poleSizeScale;
    const consumerRadius = 16 * consumerSizeScale;
    const margin = 5 * consumerSizeScale;
    const spacing = consumerRadius * 2 + margin;
    const startOffset = radius + consumerRadius + margin;
    const totalOffset = startOffset + index * spacing;
    return { x: placement.x + placement.dx * totalOffset, y: placement.y + placement.dy * totalOffset };
  };

  const handleElementPointerDown = (e: React.PointerEvent, id: string) => {
    if (pointersRef.current.size > 1) return;

    if (tool === 'select') {
      e.stopPropagation(); 
      saveHistory(); // step boundary before a possible drag
      // (an auto-placed consumer gets its manual position on the first drag move,
      // so selecting it without moving does not change the drawing)

      setSelectedId(id);
      setIsDragging(true);
      setDragStart(getWorldCoordinates(e.clientX, e.clientY));
    } else if (tool === 'cable' || tool === 'cable_straight') {
      e.stopPropagation();
      const el = elements.find(el => el.id === id);
      
      // Allow selecting an existing cable to continue drawing
      if (el && el.type === 'cable') {
        setActiveCableId(id);
        return;
      }

      if (el && el.type === 'symbol') {
        saveHistory(); // Save before adding pole to cable
        if (activeCableId) {
          // Add pole to existing cable
          const cable = elements.find(c => c.id === activeCableId) as CableElement;
          if (cable) {
            // Check if pole is already in the cable (prevent immediate duplicates)
            const lastPoleId = cable.poleIds[cable.poleIds.length - 1];
            if (lastPoleId !== id) {
               // Check for existing cables between lastPoleId and id
               const existingCable = elements.find(e => 
                 e.type === 'cable' && e.id !== cable.id &&
                 (e as CableElement).poleIds.some((pid, idx) => 
                   (pid === lastPoleId && (e as CableElement).poleIds[idx+1] === id) ||
                   (pid === id && (e as CableElement).poleIds[idx+1] === lastPoleId)
                 )
               ) as CableElement;

               let updates: any = { poleIds: [...cable.poleIds, id] };
               
               if (existingCable) {
                 // Match the cableIndex/offset of the existing cable to group them
                 updates.cableIndex = existingCable.cableIndex;
                 updates.offset = existingCable.offset;
               }

               updateElement(activeCableId, updates);
            }
          }
        } else {
          // Start new cable
          const existingCables = elements.filter(e => e.type === 'cable') as CableElement[];
          const maxIndex = existingCables.reduce((max, c) => Math.max(max, c.cableIndex ?? -1), -1);
          const newCableIndex = maxIndex + 1;

          // Calculate permanent offset
          // Alternating pattern: 0, 1 (Right), 2 (Left), 3 (Right), 4 (Left)...
          let offset = 0;
          if (newCableIndex > 0) {
             const isOdd = newCableIndex % 2 !== 0;
             const multiplier = isOdd ? (newCableIndex + 1) / 2 : -(newCableIndex / 2);
             offset = multiplier * CABLE_SPACING;
          }

          const newCableId = generateId();
          const newCable: CableElement = {
            id: newCableId,
            type: 'cable',
            x: 0, y: 0,
            poleIds: [id],
            strokeColor: style.strokeColor,
            fillColor: 'none',
            strokeWidth: style.strokeWidth,
            cableIndex: newCableIndex,
            offset: offset,
            lineStyle: tool === 'cable_straight' ? 'straight' : 'zigzag',
          };
          addElement(newCable);
          setActiveCableId(newCableId);
        }
      }
    } else if (tool === 'consumer') {
      e.stopPropagation();
      const el = elements.find(el => el.id === id);
      if (el && el.type === 'symbol') {
        const connectedCables = elements.filter(e => 
          e.type === 'cable' && (e as CableElement).poleIds.includes(id)
        ) as CableElement[];
        
        const availableColors = Array.from(new Set(connectedCables.map(c => c.strokeColor)));
        
        if (availableColors.length > 0) {
          if (availableColors.length === 1) {
            setPendingConsumer({
              poleId: id,
              step: 'count-adjust',
              availableColors,
              selectedColor: availableColors[0],
              count: 1,
              position: { x: el.x, y: el.y }
            });
          } else {
            setPendingConsumer({
              poleId: id,
              step: 'color-select',
              availableColors,
              selectedColor: null,
              count: 1,
              position: { x: el.x, y: el.y }
            });
          }
        }
      }
    }
  };

  // `spanKey`: the pole pair of the drawn segment that was tapped (see pathSegmentSpans).
  const handleSegmentClick = (e: React.PointerEvent, cableId: string, spanKey: string | null) => {
    e.stopPropagation();
    
    if (tool !== 'select' && tool !== 'cable' && tool !== 'cable_straight') return;

    if (selectedId !== cableId) {
      setSelectedId(cableId);
      setActiveCableId(cableId);
      return;
    }

    if (!spanKey) return;
    const key = spanKey;

    const currentDist = connectionDistances[key] ?? '1';
    const newDist = prompt('Enter distance (m):', currentDist);
    
    if (newDist !== null) {
      // one undo step, closed right away (the prompt may swallow the pointer-up)
      saveHistory();
      if (newDist.trim() === '') {
        updateConnectionDistance(key, '1');
      } else {
        updateConnectionDistance(key, newDist.trim());
      }
      saveHistory();
    }
  };

  const handleLabelPointerDown = (e: React.PointerEvent, key: string) => {
    e.stopPropagation();
    if (tool !== 'select' && tool !== 'cable' && tool !== 'cable_straight') return;
    
    const coords = getWorldCoordinates(e.clientX, e.clientY);
    const currentOffset = connectionLabelOffsets[key] || { x: 0, y: 0 };
    
    setDraggingLabel({
      key,
      startX: coords.x,
      startY: coords.y,
      initialOffset: currentOffset
    });
    
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const renderSymbol = (el: SymbolElement, isSelected: boolean) => {
    const radius = POLE_RADIUS * poleSizeScale; // Apply scale ONLY to radius
    
    return (
      <g key={el.id} transform={`translate(${el.x}, ${el.y}) rotate(${el.rotation || 0})`} onClick={(e) => handleElementClick(e, el.id)}>
        {el.symbolId === 'lv-pole' && (
          <circle 
            cx={0} cy={0} r={radius} 
            stroke={el.isProposed ? "red" : "black"} 
            strokeWidth={2} 
            fill="white"
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' || tool === 'consumer' ? 'visiblePainted' : 'none' }}
          />
        )}
        {el.symbolId === 'mv-pole' && (
          <circle 
            cx={0} cy={0} r={radius} 
            fill={el.isProposed ? "red" : "black"}
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' || tool === 'consumer' ? 'visiblePainted' : 'none' }}
          />
        )}
        {el.symbolId === 'transformer' && (
          <g
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' || tool === 'consumer' ? 'visiblePainted' : 'none' }}
          >
            {/* Top Circle */}
            <circle cx={0} cy={-radius * 0.8} r={radius} stroke={el.isProposed ? "red" : "black"} strokeWidth={2} fill="none" />
            {/* Bottom Circle */}
            <circle cx={0} cy={radius * 0.8} r={radius} stroke={el.isProposed ? "red" : "black"} strokeWidth={2} fill="none" />
            {/* Rectangle to the right */}
            <rect 
              x={radius * 1.2} 
              y={-radius * 1.8} 
              width={radius * 1.0} 
              height={radius * 3.6} 
              stroke={el.isProposed ? "red" : "black"} 
              strokeWidth={2} 
              fill="white" 
            />
          </g>
        )}
        {el.symbolId === 'lattice-iron-pole' && (
          <g
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' || tool === 'consumer' ? 'visiblePainted' : 'none' }}
          >
            <rect 
              x={-radius} 
              y={-radius} 
              width={radius * 2} 
              height={radius * 2} 
              stroke={el.isProposed ? "red" : "black"} 
              strokeWidth={2} 
              fill="white" 
            />
            <line 
              x1={-radius} y1={-radius} 
              x2={radius} y2={radius} 
              stroke={el.isProposed ? "red" : "black"} 
              strokeWidth={2} 
            />
            <line 
              x1={radius} y1={-radius} 
              x2={-radius} y2={radius} 
              stroke={el.isProposed ? "red" : "black"} 
              strokeWidth={2} 
            />
          </g>
        )}
        {el.symbolId === 'distribution-box' && (
          <g
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' || tool === 'consumer' ? 'visiblePainted' : 'none' }}
          >
            {/* Rectangle 3:1 aspect ratio */}
            <rect 
              x={-radius * 1.5} 
              y={-radius * 0.5} 
              width={radius * 3} 
              height={radius * 1} 
              stroke={el.isProposed ? "red" : "#2563eb"} 
              strokeWidth={2} 
              fill="white" 
            />
          </g>
        )}
        {el.symbolId === 'small-dot-pole' && (
          <g
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' || tool === 'consumer' ? 'visiblePainted' : 'none' }}
          >
            {/* Invisible touch area - full pole radius */}
            <circle 
              cx={0} cy={0} r={radius} 
              fill="transparent"
            />
            {/* Small dot in center */}
            <circle 
              cx={0} cy={0} r={radius * 0.2}
              fill={el.isProposed ? "red" : "black"}
            />
          </g>
        )}
        
        <ColumnModifiers 
           element={el} 
           poleSizeScale={poleSizeScale} 
           onNoteMouseDown={handleNoteMouseDown}
        />
        
        {isSelected && (
          <>
            <rect
              x={el.symbolId === 'transformer' ? -radius - 4 : -radius - 4}
              y={el.symbolId === 'transformer' ? -radius * 1.8 - 4 : -radius - 4}
              width={el.symbolId === 'transformer' ? (radius * 3.2) + 8 : (radius * 2) + 8}
              height={el.symbolId === 'transformer' ? (radius * 3.6) + 8 : (radius * 2) + 8}
              fill="none"
              stroke="#3B82F6"
              strokeWidth={1}
              strokeDasharray="4 4"
              className="pointer-events-none"
            />
            {/* Rotation Handle */}
            <line
              x1={0}
              y1={el.symbolId === 'transformer' ? -radius * 1.8 - 4 : -radius - 4}
              x2={0}
              y2={el.symbolId === 'transformer' ? -radius * 1.8 - 24 : -radius - 24}
              stroke="#3B82F6"
              strokeWidth={1}
            />
            <circle
              cx={0}
              cy={el.symbolId === 'transformer' ? -radius * 1.8 - 24 : -radius - 24}
              r={6}
              fill="#3B82F6"
              className="cursor-pointer"
              onPointerDown={(e) => handleRotationPointerDown(e, el)}
            />
          </>
        )}
        
      </g>
    );
  };



  const getTransformerIntersection = (pole: SymbolElement, externalPoint: Point): Point => {
    const radius = POLE_RADIUS * poleSizeScale;
    
    // Transform externalPoint to local coordinates
    const dx = externalPoint.x - pole.x;
    const dy = externalPoint.y - pole.y;
    const angleRad = -(pole.rotation || 0) * Math.PI / 180;
    const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
    const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
    
    // Box definition (Local Coords)
    const minX = radius * 1.2;
    const maxX = radius * 2.2;
    const minY = -radius * 1.8;
    const maxY = radius * 1.8;
    
    // Target center of box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Ray from externalPoint (localX, localY) to Center (centerX, centerY)
    const dirX = centerX - localX;
    const dirY = centerY - localY;
    
    let tMin = Infinity;
    
    // Check intersections with 4 lines
    // x = minX
    if (dirX !== 0) {
        const t = (minX - localX) / dirX;
        const y = localY + t * dirY;
        if (t >= 0 && t <= 1 && y >= minY && y <= maxY) tMin = Math.min(tMin, t);
    }
    // x = maxX
    if (dirX !== 0) {
        const t = (maxX - localX) / dirX;
        const y = localY + t * dirY;
        if (t >= 0 && t <= 1 && y >= minY && y <= maxY) tMin = Math.min(tMin, t);
    }
    // y = minY
    if (dirY !== 0) {
        const t = (minY - localY) / dirY;
        const x = localX + t * dirX;
        if (t >= 0 && t <= 1 && x >= minX && x <= maxX) tMin = Math.min(tMin, t);
    }
    // y = maxY
    if (dirY !== 0) {
        const t = (maxY - localY) / dirY;
        const x = localX + t * dirX;
        if (t >= 0 && t <= 1 && x >= minX && x <= maxX) tMin = Math.min(tMin, t);
    }
    
    if (tMin === Infinity) tMin = 0; // Fallback
    
    const intX = localX + tMin * dirX;
    const intY = localY + tMin * dirY;
    
    // Transform back to world
    const rotRad = (pole.rotation || 0) * Math.PI / 180;
    const worldX = pole.x + intX * Math.cos(rotRad) - intY * Math.sin(rotRad);
    const worldY = pole.y + intX * Math.sin(rotRad) + intY * Math.cos(rotRad);
    
    return { x: worldX, y: worldY };
  };

  const renderCable = (el: CableElement, isSelected: boolean) => {
    const points = calculateCablePath(el, elements);
    if (points.length < 2) return null;

    // Cable is now directly from edge to edge (handled in cableLayout)
    const finalPoints = points;
    
    const d = el.lineStyle === 'straight' 
      ? finalPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      : createZigzagPath(finalPoints, 2, 10);
    
    // Arrow Logic
    let arrowPath = null;
    if (el.arrowMode && el.arrowMode !== 'none') {
      const isStart = el.arrowMode === 'start';
      const poleId = isStart ? el.poleIds[0] : el.poleIds[el.poleIds.length - 1];
      const pole = elements.find(e => e.id === poleId);
      
      if (pole) {
        const radius = POLE_RADIUS * poleSizeScale;
        let arrowPos: Point | null = null;
        let angle = 0;
        
        // Trace outward from the pole center along the cable path to find intersection with pole boundary
        const tracePoints = isStart ? finalPoints : [...finalPoints].reverse();
        
        for (let i = 0; i < tracePoints.length - 1; i++) {
           const p1 = tracePoints[i]; // Inner point
           const p2 = tracePoints[i+1]; // Outer point
           
           const intersection = getCircleSegmentIntersection(p1, p2, {x: pole.x, y: pole.y}, radius);
           if (intersection) {
             arrowPos = intersection;
             const dx = p2.x - p1.x;
             const dy = p2.y - p1.y;
             // Vector p1->p2 is Outward. Arrow points Inward (Towards Pole).
             angle = Math.atan2(dy, dx) * 180 / Math.PI + 180;
             break;
           }
        }
        
        if (arrowPos) {
          const arrowSize = 8 / transform.scale;
          
          arrowPath = (
            <path
              d={`M ${-arrowSize} ${-arrowSize/2} L 0 0 L ${-arrowSize} ${arrowSize/2} Z`}
              stroke={el.strokeColor}
              strokeWidth={el.strokeWidth}
              fill={el.strokeColor}
              strokeLinecap="round"
              strokeLinejoin="round"
              transform={`translate(${arrowPos.x}, ${arrowPos.y}) rotate(${angle})`}
              style={{ pointerEvents: 'none' }}
            />
          );
        }
      }
    }

    const segmentSpans = pathSegmentSpans(el, elements, finalPoints);
    const segments = [];
    for (let i = 0; i < finalPoints.length - 1; i++) {
      const p1 = finalPoints[i];
      const p2 = finalPoints[i+1];
      
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      let angle = Math.atan2(dy, dx) * 180 / Math.PI;
      
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      
      segments.push(
        <g key={`seg-${i}`}>
          <line
            x1={p1.x} y1={p1.y}
            x2={p2.x} y2={p2.y}
            stroke="transparent"
            strokeWidth={20}
            className={tool === 'select' || tool === 'cable' || tool === 'cable_straight' ? 'cursor-pointer' : ''}
            onPointerDown={(e) => handleSegmentClick(e, el.id, segmentSpans[i]?.key ?? null)}
            style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' ? 'stroke' : 'none' }}
          />
        </g>
      );
    }

    return (
      <g key={el.id}>
        <path
          d={d}
          stroke={el.strokeColor}
          strokeWidth={el.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={el.cableType === 'ground' ? "8 8" : undefined}
          className={tool === 'select' ? 'cursor-move' : ''}
          onPointerDown={(e) => handleElementPointerDown(e, el.id)}
          style={{ pointerEvents: tool === 'select' ? 'visibleStroke' : 'none' }}
        />
        {isSelected && (
          <path
            d={d}
            stroke="#3B82F6"
            strokeWidth={1}
            fill="none"
            strokeDasharray="4 4"
            className="pointer-events-none"
          />
        )}
        {arrowPath}
        {segments}
      </g>
    );
  };

  const getSmartPlacement = (poleId: string) => {
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

  const renderConsumer = (el: ConsumerElement) => {
    const pole = elements.find(e => e.id === el.poleId);
    if (!pole) return null;
    
    let cx, cy;
    
    if (el.hasManualPosition) {
      cx = el.x;
      cy = el.y;
    } else {
      const consumersOnPole = elements.filter(e => e.type === 'consumer' && (e as ConsumerElement).poleId === el.poleId);
      const index = consumersOnPole.findIndex(e => e.id === el.id);
      
      const placement = getSmartPlacement(el.poleId);
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
    
    const isSelected = el.id === selectedId;
    const consumerRadius = 16 * consumerSizeScale;
    const hitAreaRadius = 26 * consumerSizeScale; // Larger touch target
    const hitAreaSize = hitAreaRadius * 2;
    
    return (
      <g key={el.id} transform={`translate(${cx}, ${cy})`}>
        {/* Hit Area - Transparent but captures events */}
        {el.variant === 'square' ? (
          <rect 
            x={-hitAreaRadius} y={-hitAreaRadius} width={hitAreaSize} height={hitAreaSize}
            fill="transparent" 
            stroke="none"
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' ? 'all' : 'none' }}
          />
        ) : (
          <circle 
            cx={0} cy={0} r={hitAreaRadius} 
            fill="transparent" 
            stroke="none"
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' ? 'all' : 'none' }}
          />
        )}

        {/* Visible Shape */}
        {el.variant === 'square' ? (
          <rect 
            x={-consumerRadius} y={-consumerRadius} width={consumerRadius * 2} height={consumerRadius * 2}
            fill="none" 
            stroke={isSelected ? "#3B82F6" : el.color}
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
        ) : (
          <circle 
            cx={0} cy={0} r={consumerRadius} 
            fill="none" 
            stroke={isSelected ? "#3B82F6" : el.color}
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
        )}
        <text x={0} y={0} dy=".3em" textAnchor="middle" fill={isSelected ? "#3B82F6" : el.color} fontSize={12 * consumerSizeScale} fontWeight="bold" style={{ pointerEvents: 'none' }}>
          {el.count}
        </text>
        {el.label && (
          <text 
            x={el.variant === 'square' ? 0 : consumerRadius} 
            y={el.variant === 'square' ? -(consumerRadius + 10) : 0} 
            dy=".3em" 
            textAnchor={el.variant === 'square' ? "middle" : "start"} 
            fill={el.color} 
            fontSize={14 * consumerSizeScale} 
            fontWeight="bold" 
            style={{ pointerEvents: 'none' }}
          >
            {el.label}
          </text>
        )}
      </g>
    );
  };

  const renderConnectionLabels = () => {
    const connections = new Map<string, {
      p1: Point, p2: Point, 
      maxOffset: number
    }>();

    elements.forEach(el => {
      if (el.type === 'cable') {
        const cable = el as CableElement;
        for (let i = 0; i < cable.poleIds.length - 1; i++) {
          const id1 = cable.poleIds[i];
          const id2 = cable.poleIds[i+1];
          const key = [id1, id2].sort().join('_');
          
          if (!connections.has(key)) {
            const p1El = elements.find(e => e.id === id1);
            const p2El = elements.find(e => e.id === id2);
            if (p1El && p2El) {
              // Ensure p1 is the "start" based on ID sort for consistent direction
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
            // cable.offset is relative to the cable's direction.
            // If cable is A->B (sorted), offset is +Right.
            // If cable is B->A (reverse), offset is +Right relative to B->A, which is Left relative to A->B.
            // So if id1 > id2, we need to negate offset?
            // cableLayout.ts: "Right side is positive offset".
            // If we normalize direction A->B.
            // If cable is A->B, offset is correct.
            // If cable is B->A, offset is relative to B->A.
            // Right of B->A is Left of A->B.
            // So yes, if id1 > id2, effective offset relative to A->B is -offset.
            const effectiveOffset = (id1 < id2) ? (cable.offset || 0) : -(cable.offset || 0);
            conn.maxOffset = Math.max(conn.maxOffset, effectiveOffset);
          }
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
      
      // Normalize angle for text readability
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;

      // Calculate perpendicular offset
      // Normal vector to A->B (Right side): (-dy, dx) normalized
      const len = Math.sqrt(dx*dx + dy*dy);
      const nx = -dy / len;
      const ny = dx / len;
      
      // Base offset (e.g. 15) + max cable offset + padding
      // If maxOffset is negative (all cables on left), we still want label on right?
      // "Always place the distance label on ONE consistent side".
      // So we start from 0 or maxOffset.
      // If maxOffset < 0, it means all cables are on left.
      // So we can place label at base_offset.
      // If maxOffset > 0, we place at maxOffset + base_offset.
      const baseOffset = 15 * distanceTextScale;
      const labelOffset = Math.max(0, maxOffset) + baseOffset;
      const storedOffset = connectionLabelOffsets[key] || { x: 0, y: 0 };
      
      const lx = mx + nx * labelOffset + storedOffset.x;
      const ly = my + ny * labelOffset + storedOffset.y;
      
      const distance = connectionDistances[key] ?? "1";

      return (
        <g 
          key={key} 
          transform={`translate(${lx}, ${ly}) rotate(${angle})`}
          className={tool === 'select' || tool === 'cable' || tool === 'cable_straight' ? 'cursor-move' : ''}
          onPointerDown={(e) => handleLabelPointerDown(e, key)}
          style={{ pointerEvents: tool === 'select' || tool === 'cable' || tool === 'cable_straight' ? 'visiblePainted' : 'none' }}
        >
          <text
            x={0} y={0}
            dy=".3em"
            textAnchor="middle"
            fontSize={10 * distanceTextScale}
            fill="red"
            fontWeight="bold"
            stroke="white"
            strokeWidth={3}
            paintOrder="stroke"
            style={{ userSelect: 'none' }}
          >
            {distance}
          </text>
        </g>
      );
    });
  };

  const renderCableArc = (el: CableArcElement, isSelected: boolean) => {
    const g = arcGeometry(elements, el, arcRadius);
    if (!g) return null;
    return (
      <g key={el.id}>
        <path d={g.d} stroke={el.strokeColor} strokeWidth={el.strokeWidth} fill="none" strokeLinecap="round" style={{ pointerEvents: 'none' }} />
        <path
          d={g.d}
          stroke="transparent"
          strokeWidth={14}
          fill="none"
          data-cable-arc={el.id}
          className={tool === 'select' ? 'cursor-pointer' : ''}
          onPointerDown={(e) => { if (tool !== 'select' || arcPickState) return; e.stopPropagation(); setSelectedId(el.id); }}
          style={{ pointerEvents: tool === 'select' && !arcPickState ? 'stroke' : 'none' }}
        />
        {isSelected && <path d={g.d} stroke="#3B82F6" strokeWidth={1} strokeDasharray="4 4" fill="none" className="pointer-events-none" />}
      </g>
    );
  };

  // Numbered connection points of the pole being linked (arc tool).
  const renderArcPicker = () => {
    if (!arcPickState) return null;
    const pole = elements.find(e => e.id === arcPickState.poleId);
    if (!pole) return null;
    const k = 1 / transform.scale;
    const r = 11 * k;
    const ring = arcRadius + 22 * k;
    // badges sit on a ring around the pole, spread so they never overlap
    const minGap = (2 * r + 4 * k) / ring;
    const angles = arcPoints.map(p => p.angle);
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i < angles.length; i++) if (angles[i] - angles[i - 1] < minGap) angles[i] = angles[i - 1] + minGap;
    }
    return (
      <g data-arc-picker={arcPickState.poleId}>
        {arcPoints.map((p, i) => {
          const bx = pole.x + Math.sin(angles[i]) * ring;
          const by = pole.y - Math.cos(angles[i]) * ring;
          const isFirst = !!arcPickState.first && sameEnd(arcPickState.first, p.end);
          return (
            <g key={`${p.end.cableId}:${p.end.side}:${p.end.occurrence}`}>
              <line x1={p.position.x} y1={p.position.y} x2={bx} y2={by} stroke={p.color} strokeWidth={1.5 * k} className="pointer-events-none" />
              <circle cx={p.position.x} cy={p.position.y} r={3.5 * k} fill={p.color} className="pointer-events-none" />
              <g
                role="button"
                aria-label={`نقطة اتصال ${p.number}`}
                aria-pressed={isFirst}
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); dispatchArcPick({ type: 'pick', end: p.end }); }}
              >
                <circle cx={bx} cy={by} r={r * (isFirst ? 1.2 : 1)} fill={isFirst ? p.color : '#FFFFFF'} stroke={p.color} strokeWidth={2 * k} />
                <text x={bx} y={by} dy="0.35em" textAnchor="middle" fontSize={12 * k} fontWeight={700} fill={isFirst ? '#FFFFFF' : '#1C1C1E'} className="pointer-events-none select-none">{p.number}</text>
              </g>
            </g>
          );
        })}
      </g>
    );
  };

  const renderArc = (el: ArcElement, isSelected: boolean) => {
    const path = generateHighQualityArcPath(el.x, el.y, el.controlX, el.controlY, el.x2, el.y2);
    
    return (
      <g key={el.id}>
        <path
          d={path}
          stroke={el.strokeColor}
          strokeWidth={el.strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          shapeRendering="geometricPrecision"
          className={tool === 'select' ? 'cursor-move' : ''}
          onPointerDown={(e) => handleElementPointerDown(e, el.id)}
          style={{ pointerEvents: tool === 'select' ? 'visibleStroke' : 'none' }}
        />
        {/* Thicker ends */}
        <circle cx={el.x} cy={el.y} r={el.strokeWidth * 1.5} fill={el.strokeColor} />
        <circle cx={el.x2} cy={el.y2} r={el.strokeWidth * 1.5} fill={el.strokeColor} />
        
        {isSelected && (
          <g>
            {/* Control Point Handle */}
            <line x1={el.x} y1={el.y} x2={el.controlX} y2={el.controlY} stroke="#999" strokeDasharray="4 4" />
            <line x1={el.x2} y1={el.y2} x2={el.controlX} y2={el.controlY} stroke="#999" strokeDasharray="4 4" />
            
            <circle 
              cx={el.controlX} cy={el.controlY} r={6} 
              fill="white" stroke="#2196F3" strokeWidth={2}
              className="cursor-move"
              onPointerDown={(e) => handleArcPointPointerDown(e, el.id, 'control')}
            />
            <circle 
              cx={el.x} cy={el.y} r={6} 
              fill="white" stroke="#2196F3" strokeWidth={2}
              className="cursor-move"
              onPointerDown={(e) => handleArcPointPointerDown(e, el.id, 'start')}
            />
            <circle 
              cx={el.x2} cy={el.y2} r={6} 
              fill="white" stroke="#2196F3" strokeWidth={2}
              className="cursor-move"
              onPointerDown={(e) => handleArcPointPointerDown(e, el.id, 'end')}
            />
          </g>
        )}
      </g>
    );
  };

  const renderShape = (el: ShapeElement, isSelected: boolean) => {
    const { x, y, width, height, shapeType, strokeColor, fillColor, strokeWidth, rotation = 0, scaleX = 1, scaleY = 1 } = el;
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
          const compassRadius = Math.min(halfW, halfH);
          const r = compassRadius;
          return (
            <g>
              {/* Outer circle */}
              <circle cx={0} cy={0} r={r} stroke={strokeColor} fill={fillColor} strokeWidth={strokeWidth} />
              {/* Inner circle */}
              <circle cx={0} cy={0} r={r * 0.92} stroke={strokeColor} fill="none" strokeWidth={strokeWidth * 0.5} />
              
              {/* 8-pointed compass rose */}
              {/* North pointer - Red (main) */}
              <polygon
                points={`0,${-r * 0.85} ${r * 0.08},${-r * 0.15} 0,${-r * 0.25} -${r * 0.08},${-r * 0.15}`}
                fill="#c41e3a"
                stroke="#c41e3a"
                strokeWidth={1}
              />
              {/* South pointer - Gray */}
              <polygon
                points={`0,${r * 0.85} ${r * 0.08},${r * 0.15} 0,${r * 0.25} -${r * 0.08},${r * 0.15}`}
                fill="#666"
                stroke="#666"
                strokeWidth={1}
              />
              {/* East pointer - Gray */}
              <polygon
                points={`${r * 0.7},0 ${r * 0.12},-${r * 0.12} ${r * 0.2},0 ${r * 0.12},${r * 0.12}`}
                fill="#666"
                stroke="#666"
                strokeWidth={1}
              />
              {/* West pointer - Gray */}
              <polygon
                points={`-${r * 0.7},0 -${r * 0.12},-${r * 0.12} -${r * 0.2},0 -${r * 0.12},${r * 0.12}`}
                fill="#666"
                stroke="#666"
                strokeWidth={1}
              />
              
              {/* Diagonal pointers (lighter) */}
              <polygon points={`${r * 0.45},${-r * 0.45} ${r * 0.08},-${r * 0.08} ${r * 0.12},0 0,-${r * 0.02}`} fill="#999" />
              <polygon points={`-${r * 0.45},${-r * 0.45} -${r * 0.08},-${r * 0.08} -${r * 0.12},0 0,-${r * 0.02}`} fill="#999" />
              <polygon points={`${r * 0.45},${r * 0.45} ${r * 0.08},${r * 0.08} ${r * 0.12},0 0,${r * 0.02}`} fill="#ccc" />
              <polygon points={`-${r * 0.45},${r * 0.45} -${r * 0.08},${r * 0.08} -${r * 0.12},0 0,${r * 0.02}`} fill="#ccc" />
              
              {/* Center circle */}
              <circle cx={0} cy={0} r={r * 0.1} fill={strokeColor} />
              <circle cx={0} cy={0} r={r * 0.05} fill="white" />
              
              {/* N label only - Black color */}
              <text x={0} y={-r * 0.55} textAnchor="middle" dominantBaseline="middle" fontSize={r * 0.22} fontWeight="bold" fill="#000" style={{ userSelect: 'none' }}>N</text>
            </g>
          );
        case 'curved_arrow':
          const curveLen = Math.max(width, height);
          const curveHeadSize = Math.min(12, curveLen * 0.2);
          const curveIntensity = el.curveIntensity || 0.5;
          return (
            <g>
              <path
                d={`M 0,${curveLen * 0.5} Q ${curveLen * curveIntensity},${-curveLen * 0.3} ${curveLen * 0.8},${-curveLen * 0.4}`}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
              />
              <polygon
                points={`${curveLen * 0.8},${-curveLen * 0.4} ${curveLen * 0.7},${-curveLen * 0.35} ${curveLen * 0.75},${-curveLen * 0.5}`}
                fill={strokeColor}
                transform={`rotate(${-Math.atan2(curveLen * 0.1, curveLen * 0.1) * 180 / Math.PI}, ${curveLen * 0.8}, ${-curveLen * 0.4})`}
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
        className={tool === 'select' ? 'cursor-move' : ''}
        onPointerDown={(e) => handleElementPointerDown(e, el.id)}
        style={{ pointerEvents: tool === 'select' ? 'all' : 'none' }}
      >
        {getShapeContent()}
        
        {isSelected && (
          <g>
            {/* Selection outline */}
            <rect
              x={-halfW - 4}
              y={-halfH - 4}
              width={width + 8}
              height={height + 8}
              fill="none"
              stroke="#2196F3"
              strokeWidth={1}
              strokeDasharray="4 2"
              rx={4}
            />
            {/* Resize handles - larger for better touch interaction */}
            {[
              { cx: -halfW, cy: -halfH, cursor: 'nw-resize', handle: 'nw' as const },
              { cx: halfW, cy: -halfH, cursor: 'ne-resize', handle: 'ne' as const },
              { cx: halfW, cy: halfH, cursor: 'se-resize', handle: 'se' as const },
              { cx: -halfW, cy: halfH, cursor: 'sw-resize', handle: 'sw' as const },
            ].map((h, i) => (
              <g key={i}>
                {/* Invisible larger touch area */}
                <circle
                  cx={h.cx}
                  cy={h.cy}
                  r={16}
                  fill="transparent"
                  style={{ cursor: h.cursor }}
                  onPointerDown={(e) => handleResizePointerDown(e, el, h.handle)}
                />
                {/* Visible handle */}
                <circle
                  cx={h.cx}
                  cy={h.cy}
                  r={8}
                  fill="white"
                  stroke="#2196F3"
                  strokeWidth={2.5}
                  style={{ cursor: h.cursor, pointerEvents: 'none' }}
                />
              </g>
            ))}
            {/* Rotation handle */}
            <line
              x1={0}
              y1={-halfH}
              x2={0}
              y2={-halfH - 25}
              stroke="#2196F3"
              strokeWidth={2}
            />
            <g style={{ cursor: 'grab' }}>
              {/* Invisible larger touch area */}
              <circle
                cx={0}
                cy={-halfH - 25}
                r={18}
                fill="transparent"
                onPointerDown={(e) => handleRotationPointerDown(e, el)}
              />
              {/* Visible handle */}
              <circle
                cx={0}
                cy={-halfH - 25}
                r={8}
                fill="#2196F3"
                stroke="white"
                strokeWidth={2}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          </g>
        )}
      </g>
    );
  };

  const renderTransformerTable = (el: any, isSelected: boolean) => {
    const { x, y, transformerInfo, scale = 1 } = el;
    const boxCount = parseInt(transformerInfo.distributionBoxesCount) || 1;
    const hasPerBox = boxCount > 1 && transformerInfo.perBoxCircuits && transformerInfo.perBoxCircuits.length > 0;
    
    // Calculate dynamic height based on number of boxes
    const baseRows = 8; // Base info rows
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
      rows.push({ label: 'الدوائر لكل صندوق', value: '' }); // Header row (will be filled by per-box)
      transformerInfo.perBoxCircuits!.forEach((box, i) => {
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

    const handleZoomIn = (e: React.PointerEvent) => {
      e.stopPropagation();
      const newScale = Math.min((el.scale || 1) + 0.1, 2);
      updateElement(el.id, { scale: newScale });
    };

    const handleZoomOut = (e: React.PointerEvent) => {
      e.stopPropagation();
      const newScale = Math.max((el.scale || 1) - 0.1, 0.5);
      updateElement(el.id, { scale: newScale });
    };

    return (
      <g
        key={el.id}
        transform={`translate(${x}, ${y})`}
        className={tool === 'select' ? 'cursor-move' : ''}
        onPointerDown={(e) => handleElementPointerDown(e, el.id)}
        style={{ pointerEvents: tool === 'select' ? 'all' : 'none' }}
      >
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
          fill="url(#headerGradient)"
          rx={7 * scale}
        />
        <defs>
          <linearGradient id="headerGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1d4ed8" />
            <stop offset="50%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
        </defs>
        
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

        {/* Zoom controls - only show when selected */}
        {isSelected && (
          <g transform={`translate(${tableWidth - 5 * scale}, 5 * scale)`}>
            {/* Zoom out */}
            <g 
              onPointerDown={handleZoomOut}
              className="cursor-pointer"
            >
              <circle r={14 * scale} fill="#ffffff" stroke="#1e40af" strokeWidth={1.5 * scale} />
              <text x={0} y={5 * scale} textAnchor="middle" fontSize={14 * scale} fontWeight="bold" fill="#1e40af">−</text>
            </g>
            {/* Zoom in */}
            <g 
              onPointerDown={handleZoomIn}
              className="cursor-pointer"
              transform={`translate(${28 * scale}, 0)`}
            >
              <circle r={14 * scale} fill="#ffffff" stroke="#1e40af" strokeWidth={1.5 * scale} />
              <text x={0} y={5 * scale} textAnchor="middle" fontSize={14 * scale} fontWeight="bold" fill="#1e40af">+</text>
            </g>
          </g>
        )}

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
        
        {/* Selection highlight */}
        {isSelected && (
          <rect
            x={-2 * scale}
            y={-2 * scale}
            width={tableWidth + 4 * scale}
            height={tableHeight + 4 * scale}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={2 * scale}
            strokeDasharray={`${4 * scale} ${2 * scale}`}
            rx={10 * scale}
          />
        )}
      </g>
    );
  };

  const renderElement = (el: DrawingElement) => {
    const isSelected = el.id === selectedId;
    if (el.type === 'path') {
      const pathEl = el as PathElement;
      const d = pathEl.points.map((p, i) => 
        `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
      ).join(' ');

      return (
        <g key={el.id} transform={`translate(${el.x}, ${el.y})`}>
          <path
            d={d}
            stroke={el.strokeColor}
            strokeWidth={el.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={tool === 'select' ? 'cursor-move' : ''}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' ? 'visibleStroke' : 'none' }}
          />
          {isSelected && (
            <path
              d={d}
              stroke="#3B82F6"
              strokeWidth={1}
              fill="none"
              strokeDasharray="4 4"
              className="pointer-events-none"
            />
          )}
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
            className={`select-none ${tool === 'select' ? 'cursor-move' : ''}`}
            onPointerDown={(e) => handleElementPointerDown(e, el.id)}
            style={{ pointerEvents: tool === 'select' ? 'visiblePainted' : 'none' }}
          >
            {textEl.text}
          </text>
          {isSelected && (
            <rect
              x={-4}
              y={-el.fontSize}
              width={(textEl.text.length * el.fontSize * 0.6) + 8} 
              height={el.fontSize + 8}
              fill="none"
              stroke="#3B82F6"
              strokeWidth={1}
              strokeDasharray="4 4"
              className="pointer-events-none"
            />
          )}
        </g>
      );
    } else if (el.type === 'symbol') {
      return renderSymbol(el as SymbolElement, isSelected);
    } else if (el.type === 'cable') {
      return renderCable(el as CableElement, isSelected);
    } else if (el.type === 'consumer') {
      return renderConsumer(el as ConsumerElement);
    } else if (el.type === 'arc') {
      return renderArc(el as ArcElement, isSelected);
    } else if (el.type === 'cable_arc') {
      return renderCableArc(el as CableArcElement, isSelected);
    } else if (el.type === 'shape') {
      return renderShape(el as ShapeElement, isSelected);
    } else if (el.type === 'transformer_table') {
      return renderTransformerTable(el as any, isSelected);
    }
    return null;
  };

  return (
    <div className="flex-1 w-full h-full bg-white overflow-hidden touch-none">
      <svg
        ref={svgRef}
        className="w-full h-full block"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Render cables first (bottom layer) */}
          {elements.filter(el => el.type === 'cable').map(el => renderElement(el))}
          
          {/* Render other elements (top layer) */}
          {elements.filter(el => el.type !== 'cable').map(el => renderElement(el))}

          {showDistanceLabels && renderConnectionLabels()}

          {renderArcPicker()}

          {/* Pending Consumer UI */}
          {pendingConsumer && (
            <g transform={(() => {
               const placement = getSmartPlacement(pendingConsumer.poleId);
               const consumersOnPole = elements.filter(e => e.type === 'consumer' && (e as ConsumerElement).poleId === pendingConsumer.poleId);
               const index = consumersOnPole.length;
               const radius = POLE_RADIUS * poleSizeScale;
               const consumerRadius = 16 * consumerSizeScale;
               const margin = 5 * consumerSizeScale;
               const spacing = consumerRadius * 2 + margin;
               const startOffset = radius + consumerRadius + margin;
               const stackOffset = index * spacing;
               const totalOffset = startOffset + stackOffset;
               const cx = placement.x + placement.dx * totalOffset;
               const cy = placement.y + placement.dy * totalOffset;
               return `translate(${cx}, ${cy})`;
            })()}>
              {pendingConsumer.step === 'color-select' && (
                <g>
                  {pendingConsumer.availableColors.map((c, i) => (
                    <circle 
                      key={c} 
                      cx={i * 25} 
                      cy={0} 
                      r={10} 
                      fill={c} 
                      stroke="white" 
                      strokeWidth={2}
                      className="cursor-pointer"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setPendingConsumer({...pendingConsumer, selectedColor: c, step: 'count-adjust'});
                      }}
                    />
                  ))}
                </g>
              )}
              {pendingConsumer.step === 'count-adjust' && (
                <g>
                  {/* Minus Button */}
                  <circle 
                    cx={0} cy={0} r={22} 
                    fill="white" stroke="#ccc" strokeWidth={2}
                    className="cursor-pointer"
                    onPointerDown={(e) => { 
                      e.stopPropagation(); 
                      if (pendingConsumer.count > 1) {
                        setPendingConsumer({...pendingConsumer, count: pendingConsumer.count - 1}); 
                      }
                    }} 
                  />
                  <text x={0} y={0} dy=".3em" textAnchor="middle" fontSize="24" fontWeight="bold" fill="#666" className="pointer-events-none select-none">-</text>
                  
                  {/* Count */}
                  <text x={50} y={0} dy=".3em" textAnchor="middle" fontSize="20" fontWeight="bold" fill="#333" className="select-none">{pendingConsumer.count}</text>
                  
                  {/* Plus Button */}
                  <circle 
                    cx={100} cy={0} r={22} 
                    fill="white" stroke="#ccc" strokeWidth={2}
                    className="cursor-pointer"
                    onPointerDown={(e) => { 
                      e.stopPropagation(); 
                      setPendingConsumer({...pendingConsumer, count: pendingConsumer.count + 1}); 
                    }} 
                  />
                  <text x={100} y={0} dy=".3em" textAnchor="middle" fontSize="24" fontWeight="bold" fill="#666" className="pointer-events-none select-none">+</text>
                </g>
              )}
            </g>
          )}

          {/* Pending Shape */}
          {pendingShape && pendingShape.width > 0 && pendingShape.height > 0 && (
            <g opacity={0.7}>
              {(() => {
                const { x, y, width, height, shapeType, strokeColor, fillColor, strokeWidth } = pendingShape;
                const halfW = width / 2;
                const halfH = height / 2;
                const centerX = x + halfW;
                const centerY = y + halfH;
                
                switch (shapeType) {
                  case 'rectangle':
                    return (
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={height}
                        stroke={strokeColor}
                        fill={fillColor}
                        strokeWidth={strokeWidth}
                        rx={2}
                        ry={2}
                        strokeDasharray="4 2"
                      />
                    );
                  case 'circle':
                    return (
                      <circle
                        cx={centerX}
                        cy={centerY}
                        r={Math.min(halfW, halfH)}
                        stroke={strokeColor}
                        fill={fillColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray="4 2"
                      />
                    );
                  case 'triangle':
                    return (
                      <polygon
                        points={`${centerX},${y} ${x + width},${y + height} ${x},${y + height}`}
                        stroke={strokeColor}
                        fill={fillColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray="4 2"
                      />
                    );
                  case 'arrow':
                    const arrowLen = Math.max(width, height);
                    const arrowHead = Math.min(15, arrowLen * 0.3);
                    return (
                      <g transform={`translate(${x}, ${y}) rotate(${pendingShape.rotation || 0})`}>
                        <line
                          x1={0}
                          y1={0}
                          x2={arrowLen}
                          y2={0}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeDasharray="4 2"
                        />
                        <polygon
                          points={`${arrowLen},0 ${arrowLen - arrowHead},-${arrowHead / 2} ${arrowLen - arrowHead},${arrowHead / 2}`}
                          fill={strokeColor}
                        />
                      </g>
                    );
                  case 'compass':
                    const r = Math.min(halfW, halfH);
                    return (
                      <g transform={`translate(${centerX}, ${centerY})`}>
                        <circle cx={0} cy={0} r={r} stroke={strokeColor} fill={fillColor} strokeWidth={strokeWidth} strokeDasharray="4 2" />
                        <circle cx={0} cy={0} r={r * 0.92} stroke={strokeColor} fill="none" strokeWidth={strokeWidth * 0.5} strokeDasharray="4 2" />
                        
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
                      <g transform={`translate(${x}, ${y})`}>
                        <path
                          d={`M 0,${curveLen * 0.5} Q ${curveLen * 0.5},${-curveLen * 0.3} ${curveLen * 0.8},${-curveLen * 0.4}`}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          fill="none"
                          strokeDasharray="4 2"
                        />
                      </g>
                    );
                  default:
                    return null;
                }
              })()}
            </g>
          )}
        </g>
      </svg>
      
      {/* Cable Selection Panel */}
      <div className={`absolute bottom-safe-bottom left-0 right-0 p-2 flex justify-center pointer-events-none ${elements.some(el => el.type === 'cable') ? '' : 'hidden'}`}>
        <div className="ui-float !rounded-full px-2 py-1.5 flex gap-2 pointer-events-auto overflow-x-auto no-scrollbar max-w-full">
          {elements.filter(el => el.type === 'cable').map((el) => (
            <button
              key={el.id}
              onClick={() => {
                setSelectedId(el.id);
                setActiveCableId(el.id);
              }}
              className={`ui-swatch m-0.5 flex items-center justify-center ${selectedId === el.id ? 'is-active' : ''}`}
              style={{ backgroundColor: el.strokeColor }}
              aria-label={`Select cable ${el.id}`}
            >
              {selectedId === el.id && <div className="w-2 h-2 bg-white rounded-full" />}
            </button>
          ))}
        </div>
      </div>
      {/* Context Menu */}
      {contextMenu.visible && contextMenu.elementId && (
        <ColumnContextMenu
          elementId={contextMenu.elementId}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu({ ...contextMenu, visible: false })}
          onStartArc={(poleId) => dispatchArcPick({ type: 'start', poleId })}
        />
      )}

      {arcPickState && (
        <div dir="rtl" role="toolbar" aria-label="أداة القوس" className="ui-float absolute left-1/2 bottom-16 z-40 flex max-w-[calc(100%-16px)] -translate-x-1/2 items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap px-3 py-2 text-[13px]">
          <span className="flex-shrink-0 font-semibold text-ios-label">قوس</span>
          <span className="flex-shrink-0 text-ios-secondary">
            {arcPickState.first
              ? `النقطة الثانية (الأولى: ${arcPoints.find(p => sameEnd(p.end, arcPickState.first!))?.number ?? '—'})`
              : 'اختر النقطة الأولى'}
          </span>
          <div className="flex flex-shrink-0 gap-1">
            {arcPoints.map(p => {
              const isFirst = !!arcPickState.first && sameEnd(arcPickState.first, p.end);
              return (
                <button
                  key={`${p.end.cableId}:${p.end.side}:${p.end.occurrence}`}
                  type="button"
                  aria-label={`اختيار النقطة ${p.number}`}
                  aria-pressed={isFirst}
                  onClick={() => dispatchArcPick({ type: 'pick', end: p.end })}
                  className={`flex h-8 min-w-8 items-center justify-center gap-1 rounded-full px-2 font-semibold ring-1 ring-inset ring-ios-separator ${isFirst ? 'text-white' : 'text-ios-label bg-white'}`}
                  style={isFirst ? { backgroundColor: p.color } : undefined}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.number}
                </button>
              );
            })}
          </div>
          <button type="button" aria-label="إنهاء القوس" onClick={() => dispatchArcPick({ type: 'cancel' })} className="ui-tinted-btn !w-auto !min-h-[32px] flex-shrink-0 !px-3">تم</button>
        </div>
      )}

      {editingDistance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingDistance(null)}>
          <div className="bg-white rounded-[14px] p-4 shadow-float w-72 max-w-[calc(100vw-32px)]" onClick={e => e.stopPropagation()}>
            <h3 className="text-[17px] font-semibold text-ios-label text-center mb-3">Edit Distance</h3>
            <input
              type="number"
              inputMode="decimal"
              className="ui-field w-full h-11 mb-4 text-[17px]"
              value={editingDistance.value}
              onChange={e => setEditingDistance({ ...editingDistance, value: e.target.value })}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  updateConnectionDistance(editingDistance.key, editingDistance.value || '1');
                  setEditingDistance(null);
                }
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="min-h-[44px] rounded-ctl bg-ios-fill text-[17px] text-ios-blue active:bg-ios-fill-strong"
                onClick={() => setEditingDistance(null)}
              >
                Cancel
              </button>
              <button
                className="min-h-[44px] rounded-ctl bg-ios-blue text-[17px] font-semibold text-white active:bg-ios-blue-pressed"
                onClick={() => {
                  updateConnectionDistance(editingDistance.key, editingDistance.value || '1');
                  setEditingDistance(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
