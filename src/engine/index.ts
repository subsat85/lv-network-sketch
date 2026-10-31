// Calculation core (Stage E1): one entry point. Not imported by the app in E1.
//   runStudy(doc)            — the settings as the app uses them (effectiveSettings, like useVoltageDrop)
//   studyWith(doc, settings) — the settings exactly as given (as the golden tests do)
// Only the scenario the project uses (singlePhaseMode) is calculated in E1.

import type { ElectricalSettings } from '../types/drawing';
import { effectiveSettings, isPowerFactorDefault } from '../utils/electricalSettings';
import type { VoltageDropResult } from '../utils/voltageDrop';
import { toNetwork } from './adapter';
import { fromLegacy, type DataIssue } from './issues';
import type { ElectricalNetwork, ProjectDocument, ScenarioId, SolverOutput } from './model';
import type { Solver, SolverId } from './solver';
import { legacyScalarSolver } from './solvers/legacy';
import { ENGINE_VERSION } from './version';

export interface StudyResult {
  engineVersion: string;
  /** the settings the calculation used */
  settings: ElectricalSettings;
  /**
   * Where each defaultable setting comes from: 'project' = as stored / as given;
   * 'default' = not stored, the app's default was used for the calculation only
   * (powerFactor: DEFAULT_POWER_FACTOR, by runStudy through effectiveSettings).
   */
  settingsProvenance: { powerFactor: 'project' | 'default' | 'missing' };
  network: ElectricalNetwork;
  issues: DataIssue[];
  /** the project's scenario, from singlePhaseMode */
  approved: ScenarioId;
  /** E1: the approved scenario only */
  scenarios: Partial<Record<ScenarioId, SolverOutput>>;
  /** the existing engine's result, as it is (read only: it may refer to objects of the document) */
  legacy: VoltageDropResult;
}

const SOLVERS: Record<SolverId, Solver> = { 'legacy-scalar': legacyScalarSolver };
export const getSolver = (id: SolverId): Solver => SOLVERS[id];

export const approvedScenario = (s: ElectricalSettings): ScenarioId => (s.singlePhaseMode === 'balanced' ? 'balanced' : 'worst');

const study = (doc: ProjectDocument, settings: ElectricalSettings, powerFactorDefaulted: boolean): StudyResult => {
  const { network, legacy: legacyNetwork } = toNetwork(doc, settings);
  const approved = approvedScenario(settings);
  const { legacy, ...output } = getSolver('legacy-scalar').solve({ doc, settings, network, legacyNetwork, scenario: approved });
  const issues = fromLegacy(legacy);
  if (powerFactorDefaulted) issues.unshift({ code: 'setting-default:powerFactor', severity: 'reported', target: { kind: 'settings', id: 'powerFactor' }, params: { value: settings.powerFactor! } });
  const settingsProvenance: StudyResult['settingsProvenance'] = { powerFactor: powerFactorDefaulted ? 'default' : settings.powerFactor === undefined ? 'missing' : 'project' };
  return { engineVersion: ENGINE_VERSION, settings, settingsProvenance, network, issues, approved, scenarios: { [approved]: output }, legacy };
};

/** The settings exactly as given: nothing is defaulted (a missing power factor stays missing). */
export const studyWith = (doc: ProjectDocument, settings: ElectricalSettings): StudyResult => study(doc, settings, false);

/** As the app calculates: effectiveSettings (the default power factor when none is stored), and says so. */
export const runStudy = (doc: ProjectDocument): StudyResult => {
  const stored = doc.electrical as ElectricalSettings;
  return study(doc, effectiveSettings(stored), isPowerFactorDefault(stored));
};

export type { DataIssue } from './issues';
export type * from './model';
