import { useDrawingStore } from '../store/drawingStore';
import { parseProjectFile, ProjectExportData } from './projectSerialization';
import { getProjectsMeta, saveProject, Project, ProjectMetadata } from './projectStorage';
import { t } from '../store/localeStore';
import { getCableLibrary } from '../store/cableLibraryStore';
import { importKind, prepareImportedCables, usableDefault, type DefaultCable, type ImportCableReport } from './defaultCable';
import { withLatestLibraryRevisions } from '../store/cableLibrarySync';
import type { DrawingElement } from '../types/drawing';

// Importing a project file, in two steps so nothing is written before the user decides:
//   1. planImport  — parse + validate the whole file and look for a saved project with
//                    the same id. Reads only; touches neither the canvas nor storage.
//                    The cable data of an OLD drawing (no library snapshot anywhere in the file,
//                    old cable values in it) is cleared here, and its spans are linked to the
//                    default cable when one is chosen (defaultCable.ts). A file with library
//                    snapshots is kept exactly as it is. Saved projects and the autosaved draft
//                    are never prepared this way: only a file being imported.
//   2. applyImport — carry out the user's choice. Storage is written first (one
//                    transaction); the canvas is replaced only after that succeeded,
//                    so a failure leaves both the drawing and the saved projects as they were.

export type ImportChoice =
  | 'open'     // no saved project with this id: open it (nothing is saved, as before)
  | 'replace'  // overwrite the saved project with the same id (after explicit confirmation)
  | 'copy'     // save as a new project with a new id
  | 'cancel';

export interface ImportPlan {
  data: ProjectExportData;
  fileId: string | null;
  name: string;
  conflict: ProjectMetadata | null; // saved project with the same id, if any
  /** what was done to the file's cable data (old drawings only) */
  cables: ImportCableReport;
}

export type PlanResult = { ok: true; plan: ImportPlan } | { ok: false; message: string };
export type ApplyResult =
  | { ok: true; status: 'opened' | 'replaced' | 'copied'; projectId: string | null; projectName: string; cables: ImportCableReport }
  | { ok: true; status: 'cancelled' }
  | { ok: false; message: string };

export interface ImportDeps {
  getMeta: () => Promise<ProjectMetadata[]>;
  save: (p: Project) => Promise<void>;
  now: () => number;
  newId: () => string;
  /** the default cable that may be applied now (undefined: none chosen, missing or unreadable) */
  defaultCable: () => Promise<DefaultCable | undefined>;
  /** the project's spans moved to the latest revisions of this device's library (cableLibrarySync.ts) */
  latestCables: (elements: DrawingElement[]) => Promise<DrawingElement[]>;
}
const appDefaultCable = async (): Promise<DefaultCable | undefined> => {
  const c = getCableLibrary();
  await c.load();
  return usableDefault(c.store.getState().defaultCable);
};
const defaultDeps: ImportDeps = {
  getMeta: getProjectsMeta,
  save: saveProject,
  now: Date.now,
  newId: () => crypto.randomUUID(),
  defaultCable: appDefaultCable,
  latestCables: async (elements) => (await withLatestLibraryRevisions(elements, undefined, Date.now())).elements,
};

export const DEFAULT_IMPORT_NAME = 'Imported Project';
export const copyName = (name: string) => `${name} (نسخة)`;

export const planImport = async (json: string, deps: Partial<ImportDeps> = {}): Promise<PlanResult> => {
  const d = { ...defaultDeps, ...deps };
  const parsed = parseProjectFile(json);
  if (!parsed.ok) {
    return { ok: false, message: t('dialogs.importInvalid') + '\n• ' + (parsed as { errors: string[] }).errors.join('\n• ') + '\n' + t('dialogs.importNothingChanged') };
  }
  // an old drawing: its cable data is cleared, its spans get the default cable (when there is one)
  let def: DefaultCable | undefined;
  if (importKind(parsed.data.elements) === 'old') {
    try { def = await d.defaultCable(); } catch { def = undefined; }
  }
  const prepared = prepareImportedCables(parsed.data.elements, def, d.now());
  const data = prepared.elements === parsed.data.elements ? parsed.data : { ...parsed.data, elements: prepared.elements };
  const fileId = data.metadata?.id ?? null;
  const name = (data.metadata?.name || '').trim() || DEFAULT_IMPORT_NAME;
  let conflict: ProjectMetadata | null = null;
  if (fileId) {
    try {
      conflict = (await d.getMeta()).find((p) => p.id === fileId) ?? null;
    } catch {
      return { ok: false, message: t('dialogs.importReadSaved') };
    }
  }
  return { ok: true, plan: { data, fileId, name, conflict, cables: prepared.report } };
};

const loadIntoCanvas = (data: ProjectExportData, id: string | null, name: string) => {
  const store = useDrawingStore.getState();
  store.loadProject({
    elements: data.elements,
    style: data.style,
    poleSizeScale: data.poleSizeScale,
    consumerVariant: data.consumerVariant,
    connectionDistances: data.connectionDistances,
    connectionLabelOffsets: data.connectionLabelOffsets,
    distanceTextScale: data.distanceTextScale,
    consumerSizeScale: data.consumerSizeScale,
    electrical: data.electrical,
    distanceFlags: data.distanceFlags,
  } as Parameters<typeof store.loadProject>[0]);
  store.setProjectInfo(id, name);
};

const projectData = (data: ProjectExportData): Project['data'] => ({
  elements: data.elements,
  style: data.style,
  poleSizeScale: data.poleSizeScale,
  distanceTextScale: data.distanceTextScale,
  consumerSizeScale: data.consumerSizeScale,
  consumerVariant: data.consumerVariant,
  connectionDistances: data.connectionDistances,
  connectionLabelOffsets: data.connectionLabelOffsets,
  electrical: data.electrical,
  distanceFlags: data.distanceFlags,
});

export const applyImport = async (plan: ImportPlan, choice: ImportChoice, deps: Partial<ImportDeps> = {}): Promise<ApplyResult> => {
  const d = { ...defaultDeps, ...deps };
  if (choice === 'cancel') return { ok: true, status: 'cancelled' };
  // opened (and saved) on the latest revisions of the library's cable types; as it is when it cannot be read
  let latest = plan.data.elements;
  try { latest = await d.latestCables(plan.data.elements); } catch { latest = plan.data.elements; }
  if (latest !== plan.data.elements) plan = { ...plan, data: { ...plan.data, elements: latest } };

  if (choice === 'open') {
    if (plan.conflict) return { ok: false, message: t('dialogs.importConflict') };
    loadIntoCanvas(plan.data, plan.fileId, plan.name);
    return { ok: true, status: 'opened', projectId: plan.fileId, projectName: plan.name, cables: plan.cables };
  }

  if (choice === 'replace' && !plan.conflict) return { ok: false, message: t('dialogs.importNoTarget') };

  const now = d.now();
  const project: Project = choice === 'replace'
    ? { id: plan.conflict!.id, name: plan.name, createdAt: plan.conflict!.createdAt, updatedAt: now, data: projectData(plan.data) }
    : { id: d.newId(), name: copyName(plan.name), createdAt: now, updatedAt: now, data: projectData(plan.data) };
  try {
    await d.save(project);
  } catch (e) {
    console.error('Import save failed', e);
    return { ok: false, message: t('dialogs.importSaveFailed') };
  }
  loadIntoCanvas(plan.data, project.id, project.name);
  return { ok: true, status: choice === 'replace' ? 'replaced' : 'copied', projectId: project.id, projectName: project.name, cables: plan.cables };
};
