// Stage B: the cable type domain — pure functions (no clock, no storage, no UI).
// The time and the id are always given by the caller.
//
// Rules:
//  - every field stays editable at any time; an edit writes a NEW revision, the previous ones are kept;
//  - an edit resets to 'unverified' only the electrical values it changed; the others keep theirs;
//  - verification is metadata: it never locks a field;
//  - R, X, RN, XN are independent: nothing is ever copied from one to another, nothing is invented;
//  - a project keeps the exact revision it used (a snapshot); a newer revision is applied only by an
//    explicit call (upgradeSpanCableType), never by reading the library;
//  - values are stored exactly as entered: no thermal correction anywhere in the library, the snapshot
//    or a revision. A resistance without a stated reference temperature has the thermal basis
//    'unspecified' and is used as it is (thermalBasis).

import type { SpanProps } from '../types/drawing';
import {
  ELECTRICAL_PROPERTIES,
  type CableTypeData, type CableTypeHistory, type CableTypeOverrides, type CableTypeRevision,
  type ElectricalProperty, type ElectricalValue, type SpanCableType, type Verification, type VerificationStatus,
} from '../types/cableType';

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
/** a stable form for comparison: keys sorted, undefined left out */
const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if ((v as Record<string, unknown>)[k] !== undefined) o[k] = canon((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
};

const DATA_KEYS: readonly (keyof CableTypeData)[] = [
  'name', 'description', 'construction', 'phaseConductors', 'neutralConductors', 'phase', 'neutral',
  'r', 'x', 'rn', 'xn', 'source',
];
const isElectrical = (k: string): k is ElectricalProperty => (ELECTRICAL_PROPERTIES as readonly string[]).includes(k);
/** the part of a value that carries its meaning (verification excluded) */
const valuePart = (v: ElectricalValue | undefined) =>
  (v ? { value: v.value, unit: v.unit, basis: v.basis, referenceTempC: v.referenceTempC, conversion: v.conversion, source: v.source } : undefined);

/**
 * The thermal basis of a resistance as the source states it — recorded, never assumed:
 * 'unspecified' when no reference temperature is stated (the value is then used as entered).
 * A missing reference temperature does not make a value incomplete, provisional or doubtful.
 */
export const thermalBasis = (v: ElectricalValue): { referenceTempC: number } | 'unspecified' =>
  typeof v.referenceTempC === 'number' && Number.isFinite(v.referenceTempC) ? { referenceTempC: v.referenceTempC } : 'unspecified';

export const latestRevision = (h: CableTypeHistory): CableTypeRevision => h.revisions[h.revisions.length - 1];
export const findRevision = (h: CableTypeHistory, revision: number): CableTypeRevision | undefined => h.revisions.find((r) => r.revision === revision);

/** a field changed between two revisions: '<field>' or '<property>.verification' */
export type CableTypeChange = keyof CableTypeData | `${ElectricalProperty}.verification`;

/** what differs between two revisions (for the explicit update of a project, shown first) */
export const diffCableTypes = (a: CableTypeData, b: CableTypeData): CableTypeChange[] => {
  const out: CableTypeChange[] = [];
  for (const k of DATA_KEYS) {
    if (isElectrical(k)) {
      if (!same(valuePart(a[k]), valuePart(b[k]))) out.push(k);
      if (!same(a[k]?.verification, b[k]?.verification)) out.push(`${k}.verification`);
    } else if (!same(a[k], b[k])) out.push(k);
  }
  return out;
};

const pickData = (r: CableTypeData): CableTypeData => {
  const o = {} as Record<string, unknown>;
  for (const k of DATA_KEYS) if (r[k] !== undefined) o[k] = clone(r[k]);
  return o as unknown as CableTypeData;
};

// ---------- completeness ----------

export type CableTypeMissing =
  | 'name' | 'phase-conductors' | 'phase-material' | 'phase-section'
  | 'neutral-material' | 'neutral-section'
  | 'r' | 'x' | 'rn' | 'xn' | 'source';

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * A draft can be saved with anything missing. It is complete only when every value its construction
 * needs is there: RN and XN are needed when the cable has a neutral. A missing value stays missing —
 * the calculation then decides what it blocks (E2: the neutral values only where the neutral is needed).
 */
export const cableTypeCompleteness = (d: CableTypeData): { complete: boolean; missing: CableTypeMissing[] } => {
  const missing: CableTypeMissing[] = [];
  if (!d.name?.trim()) missing.push('name');
  if (!(Number.isInteger(d.phaseConductors) && d.phaseConductors >= 1)) missing.push('phase-conductors');
  if (!d.phase?.material) missing.push('phase-material');
  if (!pos(d.phase?.sectionMm2)) missing.push('phase-section');
  const hasNeutral = d.neutralConductors >= 1;
  if (hasNeutral && !d.neutral?.material) missing.push('neutral-material');
  if (hasNeutral && !pos(d.neutral?.sectionMm2)) missing.push('neutral-section');
  if (!pos(d.r?.value)) missing.push('r');
  // X = 0 is an entered value (not a missing one)
  if (!(pos(d.x?.value) || d.x?.value === 0)) missing.push('x');
  if (hasNeutral && !pos(d.rn?.value)) missing.push('rn');
  if (hasNeutral && !pos(d.xn?.value)) missing.push('xn');
  // a resistance whose reference temperature is not stated is complete as it is (its thermal basis is 'unspecified')
  if (!d.source?.name?.trim() && !d.source?.reference?.trim()) missing.push('source');
  return { complete: missing.length === 0, missing };
};

// ---------- library: create, edit, verify (each write is a new revision) ----------

export interface RevisionMeta { now: number; by?: string; note?: string }

export const createCableType = (id: string, data: CableTypeData, meta: RevisionMeta): CableTypeHistory => ({
  id,
  revisions: [{
    ...pickData(data), id, revision: 1, typeCreatedAt: meta.now, revisionCreatedAt: meta.now,
    ...(meta.by ? { createdBy: meta.by } : {}), ...(meta.note ? { changeNote: meta.note } : {}),
  }],
});

/** an edit of the data; the verification of a value is set with setCableTypeVerification */
export type CableTypeEdit =
  Partial<Omit<CableTypeData, ElectricalProperty | 'neutral'>>
  & { neutral?: CableTypeData['neutral'] | null }
  & Partial<Record<ElectricalProperty, Omit<ElectricalValue, 'verification'> | null>>;

const UNVERIFIED: Verification = { status: 'unverified' };

/**
 * A new revision with the edit applied. An electrical value whose value, unit, basis, reference
 * temperature, conversion request or source changed is reset to 'unverified'. Unchanged values keep
 * their verification. Nothing is converted here: values are stored exactly as entered. `null` removes a
 * value or the neutral spec. Nothing changed → the same history (no new revision).
 */
export const editCableType = (h: CableTypeHistory, edit: CableTypeEdit, meta: RevisionMeta): { history: CableTypeHistory; changes: CableTypeChange[] } => {
  const prev = latestRevision(h);
  const next = pickData(prev) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(edit)) {
    if (!(DATA_KEYS as readonly string[]).includes(k)) continue;
    if (isElectrical(k)) {
      const old = prev[k];
      if (v === null) next[k] = { unit: old.unit, basis: old.basis, verification: UNVERIFIED };
      else if (v !== undefined) next[k] = { ...clone(v as object), verification: clone(old.verification) };
    } else if (v === null) delete next[k];
    else if (v !== undefined) next[k] = clone(v);
  }
  const data = next as unknown as CableTypeData;
  for (const p of ELECTRICAL_PROPERTIES)
    if (!same(valuePart(prev[p]), valuePart(data[p]))) data[p] = { ...data[p], verification: { ...UNVERIFIED } } as never;
  const changes = diffCableTypes(prev, data);
  if (!changes.length) return { history: h, changes };
  return { history: appendRevision(h, data, meta), changes };
};

/** a new revision changing only the verification of one value (no field is ever locked by it) */
export const setCableTypeVerification = (h: CableTypeHistory, property: ElectricalProperty, verification: Verification, meta: RevisionMeta): { history: CableTypeHistory; changes: CableTypeChange[] } => {
  const prev = latestRevision(h);
  const data = pickData(prev);
  data[property] = { ...data[property], verification: clone(verification) } as never;
  const changes = diffCableTypes(prev, data);
  if (!changes.length) return { history: h, changes };
  return { history: appendRevision(h, data, meta), changes };
};

const appendRevision = (h: CableTypeHistory, data: CableTypeData, meta: RevisionMeta): CableTypeHistory => {
  const prev = latestRevision(h);
  return {
    id: h.id,
    revisions: [...h.revisions, {
      ...data, id: h.id, revision: prev.revision + 1, typeCreatedAt: prev.typeCreatedAt, revisionCreatedAt: meta.now,
      ...(meta.by ? { createdBy: meta.by } : {}), ...(meta.note ? { changeNote: meta.note } : {}),
    }],
  };
};

// ---------- projects: reference + exact snapshot + project-specific overrides ----------

/** the span uses this exact revision: a full copy is kept in the project */
export const assignCableType = (props: SpanProps, revision: CableTypeRevision, now?: number): SpanProps => ({
  ...props,
  cableType: { typeId: revision.id, revision: revision.revision, snapshot: clone(revision), ...(now !== undefined ? { assignedAt: now } : {}) },
});

/** a project-specific value (with its own source and verification); undefined removes the override */
export const setCableTypeOverride = (props: SpanProps, property: ElectricalProperty, value: ElectricalValue | undefined): SpanProps => {
  const ct = props.cableType;
  if (!ct) throw new Error('setCableTypeOverride: the span has no cable type');
  const overrides: CableTypeOverrides = { ...clone(ct.overrides ?? {}) };
  if (value === undefined) delete overrides[property];
  else overrides[property] = clone(value) as never;
  const { overrides: _o, ...rest } = ct;
  return { ...props, cableType: Object.keys(overrides).length ? { ...rest, overrides } : rest };
};

/** the data used for the span: the snapshot with the project's overrides (the snapshot itself is not changed) */
export const effectiveCableType = (ct: SpanCableType): { data: CableTypeRevision; overridden: ElectricalProperty[] } => {
  const data = clone(ct.snapshot);
  const overridden: ElectricalProperty[] = [];
  for (const p of ELECTRICAL_PROPERTIES) {
    const o = ct.overrides?.[p];
    if (o) { data[p] = clone(o) as never; overridden.push(p); }
  }
  return { data, overridden };
};

/** a newer revision exists in the library (it is NOT applied) */
export const cableTypeUpdateAvailable = (ct: SpanCableType, h: CableTypeHistory): CableTypeRevision | undefined => {
  const last = latestRevision(h);
  return h.id === ct.typeId && last.revision > ct.revision ? last : undefined;
};

/**
 * The explicit update of a span to another revision (a future user action, after the diff is shown).
 * The project's overrides are kept as they are.
 */
export const upgradeSpanCableType = (props: SpanProps, to: CableTypeRevision, now?: number): { props: SpanProps; changes: CableTypeChange[] } => {
  const ct = props.cableType;
  if (!ct) throw new Error('upgradeSpanCableType: the span has no cable type');
  if (to.id !== ct.typeId) throw new Error('upgradeSpanCableType: another cable type');
  const changes = diffCableTypes(ct.snapshot, to);
  const next = assignCableType(props, to, now);
  return { props: ct.overrides ? { ...next, cableType: { ...next.cableType!, overrides: clone(ct.overrides) } } : next, changes };
};

// ---------- identity and merge (C0) ----------

/** the electrical identity of a span's cable type: type, revision, the exact snapshot and the overrides
 *  (not when it was assigned). 'none' for a span without one. */
export const cableTypeIdentity = (ct: SpanCableType | undefined): string =>
  ct ? JSON.stringify(canon({ typeId: ct.typeId, revision: ct.revision, snapshot: ct.snapshot, overrides: ct.overrides ?? {} })) : 'none';
export const sameCableType = (a: SpanCableType | undefined, b: SpanCableType | undefined): boolean => cableTypeIdentity(a) === cableTypeIdentity(b);

/**
 * A merge of spans that is not resolved for the cable type: the original records kept in mergedFrom
 * do not all have the same cable type, and at least one of them has one. Nothing is chosen for it:
 * E2 does not calculate such a span until a cable type is chosen for it (Stage C). Spans without any
 * cable type are never in conflict here (their merge behaves as before).
 */
export const cableTypeMergeConflict = (p: Pick<SpanProps, 'mergedFrom'> | undefined): boolean => {
  const recs = p?.mergedFrom;
  if (!recs?.length || !recs.some((r) => r?.cableType)) return false;
  return new Set(recs.map((r) => (r ? cableTypeIdentity(r.cableType) : 'no-record'))).size > 1;
};

// ---------- shape checks (reading a file or the store; never throw, never repair) ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const STATUSES: ReadonlySet<VerificationStatus> = new Set(['unverified', 'checked', 'approved']);

const sourceProblem = (s: unknown): string | null =>
  !isObj(s) ? 'not an object' : (['name', 'reference', 'page', 'table'] as const).find((k) => !optStr(s[k])) ?? null;
const valueProblem = (v: unknown, resistance: boolean, zeroAllowed = false): string | null => {
  if (!isObj(v)) return 'not an object';
  if (v.value !== undefined && !(typeof v.value === 'number' && Number.isFinite(v.value) && (v.value > 0 || (zeroAllowed && v.value === 0)))) return 'value';
  if (v.unit !== 'ohm/km') return 'unit';
  if (resistance ? !['ac', 'dc', 'unspecified'].includes(v.basis as string) : v.basis !== 'ac-50hz') return 'basis';
  // the resistance reference temperature and the conversion request belong to resistances only
  if (v.referenceTempC !== undefined && !(resistance && typeof v.referenceTempC === 'number' && Number.isFinite(v.referenceTempC) && v.referenceTempC >= -40 && v.referenceTempC <= 250)) return 'referenceTempC';
  if (v.conversion !== undefined && !(resistance && v.conversion === 'dc20-to-conductor-temp')) return 'conversion';
  if (v.source !== undefined && sourceProblem(v.source)) return 'source';
  if (!isObj(v.verification) || !STATUSES.has(v.verification.status as VerificationStatus)) return 'verification';
  if (!(['by', 'on', 'note'] as const).every((k) => optStr((v.verification as Record<string, unknown>)[k]))) return 'verification';
  return null;
};

/** null when the record has the shape of a revision, else the first field found wrong */
export const cableTypeRevisionProblem = (r: unknown): string | null => {
  if (!isObj(r)) return 'not an object';
  if (typeof r.id !== 'string' || !r.id) return 'id';
  if (!(Number.isInteger(r.revision) && (r.revision as number) >= 1)) return 'revision';
  if (typeof r.name !== 'string') return 'name';
  if (!optStr(r.description)) return 'description';
  if (!['abc', 'underground', 'bare', 'other'].includes(r.construction as string)) return 'construction';
  if (!(Number.isInteger(r.phaseConductors) && (r.phaseConductors as number) >= 0)) return 'phaseConductors';
  if (!(Number.isInteger(r.neutralConductors) && (r.neutralConductors as number) >= 0)) return 'neutralConductors';
  const conductor = (c: unknown, materials: string[]) => isObj(c) && (c.material === undefined || materials.includes(c.material as string))
    && (c.sectionMm2 === undefined || (typeof c.sectionMm2 === 'number' && Number.isFinite(c.sectionMm2) && c.sectionMm2 > 0));
  if (!conductor(r.phase, ['al', 'cu'])) return 'phase';
  if (r.neutral !== undefined && !conductor(r.neutral, ['al', 'cu', 'alloy'])) return 'neutral';
  for (const p of ELECTRICAL_PROPERTIES) { const b = valueProblem(r[p], p === 'r' || p === 'rn', p === 'x'); if (b) return `${p}.${b}`; }
  if (sourceProblem(r.source)) return 'source';
  if (typeof r.typeCreatedAt !== 'number' || typeof r.revisionCreatedAt !== 'number') return 'createdAt';
  if (!optStr(r.createdBy) || !optStr(r.changeNote)) return 'createdBy';
  return null;
};

export const cableTypeHistoryProblem = (h: unknown): string | null => {
  if (!isObj(h) || typeof h.id !== 'string' || !h.id) return 'id';
  if (!Array.isArray(h.revisions) || !h.revisions.length) return 'revisions';
  for (let i = 0; i < h.revisions.length; i++) {
    const r = h.revisions[i];
    const b = cableTypeRevisionProblem(r);
    if (b) return `revisions[${i}].${b}`;
    if ((r as CableTypeRevision).id !== h.id || (r as CableTypeRevision).revision !== i + 1) return `revisions[${i}].revision`;
  }
  return null;
};

/** a span's cable type reference: null when well formed */
export const spanCableTypeProblem = (ct: unknown): string | null => {
  if (!isObj(ct)) return 'cableType';
  if (typeof ct.typeId !== 'string' || !ct.typeId) return 'cableType.typeId';
  if (!(Number.isInteger(ct.revision) && (ct.revision as number) >= 1)) return 'cableType.revision';
  const b = cableTypeRevisionProblem(ct.snapshot);
  if (b) return `cableType.snapshot.${b}`;
  const s = ct.snapshot as CableTypeRevision;
  if (s.id !== ct.typeId || s.revision !== ct.revision) return 'cableType.snapshot';
  if (ct.overrides !== undefined) {
    if (!isObj(ct.overrides)) return 'cableType.overrides';
    for (const [k, v] of Object.entries(ct.overrides)) {
      if (!isElectrical(k)) return `cableType.overrides.${k}`;
      const vb = valueProblem(v, k === 'r' || k === 'rn', k === 'x');
      if (vb) return `cableType.overrides.${k}.${vb}`;
    }
  }
  if (ct.assignedAt !== undefined && typeof ct.assignedAt !== 'number') return 'cableType.assignedAt';
  return null;
};
