import type { CableElement, SpanProps } from '../types/drawing';
import { companyRX } from '../data/conductors';
import { spanAt, withSpanProps } from './spanModel';

// Default properties of a newly drawn span, and filling R / X / Rn from the
// company cable table (Stage 7.12).
//
// - The defaults are written into a span only when it is drawn and gets no
//   other properties (the first span of a cable, or a span added after one that
//   has none). A span added after one WITH properties keeps the existing rule:
//   a copy of its neighbour, marked `inherited` (spanModel.ts).
// - Nothing is applied when a project is opened, imported or restored: spans
//   that exist already are never changed, with or without properties.
// - The values are copied into the span (no reference to these defaults), so a
//   later change of the defaults cannot change any saved span.
// - In the span sheet, R / X (and Rn) follow the material / section only while
//   they are the table values (or empty); a value typed by hand is kept until
//   the user explicitly asks for the table values.
//
// Neutral resistance Rn:
// - Taken from the company table ONLY by the neutral's own material and
//   cross-section, and only when that pair is in the table (plain 'al' / 'cu',
//   one of its 7 sizes). The phase material and section are never used for Rn.
// - No reliable value (alloy neutral, size not in the table, material not
//   given): Rn is left empty — or a typed Rn is kept — and the calculation reports
//   what is missing, as before. Nothing is estimated.
// - A value is treated as "from the table" when it equals the table value of the
//   current neutral selection; any other typed value is never replaced or cleared
//   by a change of the neutral fields, only by the explicit button.
// - The neutral's reactance is not a table value here: the calculation uses the
//   span's X for the neutral too (see voltageDrop.ts, `zN`).

export const DEFAULT_DATA_SOURCE = 'كتالوج';

const PHASE_DEFAULT = { material: 'al', crossSectionMm2: 120 } as const;
const NEUTRAL_DEFAULT = { neutralMaterial: 'al', neutralCrossSectionMm2: 70 } as const;

/** The properties a new span gets (without the pole pair). */
export const defaultSpanValues = (): Omit<SpanProps, 'poles'> => {
  const ph = companyRX(PHASE_DEFAULT.material, PHASE_DEFAULT.crossSectionMm2)!;
  const ne = companyRX(NEUTRAL_DEFAULT.neutralMaterial, NEUTRAL_DEFAULT.neutralCrossSectionMm2)!;
  return {
    cableKind: 'abc',
    system: '3ph4w',
    material: PHASE_DEFAULT.material,
    crossSectionMm2: PHASE_DEFAULT.crossSectionMm2,
    neutralMaterial: NEUTRAL_DEFAULT.neutralMaterial,
    neutralCrossSectionMm2: NEUTRAL_DEFAULT.neutralCrossSectionMm2,
    parallel: 1,
    rOhmPerKm: ph.r,
    xOhmPerKm: ph.x,
    // the neutral's own conductor (Al 70 mm²) from the same table — not the phase R
    rNeutralOhmPerKm: ne.r,
    dataSource: DEFAULT_DATA_SOURCE,
  };
};

/**
 * The cable with the default properties on span `index`, when that span has no
 * record yet (a span that got a copy of its neighbour, or any stored record, is
 * left as it is). Returns the same object when nothing changes.
 */
export const withDefaultSpan = (cable: CableElement, index: number): CableElement => {
  if (index < 0 || index >= cable.poleIds.length - 1) return cable;
  const { id, props } = spanAt(cable, index);
  if (!id || props) return cable;
  return withSpanProps(cable, id, { poles: [cable.poleIds[index], cable.poleIds[index + 1]], ...defaultSpanValues() });
};

// ---------- the span sheet: following the table without overwriting typed values ----------

const num = (s: string) => { const t = s.trim().replace(',', '.'); return t === '' ? undefined : Number(t); };
const str = (v: number | undefined) => (v === undefined ? '' : String(v));

/** A field "follows the table" when it is empty or holds exactly the table value of the current selection. */
const follows = (value: string, tableValue: number | undefined) => value.trim() === '' || (tableValue !== undefined && num(value) === tableValue);

export interface PhaseFields { material: string; section: string; r: string; x: string }
export interface NeutralFields { neutralMaterial: string; neutral: string; rn: string }

/**
 * R and X after the phase material or section changed from `prev` to `next`.
 * Each of R and X is replaced by the new table value (or emptied when the new size
 * is not in the table) only if it followed the table before; a typed value stays,
 * and `kept` lists it.
 */
export const followPhaseTable = (prev: PhaseFields, next: Pick<PhaseFields, 'material' | 'section'>): { r: string; x: string; kept: ('r' | 'x')[] } => {
  const before = companyRX(prev.material, num(prev.section));
  const after = companyRX(next.material, num(next.section));
  const kept: ('r' | 'x')[] = [];
  const r = follows(prev.r, before?.r) ? str(after?.r) : (kept.push('r'), prev.r);
  const x = follows(prev.x, before?.x) ? str(after?.x) : (kept.push('x'), prev.x);
  return { r, x, kept };
};

/** Rn after the neutral material or section changed (same rule; only plain al / cu are in the table). */
export const followNeutralTable = (prev: NeutralFields, next: Pick<NeutralFields, 'neutralMaterial' | 'neutral'>): { rn: string; kept: boolean } => {
  const before = companyRX(prev.neutralMaterial, num(prev.neutral));
  const after = companyRX(next.neutralMaterial, num(next.neutral));
  return follows(prev.rn, before?.r) ? { rn: str(after?.r), kept: false } : { rn: prev.rn, kept: true };
};

/** How the R / X fields relate to the company table for the current selection (shown in the sheet). */
export const phaseTableState = (f: PhaseFields): { table: { r: number; x: number } | null; matches: boolean } => {
  const table = companyRX(f.material, num(f.section));
  return { table, matches: !!table && num(f.r) === table.r && num(f.x) === table.x };
};
export const neutralTableState = (f: NeutralFields): { table: { r: number; x: number } | null; matches: boolean } => {
  const table = companyRX(f.neutralMaterial, num(f.neutral));
  return { table, matches: !!table && num(f.rn) === table.r };
};
