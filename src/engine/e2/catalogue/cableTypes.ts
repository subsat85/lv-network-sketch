// Stage B: a span's library cable type (its exact snapshot + the project's overrides) as a catalogue
// entry of E2, so that the approved Stage A rules apply to it (resolve.ts).
//
// Engineering correction (approved): E2 uses the cable's values exactly as entered in its AC network
// equations — no DC → AC conversion, no F8 / IEC 60228 conversion, no thermal correction; neither the
// conductor temperature nor the ambient temperature changes R or RN, and no reference temperature is
// assumed (not 20, 70 or 90 °C):
//   - a resistance stated as AC, or without saying AC / DC ('unspecified') → rAc, used directly; its
//     basis and reference temperature are recorded in the value's conditions, nothing is classified for it,
//     and a missing reference temperature does not by itself make a result provisional;
//   - a resistance stated as DC → rDc20, which the resolver also uses as entered (never as AC, never
//     converted) with the note 'dc-resistance-as-entered';
//   - a conversion request stored on a value (`conversion`) is kept as data but is NOT carried out in the
//     calculation path; it is reported (`conversionNotApplied` → issue cable-type:conversion-not-applied).
// R, X, RN, XN are independent: a missing value stays missing (never 0, never R for RN, never X for XN),
// and the resolver reports it as for any catalogue entry. Each value keeps its own verification.
// A type that cannot describe its conductors (phase or neutral material / section) is refused whole.

import type { ElectricalValue, SpanCableType, ValueSource } from '../../../types/cableType';
import { effectiveCableType } from '../../../utils/cableTypeModel';
import { validateCatalogue, type CableEntry, type CatalogueDocument, type Measured } from './schema';


export interface CableTypeEntry {
  entryId: string;
  /** undefined when the type is refused */
  entry?: CableEntry;
  documents: CatalogueDocument[];
  /** why the type is refused ('field:problem', comma separated) */
  problems?: string;
  /** values that carry a conversion request: not converted, used as entered */
  conversionNotApplied: ('R' | 'RN')[];
}

const NOT_STATED = 'not stated';
const RANK = { unverified: 0, checked: 1, approved: 2 } as const;
const BASIS_TEXT = { ac: 'AC', dc: 'DC', unspecified: 'current type not stated' } as const;

/** the conditions of a resistance as the source states them (nothing assumed) */
export const resistanceConditions = (v: ElectricalValue): string => {
  const basis = BASIS_TEXT[v.basis as keyof typeof BASIS_TEXT] ?? String(v.basis);
  const temp = typeof v.referenceTempC === 'number' ? `reference temperature ${v.referenceTempC} degC` : 'reference temperature unspecified';
  return `${basis}, ${temp}`;
};

export const cableTypeEntry = (ct: SpanCableType): CableTypeEntry => {
  const { data, overridden } = effectiveCableType(ct);
  const entryId = `cable-type:${ct.typeId}@${ct.revision}${overridden.length ? `+project(${overridden.join(',')})` : ''}`;
  const problems: string[] = [];
  const conversionNotApplied: ('R' | 'RN')[] = [];
  const documents: CatalogueDocument[] = [];
  const docFor = (s: ValueSource): string => {
    const title = [s.name, s.reference].filter((x) => x?.trim()).join(' — ') || NOT_STATED;
    const found = documents.find((d) => d.title === title && d.manufacturer === (s.name?.trim() || NOT_STATED));
    if (found) return found.id;
    const id = `${entryId}/source-${documents.length + 1}`;
    documents.push({ id, manufacturer: s.name?.trim() || NOT_STATED, title });
    return id;
  };
  const measured = (v: ElectricalValue, conditions: string, isOverride: boolean): Measured => {
    const src = v.source ?? data.source;
    return {
      value: v.value!, unit: v.unit, conditions: isOverride ? `${conditions}; project override` : conditions,
      source: { documentId: docFor(src), page: src.page?.trim() || NOT_STATED, ...(src.table ? { table: src.table } : {}) },
    };
  };

  if (!data.phase?.material || !data.phase.sectionMm2) problems.push('phase:construction');
  if (!(Number.isInteger(data.phaseConductors) && data.phaseConductors >= 1)) problems.push('phaseConductors:construction');
  if (data.neutralConductors > 1) problems.push('neutralConductors:construction');
  const hasNeutral = data.neutralConductors === 1;
  if (hasNeutral && (!data.neutral?.material || !data.neutral.sectionMm2)) problems.push('neutral:construction');
  if (problems.length) return { entryId, documents, problems: problems.join(', '), conversionNotApplied };

  const ov = (p: 'r' | 'x' | 'rn' | 'xn') => overridden.includes(p);
  /** a resistance, as entered: DC → rDc20 (used as entered, noted), AC or not stated → rAc */
  const resistance = (p: 'r' | 'rn'): { field: 'rAc' | 'rDc20' | 'rnAc' | 'rnDc20'; m: Measured } | undefined => {
    const v = data[p];
    if (v.value === undefined) return undefined;
    if (v.conversion !== undefined) conversionNotApplied.push(p === 'r' ? 'R' : 'RN');
    const dc = v.basis === 'dc';
    const field = p === 'r' ? (dc ? 'rDc20' : 'rAc') : dc ? 'rnDc20' : 'rnAc';
    return { field, m: measured(v, `${resistanceConditions(v)}; used as entered, no conversion, no thermal correction`, ov(p)) };
  };
  const r = resistance('r');
  const x = data.x.value !== undefined ? measured(data.x, 'AC, 50 Hz', ov('x')) : undefined;
  const rn = hasNeutral ? resistance('rn') : undefined;
  const xn = hasNeutral && data.xn.value !== undefined ? measured(data.xn, 'AC, 50 Hz', ov('xn')) : undefined;
  const used = [r && data.r, x && data.x, rn && data.rn, xn && data.xn].filter((v): v is ElectricalValue => !!v);
  const worst = used.reduce<'unverified' | 'checked' | 'approved'>((w, v) => (RANK[v.verification.status] < RANK[w] ? v.verification.status : w), 'approved');
  const neutral = hasNeutral ? { material: data.neutral!.material!, sectionMm2: data.neutral!.sectionMm2! } : undefined;

  const entry: CableEntry = {
    id: entryId,
    manufacturer: data.source.name?.trim() || NOT_STATED,
    designation: data.name,
    cableKind: data.construction,
    construction: `${data.phaseConductors}x${data.phase.sectionMm2}${neutral ? ` + ${neutral.sectionMm2}` : ''}`,
    phase: { material: data.phase.material, sectionMm2: data.phase.sectionMm2 },
    ...(neutral ? { neutral } : {}),
    ...(r ? { [r.field]: r.m } : {}),
    ...(x ? { x } : {}),
    ...(rn ? { [rn.field]: rn.m } : {}),
    ...(xn ? { xn } : {}),
    verification: { status: used.length ? worst : 'unverified', note: `library cable type ${ct.typeId}, revision ${ct.revision}` },
    propertyVerification: {
      ...(r ? { [r.field]: data.r.verification.status } : {}),
      ...(x ? { x: data.x.verification.status } : {}),
      ...(rn ? { [rn.field]: data.rn.verification.status } : {}),
      ...(xn ? { xn: data.xn.verification.status } : {}),
    },
  };
  const errors = validateCatalogue({ documents, entries: [entry] });
  if (errors.length) return { entryId, documents, problems: errors.map((e) => `${e.field}:${e.problem}`).join(', '), conversionNotApplied };
  return { entryId, entry, documents, conversionNotApplied };
};
