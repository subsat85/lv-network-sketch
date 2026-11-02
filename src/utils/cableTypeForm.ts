// Stage C3: the cable type form — pure functions between what the person types and the library's own
// data model (types/cableType.ts). Nothing is stored here; the library functions do the writing.
//
// Rules: an empty field stays undefined (never 0); X = 0 is a value; nothing is derived from the
// material or the cross-section; no DC ↔ AC conversion, no thermal correction, no reference temperature
// assumed; a verification is only what the person chose (checked / approved need an entered value and a
// stated source); a stored conversion request is kept as it is (it is not edited here).

import {
  ELECTRICAL_PROPERTIES,
  type CableConstruction, type CableTypeData, type CableTypeRevision, type ElectricalProperty, type ElectricalValue,
  type ReactanceBasis, type ResistanceBasis, type ResistanceConversion, type ValueSource, type Verification, type VerificationStatus,
} from '../types/cableType';
import { cableTypeCompleteness, type CableTypeEdit } from './cableTypeModel';

export interface ValueForm {
  value: string;
  basis: ResistanceBasis | ReactanceBasis;
  /** resistances only; empty = not stated */
  referenceTempC: string;
  /** this value has its own source (else the cable type's source applies) */
  ownSource: boolean;
  sourceName: string;
  sourceReference: string;
  sourcePage: string;
  sourceTable: string;
  status: VerificationStatus;
  verifiedBy: string;
  verifiedOn: string;
  /** kept from the stored value, not edited by the form */
  verificationNote?: string;
  conversion?: ResistanceConversion;
}

export interface CableForm {
  name: string;
  description: string;
  construction: '' | CableConstruction;
  phaseConductors: string;
  neutralConductors: string;
  phaseMaterial: '' | 'al' | 'cu';
  phaseSection: string;
  neutralMaterial: '' | 'al' | 'cu' | 'alloy';
  neutralSection: string;
  sourceName: string;
  sourceReference: string;
  sourcePage: string;
  sourceTable: string;
  /** the revision note (saved with the revision, not part of the data) */
  note: string;
  r: ValueForm; x: ValueForm; rn: ValueForm; xn: ValueForm;
}

export const RESISTANCE: ReadonlySet<ElectricalProperty> = new Set(['r', 'rn']);
export const RESISTANCE_BASES: readonly ResistanceBasis[] = ['ac', 'dc', 'unspecified'];

const emptyValue = (p: ElectricalProperty): ValueForm => ({
  value: '', basis: RESISTANCE.has(p) ? 'unspecified' : 'ac-50hz', referenceTempC: '', ownSource: false,
  sourceName: '', sourceReference: '', sourcePage: '', sourceTable: '', status: 'unverified', verifiedBy: '', verifiedOn: '',
});

/** a new cable type: every field empty (no value is proposed); the verification starts as unverified */
export const emptyCableForm = (): CableForm => ({
  name: '', description: '', construction: '', phaseConductors: '', neutralConductors: '',
  phaseMaterial: '', phaseSection: '', neutralMaterial: '', neutralSection: '',
  sourceName: '', sourceReference: '', sourcePage: '', sourceTable: '', note: '',
  r: emptyValue('r'), x: emptyValue('x'), rn: emptyValue('rn'), xn: emptyValue('xn'),
});

const str = (n: number | undefined) => (n === undefined ? '' : String(n));
const valueToForm = (v: ElectricalValue): ValueForm => ({
  value: str(v.value), basis: v.basis, referenceTempC: str(v.referenceTempC),
  ownSource: !!v.source, sourceName: v.source?.name ?? '', sourceReference: v.source?.reference ?? '', sourcePage: v.source?.page ?? '', sourceTable: v.source?.table ?? '',
  status: v.verification.status, verifiedBy: v.verification.by ?? '', verifiedOn: v.verification.on ?? '',
  ...(v.verification.note !== undefined ? { verificationNote: v.verification.note } : {}),
  ...(v.conversion ? { conversion: v.conversion } : {}),
});

/** the form of an existing revision, exactly as stored */
export const cableFormFrom = (t: CableTypeRevision): CableForm => ({
  name: t.name, description: t.description ?? '', construction: t.construction,
  phaseConductors: String(t.phaseConductors), neutralConductors: String(t.neutralConductors),
  phaseMaterial: t.phase.material ?? '', phaseSection: str(t.phase.sectionMm2),
  neutralMaterial: t.neutral?.material ?? '', neutralSection: str(t.neutral?.sectionMm2),
  sourceName: t.source.name ?? '', sourceReference: t.source.reference ?? '', sourcePage: t.source.page ?? '', sourceTable: t.source.table ?? '',
  note: '',
  r: valueToForm(t.r), x: valueToForm(t.x), rn: valueToForm(t.rn), xn: valueToForm(t.xn),
});

// ---------- reading what was typed ----------

/** '' → undefined; '0,5' / '0.5' → 0.5; anything else that is not a number → NaN */
export const parseNumber = (s: string): number | undefined => {
  const t = s.trim();
  if (t === '') return undefined;
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return NaN;
  return Number(t.replace(',', '.'));
};

export type FormErrorCode =
  | 'required' | 'number' | 'integer' | 'positive' | 'nonNegative' | 'range'
  | 'verifiedNeedsValue' | 'verifiedNeedsSource';
/** field: 'name', 'phaseSection', 'r.value', 'r.referenceTempC', 'r.status' … */
export interface FormError { field: string; code: FormErrorCode }

const trimmed = (s: string) => s.trim() || undefined;
const sourceOf = (name: string, reference: string, page: string, table: string): ValueSource => {
  const o: ValueSource = {};
  const n = trimmed(name), r = trimmed(reference), p = trimmed(page), t = trimmed(table);
  if (n) o.name = n; if (r) o.reference = r; if (p) o.page = p; if (t) o.table = t;
  return o;
};
const hasAny = (s: ValueSource) => Object.keys(s).length > 0;

/**
 * The data of the form, or what is wrong with it. A draft is allowed: only the name, the construction and
 * the conductor counts are needed; every value may be left empty (and stays undefined).
 */
export const readCableForm = (f: CableForm): { errors: FormError[]; data?: CableTypeData } => {
  const errors: FormError[] = [];
  const err = (field: string, code: FormErrorCode) => errors.push({ field, code });
  if (!f.name.trim()) err('name', 'required');
  if (!f.construction) err('construction', 'required');

  const count = (field: string, s: string, min: number) => {
    const n = parseNumber(s);
    if (n === undefined) { err(field, 'required'); return undefined; }
    if (!Number.isFinite(n)) { err(field, 'number'); return undefined; }
    if (!Number.isInteger(n)) { err(field, 'integer'); return undefined; }
    if (n < min) { err(field, min > 0 ? 'positive' : 'nonNegative'); return undefined; }
    return n;
  };
  const phaseConductors = count('phaseConductors', f.phaseConductors, 1);
  const neutralConductors = count('neutralConductors', f.neutralConductors, 0);
  const section = (field: string, s: string) => {
    const n = parseNumber(s);
    if (n === undefined) return undefined;
    if (!Number.isFinite(n)) { err(field, 'number'); return undefined; }
    if (n <= 0) { err(field, 'positive'); return undefined; }
    return n;
  };
  const phaseSection = section('phaseSection', f.phaseSection);
  const hasNeutral = (neutralConductors ?? 0) > 0;
  const neutralSection = hasNeutral ? section('neutralSection', f.neutralSection) : undefined;
  const typeSource = sourceOf(f.sourceName, f.sourceReference, f.sourcePage, f.sourceTable);

  const value = (p: ElectricalProperty): ElectricalValue => {
    const v = f[p];
    const n = parseNumber(v.value);
    let num: number | undefined;
    if (n !== undefined) {
      if (!Number.isFinite(n)) err(`${p}.value`, 'number');
      // X = 0 is a value; R, Rn, Xn must be > 0 (the model's rule)
      else if (p === 'x' ? n < 0 : n <= 0) err(`${p}.value`, p === 'x' ? 'nonNegative' : 'positive');
      else num = n;
    }
    let ref: number | undefined;
    if (RESISTANCE.has(p)) {
      const t = parseNumber(v.referenceTempC);
      if (t !== undefined) {
        if (!Number.isFinite(t)) err(`${p}.referenceTempC`, 'number');
        else if (t < -40 || t > 250) err(`${p}.referenceTempC`, 'range');
        else ref = t;
      }
    }
    const own = v.ownSource ? sourceOf(v.sourceName, v.sourceReference, v.sourcePage, v.sourceTable) : {};
    if (v.status !== 'unverified') {
      if (n === undefined) err(`${p}.status`, 'verifiedNeedsValue');
      else if (!hasAny(own) && !hasAny(typeSource)) err(`${p}.status`, 'verifiedNeedsSource');
    }
    const verification: Verification = {
      status: v.status,
      ...(trimmed(v.verifiedBy) ? { by: v.verifiedBy.trim() } : {}),
      ...(trimmed(v.verifiedOn) ? { on: v.verifiedOn.trim() } : {}),
      ...(v.verificationNote !== undefined ? { note: v.verificationNote } : {}),
    };
    return {
      ...(num !== undefined ? { value: num } : {}),
      unit: 'ohm/km',
      basis: RESISTANCE.has(p) ? (v.basis as ResistanceBasis) : 'ac-50hz',
      ...(ref !== undefined ? { referenceTempC: ref } : {}),
      ...(v.conversion ? { conversion: v.conversion } : {}),
      ...(hasAny(own) ? { source: own } : {}),
      verification,
    } as ElectricalValue;
  };
  const values = Object.fromEntries(ELECTRICAL_PROPERTIES.map((p) => [p, value(p)])) as Record<ElectricalProperty, ElectricalValue>;
  if (errors.length || phaseConductors === undefined || neutralConductors === undefined || !f.construction) return { errors };

  const data: CableTypeData = {
    name: f.name.trim(),
    ...(trimmed(f.description) ? { description: f.description.trim() } : {}),
    construction: f.construction,
    phaseConductors, neutralConductors,
    phase: { ...(f.phaseMaterial ? { material: f.phaseMaterial } : {}), ...(phaseSection !== undefined ? { sectionMm2: phaseSection } : {}) },
    ...(hasNeutral ? { neutral: { ...(f.neutralMaterial ? { material: f.neutralMaterial } : {}), ...(neutralSection !== undefined ? { sectionMm2: neutralSection } : {}) } } : {}),
    r: values.r as CableTypeData['r'], x: values.x as CableTypeData['x'], rn: values.rn as CableTypeData['rn'], xn: values.xn as CableTypeData['xn'],
    source: typeSource,
  };
  return { errors: [], data };
};

// ---------- what a save does ----------

const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if ((v as Record<string, unknown>)[k] !== undefined) o[k] = canon((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
};
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const valuePart = (v: ElectricalValue) => ({ value: v.value, unit: v.unit, basis: v.basis, referenceTempC: v.referenceTempC, conversion: v.conversion, source: v.source });

export interface EditPlan {
  /** the edit for the library (one new revision), or undefined when no data changed */
  edit?: CableTypeEdit;
  /** values whose data changed: the library resets their verification to unverified */
  reset: ElectricalProperty[];
  /** the verifications the person chose that differ from what the edit leaves (one revision each) */
  verify: { property: ElectricalProperty; verification: Verification }[];
  /** new revisions this save writes */
  revisions: number;
}

/**
 * How a save of `next` over `prev` goes through the library: one edit for the data (the library resets
 * the verification of every changed value), then one verification revision for each value whose chosen
 * verification differs from what the edit leaves. Nothing changed → no revision.
 */
export const planEdit = (prev: CableTypeRevision, next: CableTypeData): EditPlan => {
  const edit: CableTypeEdit = {};
  if (next.name !== prev.name) edit.name = next.name;
  if (!same(next.description, prev.description)) (edit as Record<string, unknown>).description = next.description ?? null;
  if (next.construction !== prev.construction) edit.construction = next.construction;
  if (next.phaseConductors !== prev.phaseConductors) edit.phaseConductors = next.phaseConductors;
  if (next.neutralConductors !== prev.neutralConductors) edit.neutralConductors = next.neutralConductors;
  if (!same(next.phase, prev.phase)) edit.phase = next.phase;
  if (!same(next.neutral, prev.neutral)) edit.neutral = next.neutral ?? null;
  if (!same(next.source, prev.source)) edit.source = next.source;
  const reset: ElectricalProperty[] = [];
  const verify: EditPlan['verify'] = [];
  for (const p of ELECTRICAL_PROPERTIES) {
    const changed = !same(valuePart(prev[p]), valuePart(next[p]));
    if (changed) {
      const { verification: _v, ...rest } = next[p];
      edit[p] = rest as never;
      reset.push(p);
    }
    const after = changed ? { status: 'unverified' } : prev[p].verification;
    if (!same(after, next[p].verification)) verify.push({ property: p, verification: next[p].verification });
  }
  const hasEdit = Object.keys(edit).length > 0;
  return { ...(hasEdit ? { edit } : {}), reset, verify, revisions: (hasEdit ? 1 : 0) + verify.length };
};

/** draft or complete, with what is missing (the model's own rule; complete is not verified) */
export const formCompleteness = (data: CableTypeData) => cableTypeCompleteness(data);
