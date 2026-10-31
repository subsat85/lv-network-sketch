// Calculation core (Stage E1): the solver interface. A solver receives the document,
// the settings, the network and the scenario, and returns its results with the origin
// of every value. Later stages add solvers behind this same interface.

import type { ElectricalSettings } from '../types/drawing';
import type { Network } from '../utils/network';
import type { VoltageDropResult } from '../utils/voltageDrop';
import type { ElectricalNetwork, ProjectDocument, ScenarioId, SolverOutput } from './model';

export interface SolverInput {
  doc: ProjectDocument;
  settings: ElectricalSettings;
  network: ElectricalNetwork;
  /** the existing engine's network the ElectricalNetwork was read from (passed on, not rebuilt) */
  legacyNetwork: Network;
  scenario: ScenarioId;
}

export type SolverId = 'legacy-scalar';

export interface Solver {
  id: SolverId;
  supports(scenario: ScenarioId): boolean;
  solve(input: SolverInput): SolverOutput & { legacy: VoltageDropResult };
}
