// E2: the impedance data of one span, each value with where it comes from.
// Order (first one present wins), design section 5:
//   R  — the span's R  → catalogue rAc  → catalogue rDc20 or IEC 60228 (DC 20 °C, F8) → missing
//   X  — the span's X  → catalogue x    → missing (also at pf = 1)
//   RN — the span's RN → catalogue rnAc → catalogue rnDc20 (al / cu, F8) → IEC 60228 for the span's
//        al / cu neutral (F8) → missing
//   XN — catalogue xn → missing
// Stage A (final decision): the neutral is never taken from the phase — RN is never R, XN is never X.
// Each of the four values is resolved on its own; a missing RN or XN is reported (neutral:resistance-missing,
// neutral:reactance-missing) and blocks only what needs the neutral (the sweep decides: an unbalanced circuit).
// F8 (D9) is used only for al / cu with the operating temperature of the settings; an alloy neutral has no
// documented conversion: its DC value is not used, nothing replaces it.
// np and nN (D10): nN is never derived from np, nor from a value that is not there — except for a
// documented ABC cable, whose construction gives both: one cable = one complete set (np = nN = 1,
// 'cable-construction'); `parallel` = n complete ABC sets (np = nN = n), each with its own neutral.
// The company table (COMPANY_RX_OHM_PER_KM) is not used (D5).

import type { ElectricalSettings, SpanProps } from '../../../types/drawing';
import { ALPHA_20, R20_OHM_PER_KM } from '../../../data/conductors';
import type { DataIssue } from '../../issues';
import type { InputName, InputProvenance, InputRef, UnavailableReason, WarningCode } from '../quantity';
import type { CableEntry, Measured } from './schema';

export type InputOrigin = 'legacy-project' | 'e2-input';
export interface CatalogueSelection { entryId: string; completeSets?: number }

export interface Resolved { value?: number; reason?: UnavailableReason; input?: InputRef; warnings: WarningCode[] }
export interface ResolvedSpan {
  r: Resolved; x: Resolved; rn: Resolved; xn: Resolved;
  np: Resolved; nN: Resolved;
  /** the neutral conductor is documented (catalogue construction, section + material, or RN with a source) */
  neutralDocumented: boolean;
  issues: DataIssue[];
}

const TABLE_KINDS: ReadonlySet<string> = new Set(['abc', 'underground']);

/** a documented ABC cable is one complete set: its three phases and its neutral */
export const CABLE_CONSTRUCTION_RULE = 'One ABC cable assembly is one complete set: three phase conductors and one neutral conductor (not parallel conductors).';
const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

const ok = (name: InputName, element: string, value: number, provenance: InputProvenance, warnings: WarningCode[], ref?: string): Resolved =>
  ({ value, input: { name, element, provenance, value, ...(ref ? { ref } : {}) }, warnings });
const no = (reason: UnavailableReason): Resolved => ({ reason, warnings: [] });

const fromEntry = (name: InputName, key: string, e: CableEntry, m: Measured, extra: WarningCode[] = [], value = m.value): Resolved =>
  ok(name, key, value, 'catalogue', [...extra, ...(e.verification.status === 'unverified' ? (['catalogue-unverified'] as const) : [])], `${e.id} p.${m.source.page}${m.source.table ? ` ${m.source.table}` : ''} (${m.conditions})`);

/** F8: a DC value at 20 °C to the operating temperature */
const atTemp = (r20: number, material: 'al' | 'cu', t: number) => r20 * (1 + ALPHA_20[material] * (t - 20));

export const resolveSpan = (
  key: string,
  props: SpanProps | undefined,
  entry: CableEntry | undefined,
  selection: CatalogueSelection | undefined,
  settings: Pick<ElectricalSettings, 'conductorTempC'>,
  origin: InputOrigin,
): ResolvedSpan => {
  const T = settings.conductorTempC;
  const sourced = !!props?.dataSource?.trim();
  // a documented ABC cable with its neutral: from the selected catalogue entry, or typed on the span
  // (used only for its construction: np = nN — never for its impedances)
  const spanNeutralDocumented = (isPos(props?.neutralCrossSectionMm2) && !!props?.neutralMaterial) || (isPos(props?.rNeutralOhmPerKm) && sourced);
  const abc = entry
    ? entry.cableKind === 'abc' && !!entry.neutral
    : props?.cableKind === 'abc' && props.system === '3ph4w' && spanNeutralDocumented;
  const own: WarningCode[] = sourced ? [] : ['source-unknown'];
  const tableKind = !!props?.cableKind && TABLE_KINDS.has(props.cableKind);
  const issues: DataIssue[] = [];

  // R
  let r: Resolved;
  if (isPos(props?.rOhmPerKm)) r = ok('R', key, props!.rOhmPerKm, 'project', own);
  else if (entry?.rAc) r = fromEntry('R', key, entry, entry.rAc);
  else if (entry?.rDc20) r = T === undefined ? no('settings-missing') : fromEntry('R', key, entry, entry.rDc20, ['dc-resistance-used'], atTemp(entry.rDc20.value, entry.phase.material, T));
  else if (props?.material && isPos(props.crossSectionMm2) && tableKind) {
    const r20 = R20_OHM_PER_KM[props.material]?.[props.crossSectionMm2];
    r = r20 === undefined ? no('impedance-missing') : T === undefined ? no('settings-missing') : ok('R', key, atTemp(r20, props.material, T), 'iec-table', ['dc-resistance-used'], `IEC 60228 ${props.material} ${props.crossSectionMm2} mm2`);
  } else r = no('impedance-missing');

  // X
  let x: Resolved;
  if (props?.xOhmPerKm !== undefined && Number.isFinite(props.xOhmPerKm) && props.xOhmPerKm >= 0) x = ok('X', key, props.xOhmPerKm, 'project', own);
  else if (entry?.x) x = fromEntry('X', key, entry, entry.x);
  else x = no('impedance-missing');

  // the neutral
  const entryWithoutNeutral = !!entry && !entry.neutral;
  const neutralDocumented = !!entry?.neutral || spanNeutralDocumented;
  let rn: Resolved;
  if (isPos(props?.rNeutralOhmPerKm)) rn = ok('RN', key, props!.rNeutralOhmPerKm, 'project', own);
  else if (entryWithoutNeutral) rn = no('neutral-conductor-missing');
  else if (entry?.rnAc) rn = fromEntry('RN', key, entry, entry.rnAc);
  else if (entry?.rnDc20 && entry.neutral && entry.neutral.material !== 'alloy') {
    const m = entry.neutral.material;
    rn = T === undefined ? no('settings-missing') : fromEntry('RN', key, entry, entry.rnDc20, ['dc-resistance-used'], atTemp(entry.rnDc20.value, m, T));
  } else if (entry?.rnDc20 && entry.neutral?.material === 'alloy') {
    // a DC value of an alloy neutral: no documented conversion to the operating temperature (no α for
    // alloy) — not used, and nothing is put in its place: an explicit RN is needed
    rn = no('neutral-impedance-missing');
  } else if ((props?.neutralMaterial === 'al' || props?.neutralMaterial === 'cu') && isPos(props.neutralCrossSectionMm2) && tableKind) {
    const m = props.neutralMaterial;
    const r20 = R20_OHM_PER_KM[m]?.[props.neutralCrossSectionMm2!];
    rn = r20 === undefined ? no('neutral-impedance-missing') : T === undefined ? no('settings-missing') : ok('RN', key, atTemp(r20, m, T), 'iec-table', ['dc-resistance-used'], `IEC 60228 ${m} ${props.neutralCrossSectionMm2} mm2`);
  } else rn = no('neutral-impedance-missing');
  // XN: only an explicit value (never X)
  const xn: Resolved = entryWithoutNeutral ? no('neutral-conductor-missing') : entry?.xn ? fromEntry('XN', key, entry, entry.xn) : no('neutral-impedance-missing');
  // the exact neutral value that is missing, each on its own (reported; it blocks only what needs the neutral)
  if (rn.reason === 'neutral-impedance-missing') issues.push({ code: 'neutral:resistance-missing', severity: 'reported', target: { kind: 'span', id: key }, params: { property: 'RN' } });
  if (xn.reason === 'neutral-impedance-missing') issues.push({ code: 'neutral:reactance-missing', severity: 'reported', target: { kind: 'span', id: key }, params: { property: 'XN' } });

  // np (D10)
  const parallel = props?.parallel;
  const parallelValid = parallel !== undefined && Number.isInteger(parallel) && parallel >= 1;
  let np: Resolved;
  if (abc && parallel === undefined) {
    // Q-N3: one documented ABC cable = one complete set — no parallel count is needed, nothing is defaulted
    np = ok('np', key, 1, 'cable-construction', [], CABLE_CONSTRUCTION_RULE);
  } else if (parallel !== undefined) {
    np = parallelValid ? ok('np', key, parallel, 'project', []) : no('parallel-invalid');
    // F5: an invalid parallel is never corrected; it is reported and blocks the span
    if (!parallelValid) issues.push({ code: 'parallel-invalid', severity: 'blocks', target: { kind: 'span', id: key }, params: { value: String(parallel) } });
  }
  else if (origin === 'legacy-project') {
    np = ok('np', key, 1, 'legacy-default', ['phase-parallel-default'], 'legacy project without parallel: 1, as the existing engine');
    issues.push({ code: 'setting-default:phase-parallel', severity: 'reported', target: { kind: 'span', id: key }, params: { value: 1 } });
  } else np = no('phase-parallel-unknown');

  // nN (D10): its own rules, never np
  let nN: Resolved;
  if (abc && (parallel === undefined || parallelValid)) {
    // Q-N3 / Q-N4: complete ABC sets, each with its three phases and its neutral: nN = np (never from the four conductors)
    const n = parallel ?? 1;
    nN = selection?.completeSets !== undefined && selection.completeSets !== n
      ? no('parallel-conflict')
      : ok('nN', key, n, 'cable-construction', [], n === 1 ? CABLE_CONSTRUCTION_RULE : `${n} complete ABC sets in parallel, each with its three phases and its neutral (parallel = ${n})`);
  } else if (entryWithoutNeutral) nN = no('neutral-conductor-missing');
  else if (!neutralDocumented) nN = no('neutral-impedance-missing');
  else if (selection?.completeSets !== undefined) {
    const n = selection.completeSets;
    nN = parallelValid && Number.isInteger(n) && n >= 1 && n === parallel ? ok('nN', key, n, 'catalogue', [], `${selection.entryId}: ${n} complete sets`) : no('parallel-conflict');
  } else if (parallel === 1) nN = ok('nN', key, 1, 'project', [], 'parallel = 1 with a documented neutral');
  else if (parallel !== undefined && !parallelValid) nN = no('parallel-invalid');
  else nN = no('neutral-parallel-unknown');

  return { r, x, rn, xn, np, nN, neutralDocumented, issues };
};
