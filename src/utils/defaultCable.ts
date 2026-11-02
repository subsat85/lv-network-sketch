import type { CableElement, DrawingElement, SpanProps } from '../types/drawing';
import type { CableTypeRevision } from '../types/cableType';
import { spanCableTypeProblem } from './cableTypeModel';
import { linkSpanCable } from './spanCableLink';
import { spanAt, withSpanProps } from './spanModel';

// The application's default cable (replaces the old default cable values and the company / IEC
// tables). One exact revision of one library cable type, with a full snapshot taken when it was
// chosen: the default never follows the library by itself (a newer revision is only reported), and
// a default whose record is not in the library is not used — nothing else is put in its place.
//
// The default is applied only by explicit actions: a newly drawn span with no properties, the
// «fill with the default cable» button, and the import of an old drawing (planImport). A span that
// already has a library cable is never changed by any of them. R / X / Rn / Xn are never copied into
// the span's own (E1) fields, and no value is derived from a material or a cross-section.

export interface DefaultCable {
  typeId: string;
  revision: number;
  /** the exact revision chosen as the default (a full copy) */
  snapshot: CableTypeRevision;
  /** when it was chosen (ms) */
  selectedAt: number;
}

/** a stored default as read back (never repaired) */
export const defaultCableProblem = (d: unknown): string | null => {
  if (!d || typeof d !== 'object') return 'not an object';
  const r = d as Partial<DefaultCable>;
  if (typeof r.selectedAt !== 'number' || !Number.isFinite(r.selectedAt)) return 'selectedAt';
  return spanCableTypeProblem({ typeId: r.typeId, revision: r.revision, snapshot: r.snapshot });
};

/** the default as the app sees it, against the library's current list */
export type DefaultCableState =
  | { kind: 'none' }
  | { kind: 'ok'; cable: DefaultCable }
  /** a newer revision is in the library: shown only, the chosen revision is still the default */
  | { kind: 'newer'; cable: DefaultCable; latest: number }
  /** the record (or that revision) is not in this device's library: not used */
  | { kind: 'missing'; cable: DefaultCable }
  /** the stored default could not be read: not used */
  | { kind: 'unreadable' };

export const defaultCableState = (cable: DefaultCable | undefined, types: readonly CableTypeRevision[]): DefaultCableState => {
  if (!cable) return { kind: 'none' };
  const current = types.find((t) => t.id === cable.typeId);
  if (!current || current.revision < cable.revision) return { kind: 'missing', cable };
  return current.revision > cable.revision ? { kind: 'newer', cable, latest: current.revision } : { kind: 'ok', cable };
};

/** the default that may be applied now (its own snapshot), or undefined */
export const usableDefault = (s: DefaultCableState): DefaultCable | undefined => (s.kind === 'ok' || s.kind === 'newer' ? s.cable : undefined);

/**
 * The span linked to the default cable (its snapshot, never the latest revision). The span's
 * supply system and parallel count are kept; when the span has none, the circuit defaults
 * 3-phase 4-wire and one complete set are written (these describe the circuit, not the cable).
 */
export const linkDefaultCable = (stored: SpanProps | undefined, poles: [string, string], d: DefaultCable, now?: number): SpanProps => {
  const base: SpanProps = { ...(stored ?? { poles }), poles };
  if (base.system === undefined) base.system = '3ph4w';
  if (base.parallel === undefined) base.parallel = 1;
  return linkSpanCable(base, poles, d.snapshot, now);
};

/** a newly drawn span of `cable` (index) with no properties gets the default; otherwise the same cable */
export const withDefaultCableSpan = (cable: CableElement, index: number, d: DefaultCable | undefined, now?: number): CableElement => {
  if (!d || index < 0 || index >= cable.poleIds.length - 1) return cable;
  const { id, props } = spanAt(cable, index);
  if (!id || props) return cable;
  return withSpanProps(cable, id, linkDefaultCable(undefined, [cable.poleIds[index], cable.poleIds[index + 1]], d, now));
};

export interface DefaultFillPlan {
  updates: { id: string; changes: Partial<CableElement> }[];
  /** spans that get the default (they have no library cable) */
  spans: number;
}

/** what «fill with the default cable» changes: every span without a library cable (nothing changed here) */
export const planDefaultFill = (elements: readonly { type: string }[], d: DefaultCable | undefined, now?: number): DefaultFillPlan => {
  const plan: DefaultFillPlan = { updates: [], spans: 0 };
  if (!d) return plan;
  for (const el of elements) {
    if (el.type !== 'cable') continue;
    let cable = el as CableElement;
    for (let i = 0; i < cable.poleIds.length - 1; i++) {
      const { id, props } = spanAt(cable, i);
      if (!id || props?.cableType) continue;
      cable = withSpanProps(cable, id, linkDefaultCable(props, [cable.poleIds[i], cable.poleIds[i + 1]], d, now));
      plan.spans++;
    }
    if (cable !== el) plan.updates.push({ id: cable.id, changes: { spanProps: cable.spanProps } });
  }
  return plan;
};

/** spans that have no library cable (what «fill with the default cable» would link) */
export const spansWithoutLibraryCable = (elements: readonly { type: string }[]): number => {
  let n = 0;
  for (const el of elements) {
    if (el.type !== 'cable') continue;
    const c = el as CableElement;
    for (let i = 0; i < c.poleIds.length - 1; i++) { const { id, props } = spanAt(c, i); if (id && !props?.cableType) n++; }
  }
  return n;
};

// ---------- importing a drawing file ----------

/** the old cable data of a span record (everything but the pole pair, the supply system and parallel) */
const OLD_CABLE_FIELDS = ['cableKind', 'material', 'crossSectionMm2', 'neutralCrossSectionMm2', 'neutralMaterial', 'rOhmPerKm', 'xOhmPerKm', 'rNeutralOhmPerKm', 'dataSource', 'legacyV2', 'inherited', 'review', 'mergedFrom'] as const;

const records = (elements: readonly DrawingElement[]) =>
  elements.flatMap((e) => (e.type === 'cable' ? Object.values((e as CableElement).spanProps ?? {}) : []));
const hasSnapshot = (p: SpanProps) => !!p.cableType || !!p.mergedFrom?.some((m) => m?.cableType);
const hasOldCableData = (p: SpanProps) => OLD_CABLE_FIELDS.some((k) => p[k] !== undefined && p[k] !== '');

/**
 * The kind of an imported file, decided for the whole file:
 * - 'new': at least one span carries a library cable snapshot → imported exactly as it is;
 * - 'old': no snapshot anywhere, and some span has the old cable data → its cable data is cleared;
 * - 'none': no cable data at all → imported as it is.
 */
export type ImportKind = 'new' | 'old' | 'none';
export const importKind = (elements: readonly DrawingElement[]): ImportKind => {
  const rs = records(elements);
  if (rs.some(hasSnapshot)) return 'new';
  return rs.some(hasOldCableData) ? 'old' : 'none';
};

export interface ImportCableReport {
  kind: ImportKind;
  /** span records whose old cable data was cleared */
  cleared: number;
  /** spans linked to the default cable */
  linked: number;
  /** an old drawing imported without a usable default: its spans are left without cable data */
  needDefault: boolean;
}

/**
 * The elements of an imported file with its cable data prepared (old drawings only). Only span
 * records change: the poles, cables, span ids, consumers, labels and every position stay the same.
 */
export const prepareImportedCables = (elements: DrawingElement[], d: DefaultCable | undefined, now?: number): { elements: DrawingElement[]; report: ImportCableReport } => {
  const kind = importKind(elements);
  if (kind !== 'old') return { elements, report: { kind, cleared: 0, linked: 0, needDefault: false } };
  let cleared = 0, linked = 0;
  const out = elements.map((e) => {
    if (e.type !== 'cable') return e;
    let cable = e as CableElement;
    for (let i = 0; i < cable.poleIds.length - 1; i++) {
      const { id, props } = spanAt(cable, i);
      if (!id) continue;
      const poles: [string, string] = [cable.poleIds[i], cable.poleIds[i + 1]];
      let kept: SpanProps | undefined;
      if (props) {
        if (hasOldCableData(props)) cleared++;
        kept = { poles, ...(props.system !== undefined ? { system: props.system } : {}), ...(props.parallel !== undefined ? { parallel: props.parallel } : {}) };
      }
      const next = d ? linkDefaultCable(kept, poles, d, now) : kept && (kept.system !== undefined || kept.parallel !== undefined) ? kept : undefined;
      if (d) linked++;
      if (next !== props) cable = withSpanProps(cable, id, next);
    }
    // records of spans no longer in the cable (orphans) carry old cable data too
    const orphans = Object.keys(cable.spanProps ?? {}).filter((sid) => !(cable.spanIds ?? []).includes(sid));
    for (const sid of orphans) { cleared++; cable = withSpanProps(cable, sid, undefined); }
    return cable;
  });
  return { elements: out, report: { kind, cleared, linked, needDefault: !d } };
};
