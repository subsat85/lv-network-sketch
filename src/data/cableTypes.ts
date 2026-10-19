// ─────────────────────────────────────────────────────────────────────────────
// Cable type catalogue for voltage-drop calculations
//
// HOW TO FILL THIS FILE
// ─────────────────────
// Every R20 and X value MUST come from the approved technical report supplied
// by the project engineer.  Do NOT invent or estimate values.
//
// Until a value is confirmed it stays undefined, which causes the voltage-drop
// engine to report ResultConfidence = 'blocked' for that cable type — this is
// intentional and safe.
//
// Fields:
//   id            – stable machine key used in SpanProps.cableTypeId
//   name          – Arabic/English display label shown in the UI
//   material      – 'aluminum' | 'copper'
//   crossSection  – conductor cross-section in mm²
//   R20           – AC resistance at 20 °C in Ω/km  (leave undefined until confirmed)
//   X             – reactance in Ω/km                (leave undefined until confirmed)
//   maxCurrentAir – maximum permissible current in air  in A (optional)
//   maxCurrentGround – maximum permissible current buried in A (optional)
//   source        – citation: document name / page / table from the approved report
// ─────────────────────────────────────────────────────────────────────────────

export interface CableType {
  /** Stable identifier used as SpanProps.cableTypeId in the store */
  id: string;
  /** Human-readable label (Arabic preferred for field display) */
  name: string;
  material: 'aluminum' | 'copper';
  /** Conductor cross-section in mm² */
  crossSection: number;
  /** AC resistance at 20 °C in Ω/km — undefined = not yet entered from report */
  R20?: number;
  /** Reactance in Ω/km — undefined = not yet entered from report */
  X?: number;
  /** Maximum continuous current rating in free air (A) */
  maxCurrentAir?: number;
  /** Maximum continuous current rating when buried (A) */
  maxCurrentGround?: number;
  /** Document / table / page from the approved technical report */
  source?: string;
}

/**
 * Temperature correction coefficient α for resistance (per °C).
 * R_T = R20 × [1 + α × (T − 20)]
 *
 * Standard IEC values:
 *   aluminum: 0.00403 /°C
 *   copper:   0.00393 /°C
 *
 * Override per cable type if the approved report specifies a different value.
 */
export const ALPHA_ALUMINUM = 0.00403; // /°C
export const ALPHA_COPPER   = 0.00393; // /°C

/**
 * Return the temperature-correction coefficient for a given cable type.
 * Prefers the type's own alpha when provided, otherwise uses the material default.
 */
export function alphaForCable(type: CableType & { alpha?: number }): number {
  if (type.alpha !== undefined) return type.alpha;
  return type.material === 'copper' ? ALPHA_COPPER : ALPHA_ALUMINUM;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATALOGUE
// Add entries here once the approved technical report values are available.
// Keep each entry's id stable — changing an id invalidates stored SpanProps.
// ─────────────────────────────────────────────────────────────────────────────

export const cableTypes: CableType[] = [
  // ── Overhead aluminum (ACSR / ABC) ──────────────────────────────────────────
  // Example skeleton — fill R20, X, maxCurrentAir from the approved report:
  // {
  //   id: 'al_overhead_16',
  //   name: 'كابل هوائي ألمنيوم 16 مم²',
  //   material: 'aluminum',
  //   crossSection: 16,
  //   R20: undefined,   // Ω/km — fill from approved report
  //   X:   undefined,   // Ω/km — fill from approved report
  //   maxCurrentAir: undefined,
  //   source: 'اسم الوثيقة، الجدول X، الصفحة Y',
  // },

  // ── Underground aluminum ─────────────────────────────────────────────────────
  // {
  //   id: 'al_ground_95',
  //   name: 'كابل أرضي ألمنيوم 95 مم²',
  //   material: 'aluminum',
  //   crossSection: 95,
  //   R20: undefined,
  //   X:   undefined,
  //   maxCurrentGround: undefined,
  //   source: 'اسم الوثيقة، الجدول X، الصفحة Y',
  // },

  // ── Copper ───────────────────────────────────────────────────────────────────
  // {
  //   id: 'cu_ground_50',
  //   name: 'كابل أرضي نحاس 50 مم²',
  //   material: 'copper',
  //   crossSection: 50,
  //   R20: undefined,
  //   X:   undefined,
  //   maxCurrentGround: undefined,
  //   source: 'اسم الوثيقة، الجدول X، الصفحة Y',
  // },
];

/** Lookup a cable type by its id.  Returns undefined if not found. */
export function getCableType(id: string): CableType | undefined {
  return cableTypes.find(ct => ct.id === id);
}
