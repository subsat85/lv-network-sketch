// E2: cable catalogue schema. Every number carries its unit, its measuring conditions
// and the page it was read from; a value the catalogue does not print is left out
// (never 0, never copied from another field: xn is not x, rnAc is not rAc).
// The neutral is never taken from the phase (final decision, Stage A): an entry without its own
// rnAc / rnDc20 / xn has no neutral impedance, and what needs it is not calculated.

export interface CatalogueDocument {
  id: string;
  manufacturer: string;
  /** catalogue / data-sheet title as printed */
  title: string;
  edition?: string;
  url?: string;
  /** ISO date the copy was obtained */
  retrievedOn?: string;
}
export interface SourceRef { documentId: string; page: string; table?: string }

export interface Measured {
  value: number;
  unit: 'ohm/km' | 'mm2' | 'A' | 'degC' | 'kV';
  /** conditions as printed: 'DC, 20 degC', 'AC, 90 degC, 50 Hz', 'trefoil, touching' */
  conditions: string;
  source: SourceRef;
}

export interface CableEntry {
  id: string;
  manufacturer: string;
  /** type as printed */
  designation: string;
  standard?: string;
  cableKind: 'abc' | 'underground' | 'bare' | 'other';
  /** cores as printed, e.g. '3x70 + 54.6' */
  construction: string;
  phase: { material: 'al' | 'cu'; sectionMm2: number };
  neutral?: { material: 'al' | 'cu' | 'alloy'; sectionMm2: number };
  ratedVoltage?: Measured;
  rDc20?: Measured;
  rAc?: Measured;
  /** phase reactance at 50 Hz (positive sequence) */
  x?: Measured;
  rnDc20?: Measured;
  rnAc?: Measured;
  /** neutral reactance: only when printed */
  xn?: Measured;
  r0?: Measured;
  x0?: Measured;
  ampacity?: Measured;
  verification: { status: 'unverified' | 'checked' | 'approved'; by?: string; on?: string; note?: string };
}

export interface Catalogue { documents: readonly CatalogueDocument[]; entries: readonly CableEntry[] }

export interface CatalogueError { entryId: string; field: string; problem: 'no-source' | 'unknown-document' | 'no-page' | 'unit' | 'value' | 'construction' | 'duplicate-id' }

const OHM_FIELDS = ['rDc20', 'rAc', 'x', 'rnDc20', 'rnAc', 'xn', 'r0', 'x0'] as const;
const OTHER_FIELDS = { ratedVoltage: 'kV', ampacity: 'A' } as const;

/** The schema rules. An entry with an error is not usable. */
export const validateCatalogue = (cat: Catalogue): CatalogueError[] => {
  const errors: CatalogueError[] = [];
  const docs = new Set(cat.documents.map((d) => d.id));
  const seen = new Set<string>();
  const check = (e: CableEntry, field: string, m: Measured | undefined, unit: Measured['unit']) => {
    if (m === undefined) return;
    if (!m.source) { errors.push({ entryId: e.id, field, problem: 'no-source' }); return; }
    if (!docs.has(m.source.documentId)) errors.push({ entryId: e.id, field, problem: 'unknown-document' });
    if (!m.source.page || !m.source.page.trim()) errors.push({ entryId: e.id, field, problem: 'no-page' });
    if (m.unit !== unit) errors.push({ entryId: e.id, field, problem: 'unit' });
    if (!(Number.isFinite(m.value) && m.value > 0)) errors.push({ entryId: e.id, field, problem: 'value' });
  };
  for (const e of cat.entries) {
    if (seen.has(e.id)) errors.push({ entryId: e.id, field: 'id', problem: 'duplicate-id' });
    seen.add(e.id);
    for (const f of OHM_FIELDS) check(e, f, e[f], 'ohm/km');
    for (const [f, u] of Object.entries(OTHER_FIELDS)) check(e, f, e[f as keyof typeof OTHER_FIELDS], u);
    // the construction as printed must name the phase section, and the neutral section when there is one
    const nums = (e.construction.match(/\d+(?:[.,]\d+)?/g) ?? []).map((s) => Number(s.replace(',', '.')));
    if (!nums.includes(e.phase.sectionMm2)) errors.push({ entryId: e.id, field: 'construction', problem: 'construction' });
    if (e.neutral && !nums.includes(e.neutral.sectionMm2)) errors.push({ entryId: e.id, field: 'construction', problem: 'construction' });
  }
  return errors;
};
