export type Point = { x: number; y: number };

export type ElementType = 'path' | 'text' | 'symbol' | 'cable' | 'consumer' | 'arc' | 'shape' | 'transformer_table' | 'cable_arc' | 'jumper';

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
  /** chosen by the user as the supply point for the voltage-drop calculation */
  vdSource?: boolean;
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
  /**
   * «نقطة فصل مقترحة»: poles of this cable where a split is suggested for study.
   * Drawn as the start / end arrowhead in red (cableArrows.ts). A drawing mark only:
   * the cable is not cut and its connections, lengths and calculations are unchanged.
   */
  suggestedSplits?: string[];
  /**
   * For the voltage-drop study with suggested split points (ElectricalSettings.studySuggestedSplits):
   * at each suggested split at an interior pole of this cable, the side that stays connected to the
   * pole — its consumers and its other connections. Key `${poleId}#${occurrence}` (occurrence = which
   * visit of that pole by this cable, as for Jumpers); 'prev' = the side towards the previous pole in
   * poleIds, 'next' = towards the next one. The other side is an open end there (only a Jumper that
   * names it connects it). Missing = not chosen yet (the network is not computed while it matters).
   */
  splitConsumerSides?: Record<string, 'prev' | 'next'>;
  cableType?: 'overhead' | 'ground';
  lineStyle?: 'zigzag' | 'straight';
  distances?: Record<number, string>; // Key: index of start pole in poleIds
  /**
   * Stable id of every span: spanIds[i] is the span poleIds[i] → poleIds[i+1].
   * Kept consistent by reconcileElements (src/utils/spanModel.ts) whenever the
   * pole list changes. Missing on projects made before Stage 7 (created on load).
   */
  spanIds?: string[];
  /** Electrical properties per span, keyed by span id (only spans that have any). */
  spanProps?: Record<string, SpanProps>;
  /**
   * How each end of the cable connects at its pole (Stage 7.9). Missing = 'auto'
   * (the drawing's rule: joined to same-colour cables at that pole). 'connected'
   * confirms that junction; 'isolated' says this end is not connected there.
   * Cleared automatically when that end moves to another pole.
   */
  endLinks?: { start?: CableEndLink; end?: CableEndLink };
}

export type CableEndLink = 'connected' | 'isolated';

export type ConductorMaterial = 'al' | 'cu';
export type SupplySystem = '3ph4w' | '1ph2w';
export type CableKind = 'abc' | 'bare' | 'underground' | 'other';

/**
 * Electrical properties of one span of one cable. Every field is optional: a
 * field that is missing is reported as missing by the calculation, never guessed.
 * The span length is the distance written on the drawing for the pole pair
 * (connectionDistances), so it is not stored here.
 */
export interface SpanProps {
  /** pole pair (in the cable's order) these properties were written for */
  poles: [string, string];
  cableKind?: CableKind;
  material?: ConductorMaterial;
  /** phase conductor cross-section, mm² */
  crossSectionMm2?: number;
  /** neutral conductor cross-section, mm² */
  neutralCrossSectionMm2?: number;
  /** neutral conductor material ('alloy' = aluminium alloy, e.g. the AAAC messenger of ABC);
   *  not taken from the phase material — the conductor table is used for it only when
   *  it is plain 'al' or 'cu' */
  neutralMaterial?: ConductorMaterial | 'alloy';
  /** conductors per phase connected in parallel (1 = a single conductor) */
  parallel?: number;
  system?: SupplySystem;
  /** phase resistance at operating temperature, Ω/km (overrides the conductor table) */
  rOhmPerKm?: number;
  /** phase reactance, Ω/km */
  xOhmPerKm?: number;
  /** neutral resistance at operating temperature, Ω/km (overrides the conductor table) */
  rNeutralOhmPerKm?: number;
  /** where the values come from (catalogue, report, measurement…) */
  dataSource?: string;
  /** copied from the previous span while drawing and not yet reviewed */
  inherited?: boolean;
  /** reasons the values should be checked (span split / merged / moved) */
  review?: SpanReview[];
  /** properties read from a feature/vd (version 2) file, kept unchanged */
  legacyV2?: unknown;
  /** after merging spans whose properties differed (or existed on one side only):
   *  every original record (null = that span had none), kept for review */
  mergedFrom?: (Omit<SpanProps, 'poles' | 'mergedFrom'> | null)[];
}
// 'defaults' (Stage 7.13): missing properties of an existing span were filled with the default
// values on the user's request; shown as «افتراضي — يحتاج مراجعة» until the span is saved
export type SpanReview = 'split' | 'merge' | 'merge-different' | 'merge-partial' | 'moved' | 'v2' | 'defaults';

/**
 * Status of a span distance (connectionDistances[key]) that was not typed by the user.
 * Written when a pole is placed on a span; removed as soon as the user enters
 * that distance (it is then a measured value).
 */
export interface DistanceFlag {
  /** the value is an estimate (half of the split span), not a measurement */
  estimated?: boolean;
  /** the span this one was split from, with its distance (and label offset) at the time,
   *  so deleting the new pole again restores it exactly */
  splitFrom?: { key: string; value: string; offset?: { x: number; y: number }; flag?: DistanceFlag };
}

/** Project-wide settings of the voltage-drop calculation (saved with the drawing). */
export interface ElectricalSettings {
  /** nominal phase-to-neutral voltage, V */
  phaseVoltage: number;
  /** nominal phase-to-phase voltage, V */
  lineVoltage: number;
  /** voltage-drop limit, % of nominal */
  limitPercent: number;
  /** a result at or above this fraction of the limit is shown as a warning */
  nearLimitFraction: number;
  /** lowest acceptable phase-to-neutral voltage, V */
  minPhaseVoltage: number;
  /** lowest acceptable phase-to-phase voltage, V */
  minLineVoltage: number;
  /** load power factor (cos φ) — required, no default */
  powerFactor?: number;
  /** conductor operating temperature, °C — required when the conductor table is used */
  conductorTempC?: number;
  /**
   * How single-phase loads with an unknown phase are handled:
   * 'worst'    — all of them on the phase being checked (an upper bound);
   * 'balanced' — split equally over the three phases (an assumption the user chose).
   */
  singlePhaseMode: 'worst' | 'balanced';
  /**
   * How loads respond to the voltage (Stage 7.9). 'constant-current' (default, and
   * the value of every project saved before): the rule currents as they are.
   * 'constant-power': each subscriber draws the power of its rule current at the
   * nominal voltage, so its current is scaled by V_nominal / V at its pole (iterated).
   */
  loadModel?: 'constant-current' | 'constant-power';
  /**
   * Voltage-drop study: when true, every suggested split point at an interior pole of a cable
   * (CableElement.suggestedSplits) is calculated as an electrical open point there. Off / missing
   * (the default, and every project saved before): suggestions are drawing marks only.
   */
  studySuggestedSplits?: boolean;
  /**
   * Voltage-drop study: when true, proposed subscribers that are not confirmed yet
   * (ConsumerElement.proposal.status 'proposed') are calculated too. Off / missing
   * (the default): only existing and confirmed subscribers are calculated.
   */
  studyProposedConsumers?: boolean;
}

/**
 * A pole-to-pole link read from a feature/vd (version 2) file. It is kept and
 * drawn so no data is lost, but its electrical meaning is not defined in this
 * app, so the calculation does not use it (and says so).
 */
export interface LegacyJumperElement extends BaseElement {
  type: 'jumper';
  fromPoleId: string;
  toPoleId: string;
}

export interface ConsumerElement extends BaseElement {
  type: 'consumer';
  poleId: string;
  color: string;
  count: number;
  hasManualPosition?: boolean;
  variant?: 'circle' | 'square';
  label?: string;
  /**
   * «مشترك مقترح»: a new subscriber proposed at this pole. Missing = an existing
   * subscriber (unchanged behaviour). Its load follows the same rules as any
   * subscriber (variant / label / count). See ConsumerProposal.
   */
  proposal?: ConsumerProposal;
}

/**
 * A proposed subscriber. It is connected to ONE chosen cable at its pole (not by
 * colour): `connection` names the cable and which visit of the pole; `side` is set
 * only when the user chose one side of a study split there (missing = the pole's
 * connection point of that visit). While 'proposed' it is calculated only in the
 * study (ElectricalSettings.studyProposedConsumers); once 'confirmed' it is always
 * calculated, as a permanent subscriber, and is still drawn as a proposal.
 */
export interface ConsumerProposal {
  status: 'proposed' | 'confirmed';
  connection?: { cableId: string; occurrence: number; side?: 'prev' | 'next' };
  /** where its box is drawn, relative to the pole centre (world units); missing = automatic */
  boxOffset?: { x: number; y: number };
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

/**
 * One end of a cable arc: where a cable is connected at the arc's pole.
 * Identified by the cable and by which side of the pole it leaves on, in the
 * cable's own pole order ('prev' = towards the pole before it, 'next' = towards
 * the pole after it). `occurrence` is which visit of the pole (0 unless the
 * cable passes the same pole more than once). This stays the same when poles
 * move, cable offsets change, a pole is inserted into a span or an interior
 * pole is removed (the cable continues on the same side).
 */
export interface CableArcEnd {
  cableId: string;
  side: 'prev' | 'next';
  occurrence: number;
}

/** A link drawn at one pole between two cable connection points. */
export interface CableArcElement extends BaseElement {
  type: 'cable_arc';
  poleId: string;
  from: CableArcEnd;
  to: CableArcEnd;
}

export type DrawingElement = PathElement | TextElement | SymbolElement | CableElement | ConsumerElement | ArcElement | ShapeElement | TransformerTableElement | CableArcElement | LegacyJumperElement;

export type ToolType = 'select' | 'draw' | 'text' | 'symbol' | 'cable' | 'cable_straight' | 'consumer' | 'arc' | 'shape';

export interface DrawingStyle {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
}
