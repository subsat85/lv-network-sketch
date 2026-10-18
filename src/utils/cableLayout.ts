import { Point, CableElement, DrawingElement, SymbolElement } from '../types/drawing';

// Reduced spacing to ~3-4x the stroke width (assuming default width of 2px)
// User requested "approx 3 times the thickness". 
// If width is 2, 3x is 6. Spacing of 8 gives 6px gap + 2px line = 8px center-to-center? 
// Or 8px center-to-center means 6px gap.
const CABLE_SPACING = 8;
const POLE_RADIUS = 20;

// Helper function to get the nearest edge point of a transformer
const getTransformerEdgePoint = (transformer: SymbolElement, targetPoint: Point): Point => {
  const radius = POLE_RADIUS;
  const dx = targetPoint.x - transformer.x;
  const dy = targetPoint.y - transformer.y;
  const angleRad = -(transformer.rotation || 0) * Math.PI / 180;
  
  // Transform to local coordinates
  const localX = dx * Math.cos(angleRad) - dy * Math.sin(angleRad);
  const localY = dx * Math.sin(angleRad) + dy * Math.cos(angleRad);
  
  // Transformer rectangle bounds (local coordinates)
  const minX = radius * 1.2;
  const maxX = radius * 2.2;
  const minY = -radius * 1.8;
  const maxY = radius * 1.8;
  
  // Find the nearest point on the rectangle edge
  const nearestX = Math.max(minX, Math.min(localX, maxX));
  const nearestY = Math.max(minY, Math.min(localY, maxY));
  
  // Transform back to world coordinates
  const rotRad = (transformer.rotation || 0) * Math.PI / 180;
  const worldX = transformer.x + nearestX * Math.cos(rotRad) - nearestY * Math.sin(rotRad);
  const worldY = transformer.y + nearestX * Math.sin(rotRad) + nearestY * Math.cos(rotRad);
  
  return { x: worldX, y: worldY };
};

// Helper to check if element is a transformer
const isTransformer = (element: DrawingElement): boolean => {
  return element.type === 'symbol' && (element as SymbolElement).symbolId === 'transformer';
};

export const calculateCablePath = (cable: CableElement, elements: DrawingElement[]): Point[] => {
  if (cable.poleIds.length < 2) return [];
  
  // Get pole objects
  const poles = cable.poleIds.map(id => elements.find(e => e.id === id)).filter(e => e) as DrawingElement[];
  if (poles.length < 2) return [];

  const offsetLines: { p1: Point, p2: Point, v: Point }[] = [];
  
  // Pre-filter all cables once to avoid repeated filtering
  const allCables = elements.filter(e => e.type === 'cable') as CableElement[];

  // Calculate offset segment for each pole-to-pole connection
  for (let i = 0; i < poles.length - 1; i++) {
    const p1 = poles[i];
    const p2 = poles[i+1];
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    
    if (len < 1e-6) {
       offsetLines.push({ p1, p2, v: {x:0, y:0} }); 
       continue;
    }

    // --- Dynamic Centering Logic ---
    
    // 1. Identify the segment canonically (minId -> maxId)
    const id1 = p1.id;
    const id2 = p2.id;
    const isCanonical = id1 < id2;
    
    // 2. Find all cables on this segment
    const cablesOnSegment = allCables.filter(c => {
      // Check if this cable has id1 and id2 adjacent in its poleIds
      for (let j = 0; j < c.poleIds.length - 1; j++) {
        const cId1 = c.poleIds[j];
        const cId2 = c.poleIds[j+1];
        if ((cId1 === id1 && cId2 === id2) || (cId1 === id2 && cId2 === id1)) {
          return true;
        }
      }
      return false;
    });

    // 3. Sort cables by their effective offset in the canonical frame
    // Effective offset: if cable runs Canonical, use offset. If Reverse, use -offset.
    cablesOnSegment.sort((a, b) => {
      // Determine direction of a and b on this segment
      const getDir = (c: CableElement) => {
        for (let j = 0; j < c.poleIds.length - 1; j++) {
          if (c.poleIds[j] === id1 && c.poleIds[j+1] === id2) return 1; // Canonical
          if (c.poleIds[j] === id2 && c.poleIds[j+1] === id1) return -1; // Reverse
        }
        return 1;
      };
      
      const dirA = getDir(a);
      const dirB = getDir(b);
      
      const offA = (a.offset || 0) * dirA;
      const offB = (b.offset || 0) * dirB;
      
      if (Math.abs(offA - offB) > 1e-6) {
        return offA - offB;
      }
      // Secondary sort by ID for stability
      return a.id.localeCompare(b.id);
    });

    // 4. Find rank of current cable
    const rank = cablesOnSegment.findIndex(c => c.id === cable.id);
    const count = cablesOnSegment.length;
    
    // 5. Calculate centered offset
    // If count is 1, offset is 0.
    // If count is 2, offsets are -0.5*SPACING, +0.5*SPACING
    let assignedOffset = 0;
    if (rank !== -1) {
      assignedOffset = (rank - (count - 1) / 2) * CABLE_SPACING;
    }

    // 6. Convert back to current cable's frame
    const finalOffset = isCanonical ? assignedOffset : -assignedOffset;

    // --- End Dynamic Centering Logic ---
    
    // Normal vector (Right side is positive offset)
    const nx = -dy / len;
    const ny = dx / len;
    
    const ox = nx * finalOffset;
    const oy = ny * finalOffset;
    
    offsetLines.push({
      p1: { x: p1.x + ox, y: p1.y + oy },
      p2: { x: p2.x + ox, y: p2.y + oy },
      v: { x: dx, y: dy }
    });
  }

  const path: Point[] = [];
  
  // Check if first/last poles are transformers
  const firstPole = poles[0];
  const lastPole = poles[poles.length - 1];
  const isFirstTransformer = isTransformer(firstPole);
  const isLastTransformer = isTransformer(lastPole);
  
  // Calculate edge points for transformers
  const firstEdgePoint = isFirstTransformer && offsetLines.length > 0 
    ? getTransformerEdgePoint(firstPole as SymbolElement, offsetLines[0].p2)
    : null;
  const lastEdgePoint = isLastTransformer && offsetLines.length > 0
    ? getTransformerEdgePoint(lastPole as SymbolElement, offsetLines[offsetLines.length - 1].p1)
    : null;
  
  // 1. Start from transformer edge or center
  if (isFirstTransformer && firstEdgePoint) {
    path.push(firstEdgePoint);
  } else {
    path.push({ x: poles[0].x, y: poles[0].y });
    path.push(offsetLines[0].p1);
  }
  
  // 2. Connect segments independently
  for (let i = 0; i < offsetLines.length - 1; i++) {
    const l1 = offsetLines[i];
    const l2 = offsetLines[i+1];
    
    if (!isFirstTransformer) {
      path.push(l1.p2);
    }
    if (!isLastTransformer || i < offsetLines.length - 2) {
      path.push(l2.p1);
    }
  }
  
  // 3. End at transformer edge or center
  if (isLastTransformer && lastEdgePoint) {
    path.push(lastEdgePoint);
  } else {
    const lastLine = offsetLines[offsetLines.length - 1];
    path.push(lastLine.p2);
    path.push({ x: poles[poles.length - 1].x, y: poles[poles.length - 1].y });
  }

  return path;
};
