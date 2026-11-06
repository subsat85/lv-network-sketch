// Stage C2: what the cable library screens show, from the library's own records — pure functions,
// nothing stored, nothing written. Values are shown exactly as stored: a missing value is missing
// (never 0), a DC value stays DC, a reference temperature is shown only when the record states one,
// nothing is derived from the conductor material or cross-section.

import { ELECTRICAL_PROPERTIES, type CableConstruction, type CableTypeData, type CableTypeRevision, type ElectricalProperty, type ElectricalValue, type ValueSource, type VerificationStatus } from '../types/cableType';
import { cableTypeCompleteness } from './cableTypeModel';

export const CONSTRUCTIONS: readonly CableConstruction[] = ['abc', 'underground', 'bare', 'other'];
export const VERIFICATION_STATUSES: readonly VerificationStatus[] = ['unverified', 'checked', 'approved'];
const RANK: Record<VerificationStatus, number> = { unverified: 0, checked: 1, approved: 2 };

/**
 * The verification of a cable type as a whole: the weakest status among its entered values (an
 * approved type has every entered value approved). With no value entered, the weakest of the four.
 */
export const typeVerification = (d: CableTypeData): VerificationStatus => {
  const entered = ELECTRICAL_PROPERTIES.filter((p) => d[p].value !== undefined);
  const among = entered.length ? entered : ELECTRICAL_PROPERTIES;
  return among.map((p) => d[p].verification.status).reduce((w, s) => (RANK[s] < RANK[w] ? s : w), 'approved' as VerificationStatus);
};

export type CompletenessFilter = 'all' | 'complete' | 'draft';
export interface LibraryFilter {
  query: string;
  /** empty = every construction */
  constructions: readonly CableConstruction[];
  completeness: CompletenessFilter;
  /** empty = every status */
  verification: readonly VerificationStatus[];
}
export const NO_FILTER: LibraryFilter = { query: '', constructions: [], completeness: 'all', verification: [] };

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFKC').trim();

/**
 * The text a cable type is found by: name, description, construction (its code and the label
 * shown), conductor materials (code and label) and cross-sections. `labels` gives the shown words.
 */
export const searchableText = (d: CableTypeData, labels: { construction: (c: CableConstruction) => string; material: (m: string) => string }): string =>
  norm([
    d.name, d.description ?? '',
    d.construction, labels.construction(d.construction),
    ...(d.phase.material ? [d.phase.material, labels.material(d.phase.material)] : []),
    ...(d.neutral?.material ? [d.neutral.material, labels.material(d.neutral.material)] : []),
    ...(d.phase.sectionMm2 !== undefined ? [String(d.phase.sectionMm2)] : []),
    ...(d.neutral?.sectionMm2 !== undefined ? [String(d.neutral.sectionMm2)] : []),
  ].join(' \u0001 '));

/** The types matching the filter, in a stable order (name, then id). Only the loaded list is used. */
export const filterTypes = (
  types: readonly CableTypeRevision[], f: LibraryFilter,
  labels: Parameters<typeof searchableText>[1],
): CableTypeRevision[] => {
  const words = norm(f.query).split(/\s+/).filter(Boolean);
  return types
    .filter((t) => {
      if (f.constructions.length && !f.constructions.includes(t.construction)) return false;
      if (f.completeness !== 'all' && (cableTypeCompleteness(t).complete ? 'complete' : 'draft') !== f.completeness) return false;
      if (f.verification.length && !f.verification.includes(typeVerification(t))) return false;
      if (!words.length) return true;
      const text = searchableText(t, labels);
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
};

// ---------- one value, as stored ----------

export interface ValueView {
  property: ElectricalProperty;
  /** false: no value entered (shown as missing, never as 0) */
  entered: boolean;
  value?: number;
  basis: ElectricalValue['basis'];
  /** only when the record states one */
  referenceTempC?: number;
  /** where the source shown comes from: the value's own, the type's, or none at all */
  sourceFrom: 'value' | 'type' | 'none';
  source?: ValueSource;
  verification: ElectricalValue['verification'];
  /** a stored conversion request (never carried out) */
  conversionRequested: boolean;
}
const hasSource = (s: ValueSource | undefined): s is ValueSource => !!s && [s.name, s.reference, s.page, s.table].some((x) => !!x?.trim());

export const valueView = (d: CableTypeData, p: ElectricalProperty): ValueView => {
  const v = d[p];
  const own = hasSource(v.source) ? v.source : undefined;
  const typeSource = hasSource(d.source) ? d.source : undefined;
  return {
    property: p,
    entered: v.value !== undefined,
    ...(v.value !== undefined ? { value: v.value } : {}),
    basis: v.basis,
    ...(typeof v.referenceTempC === 'number' ? { referenceTempC: v.referenceTempC } : {}),
    sourceFrom: own ? 'value' : typeSource ? 'type' : 'none',
    ...(own ?? typeSource ? { source: own ?? typeSource } : {}),
    verification: v.verification,
    conversionRequested: v.conversion !== undefined,
  };
};

// ---------- comparing two revisions ----------

export type DiffStatus = 'added' | 'changed' | 'removed' | 'unchanged';
/** a compared field: a key of the data, a conductor field, a value or a value's verification */
export type CompareField =
  | 'name' | 'description' | 'construction' | 'phaseConductors' | 'neutralConductors'
  | 'phase.material' | 'phase.sectionMm2' | 'neutral.material' | 'neutral.sectionMm2'
  | ElectricalProperty | `${ElectricalProperty}.verification` | 'source' | 'maxCurrentA';
export interface CompareRow<T = unknown> { field: CompareField; status: DiffStatus; before?: T; after?: T }

const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if ((v as Record<string, unknown>)[k] !== undefined) o[k] = canon((v as Record<string, unknown>)[k]);
    return Object.keys(o).length ? o : undefined;
  }
  return v === '' ? undefined : v;
};
const present = (v: unknown) => canon(v) !== undefined;
const status = (a: unknown, b: unknown): DiffStatus =>
  !present(a) && !present(b) ? 'unchanged' : !present(a) ? 'added' : !present(b) ? 'removed' : JSON.stringify(canon(a)) === JSON.stringify(canon(b)) ? 'unchanged' : 'changed';
/** a value without its verification (the verification is compared on its own row) */
const valuePart = (v: ElectricalValue) => (v.value === undefined ? undefined : { value: v.value, unit: v.unit, basis: v.basis, referenceTempC: v.referenceTempC, conversion: v.conversion, source: v.source });

/** Every field of the model, from `a` (older) to `b` (newer): added / changed / removed / unchanged. */
export const compareRevisions = (a: CableTypeData, b: CableTypeData): CompareRow[] => {
  const row = (field: CompareField, x: unknown, y: unknown): CompareRow => ({ field, status: status(x, y), ...(present(x) ? { before: x } : {}), ...(present(y) ? { after: y } : {}) });
  return [
    row('name', a.name, b.name),
    row('description', a.description, b.description),
    row('construction', a.construction, b.construction),
    row('phaseConductors', a.phaseConductors, b.phaseConductors),
    row('neutralConductors', a.neutralConductors, b.neutralConductors),
    row('phase.material', a.phase?.material, b.phase?.material),
    row('phase.sectionMm2', a.phase?.sectionMm2, b.phase?.sectionMm2),
    row('neutral.material', a.neutral?.material, b.neutral?.material),
    row('neutral.sectionMm2', a.neutral?.sectionMm2, b.neutral?.sectionMm2),
    ...ELECTRICAL_PROPERTIES.flatMap((p) => [row(p, valuePart(a[p]), valuePart(b[p])), row(`${p}.verification`, a[p].verification, b[p].verification)]),
    row('source', a.source, b.source),
    row('maxCurrentA', a.maxCurrentA, b.maxCurrentA),
  ];
};

/** The revisions, newest first, each with what changed from the one before it (none for the first). */
export const revisionChanges = (revisions: readonly CableTypeRevision[]): { revision: CableTypeRevision; changed: CompareField[] }[] =>
  revisions
    .map((r, i) => ({ revision: r, changed: i === 0 ? [] : compareRevisions(revisions[i - 1], r).filter((x) => x.status !== 'unchanged').map((x) => x.field) }))
    .reverse();
