export type Point = { x: number; y: number };

export type ElementType = 'path' | 'text' | 'symbol' | 'cable' | 'consumer' | 'arc' | 'shape' | 'transformer_table';

export type ShapeType = 'rectangle' | 'circle' | 'triangle' | 'arrow' | 'compass' | 'curved_arrow';

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface PathElement extends BaseElement {
  type: 'path';
  points: Point[];
}

export interface ArcElement extends BaseElement {
  type: 'arc';
  x2: number;
  y2: number;
  controlX: number;
  controlY: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
}

export interface SymbolModifiers {
  isTilted?: boolean;
  isRusted?: boolean;
  isProposedReplacement?: boolean;
  note?: {
    text: string;
    x: number;
    y: number;
    color?: string;
  };
}

export interface SymbolElement extends BaseElement {
  type: 'symbol';
  symbolId: string;
  width: number;
  height: number;
  isProposed?: boolean;
  modifiers?: SymbolModifiers;
}

export interface CableElement extends BaseElement {
  type: 'cable';
  poleIds: string[];
  cableIndex: number;
  offset: number;
  arrowMode?: 'none' | 'start' | 'end';
  cableType?: 'overhead' | 'ground';
  lineStyle?: 'zigzag' | 'straight';
  distances?: Record<number, string>; // Key: index of start pole in poleIds
}

export interface ConsumerElement extends BaseElement {
  type: 'consumer';
  poleId: string;
  color: string;
  count: number;
  hasManualPosition?: boolean;
  variant?: 'circle' | 'square';
  label?: string;
}

export interface TransformerTableElement extends BaseElement {
  type: 'transformer_table';
  transformerInfo: {
    transformerNumber: string;
    mainCable: string;
    mainLinesCount: string;
    cableType: string;
    distributionBoxesCount: string;
    circuitsPerBox: string;
    emptyCircuitsPerBox: string;
    perBoxCircuits?: { circuits: string; emptyCircuits: string }[];
    installationMethod: string;
    transformerType: string;
    boxInstallationMethod: string;
    lightingBox: string;
    capacitor: string;
  };
  scale: number;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  width: number;
  height: number;
  points?: Point[]; // For curved arrow control points
  curveIntensity?: number; // For curved arrow
  arrowHeadSize?: number;
}

export type DrawingElement = PathElement | TextElement | SymbolElement | CableElement | ConsumerElement | ArcElement | ShapeElement | TransformerTableElement;

export type ToolType = 'select' | 'draw' | 'text' | 'symbol' | 'cable' | 'cable_straight' | 'consumer' | 'arc' | 'shape';

export interface DrawingStyle {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
}
