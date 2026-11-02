// Stage B: a cable type defined once, kept in the global cable library (IndexedDB) with every
// revision, and used by spans of any project through a reference + an exact snapshot.
//
// The four electrical values R, X, RN, XN are independent: none is ever taken from another
// (RN is never R, XN is never X). A value that is not known is left out — never 0, never copied.
// Verification is metadata only: it never locks a field.

export type CableConstruction = 'abc' | 'underground' | 'bare' | 'other';
export type ElectricalProperty = 'r' | 'x' | 'rn' | 'xn';
export const ELECTRICAL_PROPERTIES: readonly ElectricalProperty[] = ['r', 'x', 'rn', 'xn'];

export type VerificationStatus = 'unverified' | 'checked' | 'approved';
export interface Verification {
  status: VerificationStatus;
  by?: string;
  /** ISO date */
  on?: string;
  note?: string;
}

/** where a value comes from */
export interface ValueSource {
  /** e.g. the manufacturer or the report */
  name?: string;
  /** document / data-sheet title, edition, URL… */
  reference?: string;
  page?: string;
  table?: string;
}

/**
 * What the source states about a value. A resistance is stated as AC, as DC, or without saying
 * ('unspecified'); a reactance is AC 50 Hz.
 */
export type ResistanceBasis = 'ac' | 'dc' | 'unspecified';
export type ReactanceBasis = 'ac-50hz';

/**
 * A conversion request kept as data on a value (a DC value at 20 °C to a conductor temperature, F8 /
 * IEC 60228). It is stored and kept with the value, but E2 never carries it out in its calculation path:
 * the value is used as entered and the request is reported. Never from the ambient temperature.
 */
export type ResistanceConversion = 'dc20-to-conductor-temp';

export interface ElectricalValue<B extends ResistanceBasis | ReactanceBasis = ResistanceBasis | ReactanceBasis> {
  /** Ω/km, as entered from the source; undefined = not known yet (a draft) */
  value?: number;
  unit: 'ohm/km';
  basis: B;
  /**
   * Resistances only: the resistance reference temperature the source states for this value, °C.
   * Not the ambient temperature and not the conductor temperature. Left out = not stated: the
   * thermal basis is 'unspecified' and the value is used as entered (no temperature is assumed).
   */
  referenceTempC?: number;
  /** Resistances only: a conversion request, kept as data, never carried out by E2 (see ResistanceConversion) */
  conversion?: ResistanceConversion;
  /** this value's own source; when left out, the type's source applies */
  source?: ValueSource;
  verification: Verification;
}

export interface ConductorSpec<M extends string> {
  material?: M;
  sectionMm2?: number;
}

/** what a person edits */
export interface CableTypeData {
  name: string;
  description?: string;
  construction: CableConstruction;
  /** conductors of one cable assembly (ABC: 3 phases + 1 neutral). `parallel` on a span = complete assemblies */
  phaseConductors: number;
  neutralConductors: number;
  phase: ConductorSpec<'al' | 'cu'>;
  /** left out when neutralConductors = 0 */
  neutral?: ConductorSpec<'al' | 'cu' | 'alloy'>;
  r: ElectricalValue<ResistanceBasis>;
  x: ElectricalValue<ReactanceBasis>;
  rn: ElectricalValue<ResistanceBasis>;
  xn: ElectricalValue<ReactanceBasis>;
  /** the source of the type as a whole */
  source: ValueSource;
}

/** one saved revision: never changed after it is written */
export interface CableTypeRevision extends CableTypeData {
  id: string;
  /** 1, 2, 3… */
  revision: number;
  /** when the type was first created (ms since epoch) */
  typeCreatedAt: number;
  /** when this revision was written (ms since epoch) */
  revisionCreatedAt: number;
  createdBy?: string;
  changeNote?: string;
}

/** a cable type with every revision, oldest first; the last one is the current one */
export interface CableTypeHistory {
  id: string;
  revisions: CableTypeRevision[];
}

/** a project-specific value replacing one of the snapshot's four values (the library is not changed) */
export type CableTypeOverrides = Partial<{
  r: ElectricalValue<ResistanceBasis>;
  x: ElectricalValue<ReactanceBasis>;
  rn: ElectricalValue<ResistanceBasis>;
  xn: ElectricalValue<ReactanceBasis>;
}>;

/**
 * Stored on a span (SpanProps.cableType): the type and the exact revision used, a full copy of that
 * revision, and the project's own overrides. A newer library revision is never applied by itself.
 */
export interface SpanCableType {
  typeId: string;
  revision: number;
  snapshot: CableTypeRevision;
  overrides?: CableTypeOverrides;
  /** when this revision was assigned to the span (ms since epoch) */
  assignedAt?: number;
}
