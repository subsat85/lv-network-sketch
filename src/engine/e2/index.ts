// E2 calculation core, phase 1: one entry point. Not imported by the app.
//   runStudyE2(doc, { inputOrigin, catalogue, catalogueSelection, allocation })
// inputOrigin is required and never guessed from the document:
//   'legacy-project' — a project of the app: a span without parallel takes np = 1, provisional (D10);
//   'e2-input'       — a new E2 input: a span without parallel has no np.

import type { ElectricalSettings } from '../../types/drawing';
import { effectiveSettings, isPowerFactorDefault } from '../../utils/electricalSettings';
import type { DataIssue } from '../issues';
import type { ProjectDocument } from '../model';
import { ASSUMPTIONS } from './assumptions';
import { buildNetwork } from './build';
import { CABLE_ENTRIES, CATALOGUE_DOCUMENTS } from './catalogue/entries';
import type { CatalogueSelection, InputOrigin } from './catalogue/resolve';
import { validateCatalogue, type CableEntry, type Catalogue, type CatalogueError } from './catalogue/schema';
import type { CircuitResult, LoadModel, SolveSettings } from './model';
import { EMPTY_ALLOCATION, type PhaseAllocation } from './phases';
import type { AssumptionId } from './quantity';
import { solveCircuit } from './sweep';
import { E2_ENGINE_VERSION } from './version';

export interface E2Options {
  inputOrigin: InputOrigin;
  /** default: the app's catalogue (catalogue/entries.ts, empty) */
  catalogue?: Catalogue;
  /** span key (`cableId#index`) or cable id → catalogue entry */
  catalogueSelection?: Readonly<Record<string, CatalogueSelection>>;
  allocation?: PhaseAllocation;
}

export interface E2StudyResult {
  engineVersion: string;
  inputOrigin: InputOrigin;
  settings: ElectricalSettings;
  settingsProvenance: { powerFactor: 'project' | 'default' };
  assumptions: { id: AssumptionId; text: string; ref: string }[];
  /** catalogue entries refused by the schema (not used) */
  catalogueErrors: CatalogueError[];
  issues: DataIssue[];
  circuits: CircuitResult[];
}

const ORIGINS: ReadonlySet<string> = new Set<InputOrigin>(['legacy-project', 'e2-input']);

export const runStudyE2 = (doc: ProjectDocument, options: E2Options): E2StudyResult => {
  if (!options || !ORIGINS.has(options.inputOrigin)) throw new Error('runStudyE2: inputOrigin is required (legacy-project | e2-input)');
  const stored = doc.electrical as ElectricalSettings;
  const settings = effectiveSettings(stored);
  const powerFactorDefaulted = isPowerFactorDefault(stored);
  const catalogue: Catalogue = options.catalogue ?? { documents: CATALOGUE_DOCUMENTS, entries: CABLE_ENTRIES };
  const catalogueErrors = validateCatalogue(catalogue);
  // an entry with any schema problem is refused whole: none of its values is used (P3-3)
  const refused = new Map<string, string>();
  for (const e of catalogueErrors) refused.set(e.entryId, [refused.get(e.entryId), `${e.field}:${e.problem}`].filter(Boolean).join(', '));
  const entries = new Map<string, CableEntry>(catalogue.entries.filter((e) => !refused.has(e.id)).map((e) => [e.id, e]));

  const { circuits, issues } = buildNetwork({
    doc, settings, powerFactorDefaulted, origin: options.inputOrigin, entries, refused,
    selection: options.catalogueSelection ?? {}, allocation: options.allocation ?? EMPTY_ALLOCATION,
  });
  const solve: SolveSettings = {
    Vph: settings.phaseVoltage, pf: settings.powerFactor!, loadModel: (settings.loadModel ?? 'constant-current') as LoadModel,
    limitPercent: settings.limitPercent, nearLimitFraction: settings.nearLimitFraction,
    minPhaseVoltage: settings.minPhaseVoltage, minLineVoltage: settings.minLineVoltage,
    inputs: [
      { name: 'Vph', element: 'settings', provenance: 'project', value: settings.phaseVoltage },
      { name: 'pf', element: 'settings', provenance: powerFactorDefaulted ? 'default' : 'project', value: settings.powerFactor! },
    ],
  };
  return {
    engineVersion: E2_ENGINE_VERSION,
    inputOrigin: options.inputOrigin,
    settings,
    settingsProvenance: { powerFactor: powerFactorDefaulted ? 'default' : 'project' },
    assumptions: (Object.keys(ASSUMPTIONS) as AssumptionId[]).map((id) => ({ id, ...ASSUMPTIONS[id] })),
    catalogueErrors,
    issues,
    circuits: circuits.map((c) => solveCircuit(c, solve)),
  };
};

export { solveCircuit } from './sweep';
export type * from './model';
export type * from './quantity';
export type { Catalogue, CableEntry, CatalogueDocument, Measured } from './catalogue/schema';
export type { CatalogueSelection, InputOrigin } from './catalogue/resolve';
export type { PhaseAllocation } from './phases';
