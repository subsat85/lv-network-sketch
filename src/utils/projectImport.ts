import { useDrawingStore } from '../store/drawingStore';
import { parseProjectFile, ProjectExportData } from './projectSerialization';
import { getProjectsMeta, saveProject, Project, ProjectMetadata } from './projectStorage';

// Importing a project file, in two steps so nothing is written before the user decides:
//   1. planImport  — parse + validate the whole file and look for a saved project with
//                    the same id. Reads only; touches neither the canvas nor storage.
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
}

export type PlanResult = { ok: true; plan: ImportPlan } | { ok: false; message: string };
export type ApplyResult =
  | { ok: true; status: 'opened' | 'replaced' | 'copied'; projectId: string | null; projectName: string }
  | { ok: true; status: 'cancelled' }
  | { ok: false; message: string };

export interface ImportDeps {
  getMeta: () => Promise<ProjectMetadata[]>;
  save: (p: Project) => Promise<void>;
  now: () => number;
  newId: () => string;
}
const defaultDeps: ImportDeps = {
  getMeta: getProjectsMeta,
  save: saveProject,
  now: Date.now,
  newId: () => crypto.randomUUID(),
};

export const DEFAULT_IMPORT_NAME = 'Imported Project';
export const copyName = (name: string) => `${name} (نسخة)`;

export const planImport = async (json: string, deps: Partial<ImportDeps> = {}): Promise<PlanResult> => {
  const d = { ...defaultDeps, ...deps };
  const parsed = parseProjectFile(json);
  if (!parsed.ok) {
    return { ok: false, message: 'لم يتم الاستيراد، الملف غير صالح:\n• ' + (parsed as { errors: string[] }).errors.join('\n• ') + '\nلم يتغيّر الرسم الحالي ولا المشاريع المحفوظة.' };
  }
  const data = parsed.data;
  const fileId = data.metadata?.id ?? null;
  const name = (data.metadata?.name || '').trim() || DEFAULT_IMPORT_NAME;
  let conflict: ProjectMetadata | null = null;
  if (fileId) {
    try {
      conflict = (await d.getMeta()).find((p) => p.id === fileId) ?? null;
    } catch {
      return { ok: false, message: 'تعذّر قراءة المشاريع المحفوظة للتحقق من الملف. لم يتغيّر أي شيء.' };
    }
  }
  return { ok: true, plan: { data, fileId, name, conflict } };
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

  if (choice === 'open') {
    if (plan.conflict) return { ok: false, message: 'يوجد مشروع محفوظ بنفس المعرّف؛ اختر الاستبدال أو الحفظ كنسخة.' };
    loadIntoCanvas(plan.data, plan.fileId, plan.name);
    return { ok: true, status: 'opened', projectId: plan.fileId, projectName: plan.name };
  }

  if (choice === 'replace' && !plan.conflict) return { ok: false, message: 'لا يوجد مشروع محفوظ لاستبداله.' };

  const now = d.now();
  const project: Project = choice === 'replace'
    ? { id: plan.conflict!.id, name: plan.name, createdAt: plan.conflict!.createdAt, updatedAt: now, data: projectData(plan.data) }
    : { id: d.newId(), name: copyName(plan.name), createdAt: now, updatedAt: now, data: projectData(plan.data) };
  try {
    await d.save(project);
  } catch (e) {
    console.error('Import save failed', e);
    return { ok: false, message: 'تعذّر حفظ المشروع المستورد على الجهاز، فلم يتم الاستيراد. لم يتغيّر الرسم الحالي ولا المشاريع المحفوظة.' };
  }
  loadIntoCanvas(plan.data, project.id, project.name);
  return { ok: true, status: choice === 'replace' ? 'replaced' : 'copied', projectId: project.id, projectName: project.name };
};
