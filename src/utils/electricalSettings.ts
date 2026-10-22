import type { ElectricalSettings } from '../types/drawing';

/**
 * Starting values of the voltage-drop settings. 230/400 V is the nominal LV
 * system; 5 % and 218 V / 380 V are reference starting points to be checked
 * against the standard that applies to the project — they are editable and are
 * not presented as a legal limit. The conductor temperature has no default: the
 * calculation reports it as missing (where the IEC table needs it) until entered.
 * The power factor is not stored by default either; see effectiveSettings.
 */
export const DEFAULT_ELECTRICAL: ElectricalSettings = {
  phaseVoltage: 230,
  lineVoltage: 400,
  limitPercent: 5,
  nearLimitFraction: 0.8,
  minPhaseVoltage: 218,
  minLineVoltage: 380,
  singlePhaseMode: 'worst',
  loadModel: 'constant-current',
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, ok: (n: number) => boolean) => (typeof v === 'number' && Number.isFinite(v) && ok(v) ? v : undefined);

type Checks = { [K in keyof ElectricalSettings]-?: (v: unknown) => ElectricalSettings[K] | undefined };
const CHECKS: Checks = {
  phaseVoltage: (v) => num(v, (n) => n > 0),
  lineVoltage: (v) => num(v, (n) => n > 0),
  limitPercent: (v) => num(v, (n) => n > 0 && n < 100),
  nearLimitFraction: (v) => num(v, (n) => n > 0 && n <= 1),
  minPhaseVoltage: (v) => num(v, (n) => n > 0),
  minLineVoltage: (v) => num(v, (n) => n > 0),
  powerFactor: (v) => num(v, (n) => n > 0 && n <= 1),
  conductorTempC: (v) => num(v, (n) => n >= -40 && n <= 250),
  singlePhaseMode: (v) => (v === 'worst' || v === 'balanced' ? v : undefined),
  loadModel: (v) => (v === 'constant-current' || v === 'constant-power' ? v : undefined),
};

/** Settings read from a file / draft. Missing fields get defaults; invalid ones are reported. */
export const readElectricalSettings = (raw: unknown): { settings: ElectricalSettings; invalid: string[] } => {
  if (raw === undefined || raw === null) return { settings: { ...DEFAULT_ELECTRICAL }, invalid: [] };
  if (!isObj(raw)) return { settings: { ...DEFAULT_ELECTRICAL }, invalid: ['electrical'] };
  const settings: ElectricalSettings = { ...DEFAULT_ELECTRICAL };
  const invalid: string[] = [];
  for (const key of Object.keys(CHECKS) as (keyof ElectricalSettings)[]) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const v = CHECKS[key](raw[key]);
    if (v === undefined) invalid.push(key);
    else (settings as unknown as Record<string, unknown>)[key] = v;
  }
  return { settings, invalid };
};

/**
 * Power factor used when a project has none (Stage 7.13). It is applied only when
 * calculating (effectiveSettings) and shown as «افتراضي»; it is never written into
 * the project, so opening a project changes neither the saved project nor the
 * autosave draft. A power factor saved in the project is always used as it is.
 */
export const DEFAULT_POWER_FACTOR = 0.9;
export const isPowerFactorDefault = (s: ElectricalSettings) => s.powerFactor === undefined;
/** The settings the calculation uses: the stored ones, with the default power factor when none is stored. */
export const effectiveSettings = (s: ElectricalSettings): ElectricalSettings =>
  isPowerFactorDefault(s) ? { ...s, powerFactor: DEFAULT_POWER_FACTOR } : s;

export const sameSettings = (a: ElectricalSettings, b: ElectricalSettings) =>
  a === b || (Object.keys(CHECKS) as (keyof ElectricalSettings)[]).every((k) => a[k] === b[k]);
