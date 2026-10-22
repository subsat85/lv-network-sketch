import type { ConductorMaterial } from '../types/drawing';

// ---------------------------------------------------------------------------
// Conductor resistance table.
//
// Source: IEC 60228 (Conductors of insulated cables), Table 2 — class 2
// (stranded) conductors: MAXIMUM DC resistance at 20 °C, Ω/km, plain annealed
// copper and aluminium. Values checked against the manufacturer reproduction at
// https://www.bayka.de/en/service/technical-information/conductor-resistance
//
// What these values are and are not:
//   - DC resistance at 20 °C, the maximum the standard allows (a real conductor
//     is at or below it, so the result errs on the safe side);
//   - corrected to the conductor operating temperature entered in the settings
//     with R_T = R_20 · [1 + α (T − 20)], α from IEC 60287-1-1 Table 1
//     (copper 3.93·10⁻³ /K, aluminium 4.03·10⁻³ /K);
//   - the AC (skin / proximity) increase is NOT included. For the sizes in the
//     table (≤ 300 mm²) at 50 Hz it is small (of the order of 1 % or less at the
//     larger sizes) but it is not zero; enter R per span when an approved AC value
//     is available;
//   - aluminium alloy (AAAC) messenger / neutral conductors of ABC cables are
//     not plain aluminium: their resistance must be entered per span;
//   - there is NO reactance here: reactance depends on the cable construction
//     and spacing, not on the cross-section, so it must be entered per span from
//     the cable data sheet / approved report.
// ---------------------------------------------------------------------------

export const CONDUCTOR_TABLE_SOURCE = 'IEC 60228, Table 2 (class 2), max. DC resistance at 20 °C';
export const ALPHA_SOURCE = 'IEC 60287-1-1, Table 1';

export const R20_OHM_PER_KM: Record<ConductorMaterial, Record<number, number>> = {
  cu: { 1.5: 12.1, 2.5: 7.41, 4: 4.61, 6: 3.08, 10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268, 95: 0.193, 120: 0.153, 150: 0.124, 185: 0.0991, 240: 0.0754, 300: 0.0601 },
  al: { 10: 3.08, 16: 1.91, 25: 1.20, 35: 0.868, 50: 0.641, 70: 0.443, 95: 0.320, 120: 0.253, 150: 0.206, 185: 0.164, 240: 0.125, 300: 0.100 },
};

/** Temperature coefficient of resistance at 20 °C, 1/K */
export const ALPHA_20: Record<ConductorMaterial, number> = { cu: 0.00393, al: 0.00403 };

export const tableSections = (m: ConductorMaterial) => Object.keys(R20_OHM_PER_KM[m]).map(Number).sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// Company cable table (Stage 7.12): R and X in Ω/km per material and phase
// cross-section, as approved in the company's tables (values supplied by the
// user; not IEC values). They are written into a span as its R / X (and Rn for
// the neutral conductor of the same material and section) and used as they are:
// no temperature correction is applied to them.
// ---------------------------------------------------------------------------

export const COMPANY_TABLE_SOURCE = 'جدول الشركة';

export const COMPANY_RX_OHM_PER_KM: Record<ConductorMaterial, Record<number, { r: number; x: number }>> = {
  al: { 120: { r: 0.2415, x: 0.0716 }, 70: { r: 0.4126, x: 0.0754 }, 35: { r: 0.8242, x: 0.0846 }, 25: { r: 1.1536, x: 0.0838 }, 4: { r: 7.53, x: 0.107 }, 2.5: { r: 12.1, x: 0.11 }, 1.5: { r: 19.5, x: 0.115 } },
  cu: { 120: { r: 0.253, x: 0.095 }, 70: { r: 0.32, x: 0.095 }, 35: { r: 0.524, x: 0.095 }, 25: { r: 0.727, x: 0.095 }, 4: { r: 4.61, x: 0.107 }, 2.5: { r: 7.41, x: 0.11 }, 1.5: { r: 12.1, x: 0.115 } },
};

/** R and X of the company table for a material and cross-section, or null when that size is not in it. */
export const companyRX = (m: string | undefined, mm2: number | undefined): { r: number; x: number } | null =>
  (m === 'al' || m === 'cu') && mm2 !== undefined ? COMPANY_RX_OHM_PER_KM[m][mm2] ?? null : null;

export const companySections = (m: ConductorMaterial) => Object.keys(COMPANY_RX_OHM_PER_KM[m]).map(Number).sort((a, b) => a - b);

/** R at temperature T from the table, or null when the size is not in the table. */
export const tableResistance = (m: ConductorMaterial, mm2: number, tempC: number): number | null => {
  const r20 = R20_OHM_PER_KM[m]?.[mm2];
  if (r20 === undefined) return null;
  return r20 * (1 + ALPHA_20[m] * (tempC - 20));
};
