import { get, set, del } from 'idb-keyval';
import { create } from 'zustand';
import { useDrawingStore } from '../store/drawingStore';
import { DrawingElement, DrawingStyle } from '../types/drawing';
import { META_KEY, ProjectData, ProjectMetadata } from './projectStorage';
import { readElectricalSettings } from './electricalSettings';
import { readDistanceFlags } from './distances';

// Automatic draft of the current drawing.
//
// - Stored under its own key; it never writes to the manually saved projects
//   (`projects_meta` / `project_<id>`) and never changes their ids.
// - Written after edits, debounced so a drag (one store update per pointer move)
//   becomes one write once the gesture settles; flushed immediately when the page
//   is hidden or closed.
// - Read-only towards the store's history: it never adds undo steps.
// - On startup the last valid draft is restored. A draft that is invalid, or that
//   made the app fail to render last time, is set aside and not restored.

export const DRAFT_KEY = 'autosave_draft_v1';
export const REJECTED_DRAFT_KEY = 'autosave_draft_v1_rejected';
export const DRAFT_VERSION = 1;
export const DEFAULT_DEBOUNCE_MS = 800;
const RESTORE_GUARD_KEY = 'lv_autosave_restore_pending';

export interface Draft {
  version: number;
  savedAt: number;
  projectId: string | null;
  projectName: string | null;
  data: Required<Omit<ProjectData, 'spanProps'>>;
}

export interface DraftStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export const idbDraftStorage: DraftStorage = { get, set, del };

// ---------- user-visible status (no success claims, only problems) ----------
type NoticeKind = 'error' | 'info';
interface AutosaveStatus {
  message: string | null;
  kind: NoticeKind | null;
  lastSavedAt: number | null;
  show: (kind: NoticeKind, message: string) => void;
  dismiss: () => void;
}
export const useAutosaveStatus = create<AutosaveStatus>((setS) => ({
  message: null,
  kind: null,
  lastSavedAt: null,
  show: (kind, message) => setS({ kind, message }),
  dismiss: () => setS({ kind: null, message: null }),
}));

export const MESSAGES = {
  quota: 'تعذّر الحفظ التلقائي: مساحة التخزين على الجهاز ممتلئة. احفظ عملك الآن بـ Export JSON.',
  writeFailed: 'تعذّر الحفظ التلقائي للمسودة. احفظ عملك الآن بـ Export JSON أو Save Current.',
  readFailed: 'تعذّر قراءة المسودة المحفوظة تلقائيًا. مشاريعك المحفوظة لم تتأثر.',
  invalid: 'المسودة المحفوظة تلقائيًا تالفة أو غير متوافقة، فلم تُستعد. مشاريعك المحفوظة لم تتأثر.',
  crashed: 'المسودة السابقة لم تُعرض بشكل صحيح، فبدأ التطبيق برسم فارغ. مشاريعك المحفوظة لم تتأثر.',
  detached: 'تمت استعادة المسودة كنسخة منفصلة، لأن المشروع المحفوظ المرتبط بها غير موجود أو أحدث منها. الحفظ سيُنشئ مشروعًا جديدًا.',
};

const isQuotaError = (e: unknown) => {
  const name = (e as { name?: string })?.name || '';
  const msg = String((e as { message?: string })?.message || '');
  return name === 'QuotaExceededError' || /quota/i.test(name) || /quota|exceed|space/i.test(msg);
};

// ---------- snapshot of the persisted part of the store ----------
type StoreState = ReturnType<typeof useDrawingStore.getState>;

const TRACKED = [
  'elements', 'style', 'poleSizeScale', 'distanceTextScale', 'consumerSizeScale', 'consumerVariant',
  'connectionDistances', 'connectionLabelOffsets', 'currentProjectId', 'currentProjectName', 'electrical', 'distanceFlags',
] as const;

const trackedChanged = (a: StoreState, b: StoreState) => TRACKED.some((k) => a[k] !== b[k]);

export const buildDraft = (s: StoreState, now = Date.now()): Draft => ({
  version: DRAFT_VERSION,
  savedAt: now,
  projectId: s.currentProjectId,
  projectName: s.currentProjectName,
  data: {
    elements: s.elements,
    style: s.style,
    poleSizeScale: s.poleSizeScale,
    distanceTextScale: s.distanceTextScale,
    consumerSizeScale: s.consumerSizeScale,
    consumerVariant: s.consumerVariant,
    connectionDistances: s.connectionDistances,
    connectionLabelOffsets: s.connectionLabelOffsets,
    electrical: s.electrical,
    distanceFlags: s.distanceFlags,
  },
});

// A blank canvas that is not linked to a saved project needs no draft.
const isBlank = (s: StoreState) => s.elements.length === 0 && !s.currentProjectId && !s.currentProjectName;

// ---------- validation (never throws) ----------
const ELEMENT_TYPES = new Set(['path', 'text', 'symbol', 'cable', 'consumer', 'arc', 'shape', 'transformer_table', 'cable_arc', 'jumper']);
const DEFAULT_STYLE: DrawingStyle = { strokeColor: '#000000', fillColor: 'transparent', strokeWidth: 2, fontSize: 16 };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

export type ValidateResult = { ok: true; draft: Draft } | { ok: false; reason: string };

export const validateDraft = (raw: unknown): ValidateResult => {
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  if (raw.version !== DRAFT_VERSION) return { ok: false, reason: `unsupported version ${String(raw.version)}` };
  if (!isNum(raw.savedAt)) return { ok: false, reason: 'missing savedAt' };
  const d = raw.data;
  if (!isObj(d) || !Array.isArray(d.elements)) return { ok: false, reason: 'missing elements' };
  for (const el of d.elements as unknown[]) {
    if (!isObj(el) || typeof el.id !== 'string' || !el.id || !ELEMENT_TYPES.has(el.type as string)) return { ok: false, reason: 'malformed element' };
    if (!isNum(el.x) || !isNum(el.y)) return { ok: false, reason: `element ${el.id} has no position` };
    if (el.type === 'cable' && (!Array.isArray(el.poleIds) || el.poleIds.some((p) => typeof p !== 'string'))) return { ok: false, reason: `cable ${el.id} has malformed poleIds` };
    if (el.type === 'consumer' && typeof el.poleId !== 'string') return { ok: false, reason: `consumer ${el.id} has no poleId` };
    if (el.type === 'path' && !Array.isArray(el.points)) return { ok: false, reason: `path ${el.id} has no points` };
  }
  if (!isStrOrNull(raw.projectId ?? null) || !isStrOrNull(raw.projectName ?? null)) return { ok: false, reason: 'malformed project info' };
  const style = isObj(d.style) ? { ...DEFAULT_STYLE, ...(d.style as Partial<DrawingStyle>) } : DEFAULT_STYLE;
  const distances: Record<string, string> = {};
  if (isObj(d.connectionDistances)) for (const [k, v] of Object.entries(d.connectionDistances)) if (typeof v === 'string') distances[k] = v;
  const offsets: Record<string, { x: number; y: number }> = {};
  if (isObj(d.connectionLabelOffsets)) for (const [k, v] of Object.entries(d.connectionLabelOffsets)) if (isObj(v) && isNum(v.x) && isNum(v.y)) offsets[k] = { x: v.x, y: v.y };
  return {
    ok: true,
    draft: {
      version: DRAFT_VERSION,
      savedAt: raw.savedAt,
      projectId: (raw.projectId as string | null) ?? null,
      projectName: (raw.projectName as string | null) ?? null,
      data: {
        elements: d.elements as DrawingElement[],
        style,
        poleSizeScale: isNum(d.poleSizeScale) ? d.poleSizeScale : 1,
        distanceTextScale: isNum(d.distanceTextScale) ? d.distanceTextScale : 1,
        consumerSizeScale: isNum(d.consumerSizeScale) ? d.consumerSizeScale : 1,
        consumerVariant: d.consumerVariant === 'square' ? 'square' : 'circle',
        connectionDistances: distances,
        connectionLabelOffsets: offsets,
        electrical: readElectricalSettings(d.electrical).settings,
        distanceFlags: readDistanceFlags(d.distanceFlags).flags,
      },
    },
  };
};

// ---------- crash guard: a draft that broke rendering is not restored again ----------
export interface RestoreGuard {
  get(): string | null;
  set(v: string): void;
  clear(): void;
}
export const localStorageGuard: RestoreGuard = {
  get: () => { try { return localStorage.getItem(RESTORE_GUARD_KEY); } catch { return null; } },
  set: (v) => { try { localStorage.setItem(RESTORE_GUARD_KEY, v); } catch { /* best effort */ } },
  clear: () => { try { localStorage.removeItem(RESTORE_GUARD_KEY); } catch { /* best effort */ } },
};

// Resolves true once the app has rendered something after the restore.
const defaultRendered = () => new Promise<boolean>((resolve) => {
  if (typeof requestAnimationFrame !== 'function' || typeof document === 'undefined') return resolve(true);
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    resolve((document.getElementById('root')?.childElementCount ?? 0) > 0);
  }, 50)));
});

// ---------- restore ----------
export type RestoreResult =
  | { status: 'none' }
  | { status: 'restored'; detached: boolean }
  | { status: 'skipped'; reason: string }
  | { status: 'invalid'; reason: string }
  | { status: 'error'; reason: string };

export interface RestoreOptions {
  storage?: DraftStorage;
  guard?: RestoreGuard;
  rendered?: () => Promise<boolean>;
}

const setAside = async (storage: DraftStorage, raw: unknown) => {
  try { await storage.set(REJECTED_DRAFT_KEY, raw); } catch { /* best effort */ }
};

export const restoreDraft = async (opts: RestoreOptions = {}): Promise<RestoreResult> => {
  const storage = opts.storage ?? idbDraftStorage;
  const guard = opts.guard ?? localStorageGuard;
  const status = useAutosaveStatus.getState();
  const startState = useDrawingStore.getState();
  let raw: unknown;
  try {
    raw = await storage.get(DRAFT_KEY);
  } catch (e) {
    status.show('error', MESSAGES.readFailed);
    return { status: 'error', reason: String((e as Error)?.message || e) };
  }
  if (raw === undefined || raw === null) { guard.clear(); return { status: 'none' }; }

  const v = validateDraft(raw);
  if (!v.ok) {
    await setAside(storage, raw);
    status.show('error', MESSAGES.invalid);
    return { status: 'invalid', reason: (v as { reason: string }).reason };
  }
  const draft = v.draft;

  // The previous start-up restored this very draft and the app never rendered.
  if (guard.get() === String(draft.savedAt)) {
    guard.clear();
    await setAside(storage, raw);
    status.show('error', MESSAGES.crashed);
    return { status: 'invalid', reason: 'draft failed to render on the previous start' };
  }

  // The user already started working before the draft was read: keep their work.
  const now = useDrawingStore.getState();
  if (now.elements !== startState.elements || now.elements.length > 0 || now.currentProjectId) {
    return { status: 'skipped', reason: 'canvas changed before restore' };
  }

  // Keep the link to a saved project only if that project still exists and was
  // not saved after this draft; otherwise a later "Save" could overwrite a newer
  // project with older draft content, so the draft is restored unlinked.
  let projectId = draft.projectId;
  let detached = false;
  if (projectId) {
    let meta: ProjectMetadata[] = [];
    try { meta = (await storage.get<ProjectMetadata[]>(META_KEY)) || []; } catch { meta = []; }
    const saved = meta.find((p) => p.id === projectId);
    if (!saved || saved.updatedAt > draft.savedAt) { projectId = null; detached = true; }
  }

  guard.set(String(draft.savedAt));
  const store = useDrawingStore.getState();
  store.loadProject(draft.data);
  store.setProjectInfo(projectId, draft.projectName);
  if (detached) status.show('info', MESSAGES.detached);
  const rendered = await (opts.rendered ?? defaultRendered)();
  if (rendered) guard.clear();
  return { status: 'restored', detached };
};

// ---------- autosave ----------
export interface AutosaveOptions {
  storage?: DraftStorage;
  debounceMs?: number;
  // where page lifecycle events come from (window in the app)
  lifecycle?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  isHidden?: () => boolean;
  now?: () => number;
}

export interface AutosaveHandle {
  flush: () => Promise<void>;
  stop: () => void;
  idle: () => Promise<void>;
}

export const startAutosave = (opts: AutosaveOptions = {}): AutosaveHandle => {
  const storage = opts.storage ?? idbDraftStorage;
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const lifecycle = opts.lifecycle === undefined ? (typeof window !== 'undefined' ? window : null) : opts.lifecycle;
  const isHidden = opts.isHidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const clock = opts.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;
  let chain: Promise<void> = Promise.resolve();

  const write = () => {
    dirty = false;
    const s = useDrawingStore.getState();
    const draft = isBlank(s) ? null : buildDraft(s, clock());
    chain = chain.then(async () => {
      try {
        if (draft) await storage.set(DRAFT_KEY, draft);
        else await storage.del(DRAFT_KEY);
        useAutosaveStatus.setState({ lastSavedAt: draft ? draft.savedAt : null });
        if (useAutosaveStatus.getState().kind === 'error') useAutosaveStatus.getState().dismiss();
      } catch (e) {
        console.error('Autosave failed', e);
        useAutosaveStatus.getState().show('error', isQuotaError(e) ? MESSAGES.quota : MESSAGES.writeFailed);
      }
    });
    return chain;
  };

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    return dirty ? write() : chain;
  };

  const unsubscribe = useDrawingStore.subscribe((state, prev) => {
    if (!trackedChanged(state, prev)) return;
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void write(); }, debounceMs);
  });

  const onHide = () => { void flush(); };
  const onVisibility = () => { if (isHidden()) void flush(); };
  lifecycle?.addEventListener('pagehide', onHide);
  lifecycle?.addEventListener('beforeunload', onHide);
  lifecycle?.addEventListener('visibilitychange', onVisibility);

  return {
    flush,
    idle: () => chain,
    stop: () => {
      unsubscribe();
      if (timer) { clearTimeout(timer); timer = null; }
      lifecycle?.removeEventListener('pagehide', onHide);
      lifecycle?.removeEventListener('beforeunload', onHide);
      lifecycle?.removeEventListener('visibilitychange', onVisibility);
    },
  };
};

// App start-up: restore first, then start saving (so the initial empty canvas
// can never overwrite the stored draft before it is read).
export const initAutosave = async (opts: AutosaveOptions & RestoreOptions = {}): Promise<AutosaveHandle> => {
  try {
    await restoreDraft(opts);
  } catch (e) {
    console.error('Draft restore failed', e);
    useAutosaveStatus.getState().show('error', MESSAGES.readFailed);
  }
  return startAutosave(opts);
};
